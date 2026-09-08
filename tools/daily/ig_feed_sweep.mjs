// 인스타 홈피드·해시태그 24시간 스윕 (사장님 지시 2026-09-08 "24시간 파싱 방법 강구")
//
// 흐름
//   1. 레포 밖 실제 폴더(C:\Users\FAMILY\ig-profile)에 로그인된 크롬 프로필을 두고 playwright 로 연다
//      (앱 안 AppData 는 가상화되므로 프로필은 반드시 이 경로. 규칙 0-Y)
//   2. 홈피드를 아래로 N 번 스크롤하며 게시물(계정·코드·시각·광고여부)을 모은다
//   3. 게시물마다 /p/<code>/ 의 og:description 으로 캡션을 읽는다 (프로필 API 는 429 라 안 쓴다)
//   4. 해시태그 top 섹션(#공구오픈 #공구중 #공구예고 …)도 같은 방식으로 모은다
//   5. 처음 보는 게시물만 scratchpad/ig_feed/<날짜>.jsonl 에 쌓고, 공구 단서(오픈·공구·마감·날짜)가 있는 캡션은
//      scratchpad/ig_feed/후보_<날짜>.md 에 사람이 읽을 표로 남긴다 → 세션이 /파싱 게이트로 등록
//
// 실행
//   node tools/daily/ig_feed_sweep.mjs --login   ← 최초 1회, 창이 뜨면 사장님이 직접 로그인 (비밀번호는 내가 다루지 않는다)
//   node tools/daily/ig_feed_sweep.mjs           ← 예약작업(30분마다). 로그인 안 돼 있으면 상태파일에 "로그인 필요" 남기고 종료
//
// 상태파일
//   scratchpad/ig_feed_state.json   { lastRun, lastOk, loginNeeded, runs, newPosts }
//   scratchpad/ig_feed_seen.txt     본 게시물 코드 (한 줄에 하나)
//   scratchpad/ig_feed_lasterr.txt  마지막 실패 메시지
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..');
const PROFILE = 'C:\\Users\\FAMILY\\ig-profile';
const OUT_DIR = path.join(ROOT, 'scratchpad', 'ig_feed');
const STATE = path.join(ROOT, 'scratchpad', 'ig_feed_state.json');
const SEEN = path.join(ROOT, 'scratchpad', 'ig_feed_seen.txt');
const LASTERR = path.join(ROOT, 'scratchpad', 'ig_feed_lasterr.txt');
const LOGIN = process.argv.includes('--login');
const SCROLLS = Number(process.env.SCROLLS || 12);
const TAGS = ['공구오픈', '공구중', '공구예고', '공구시작', '오늘오픈', '9월공구일정', '공구일정', '육아공구', '공동구매'];
const KST = () => new Date(Date.now() + 9 * 3600e3).toISOString().replace('Z', '+09:00');
const today = () => KST().slice(0, 10);

mkdirSync(OUT_DIR, { recursive: true });
const state = existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : { runs: 0, newPosts: 0 };
const seen = new Set(existsSync(SEEN) ? readFileSync(SEEN, 'utf8').split(/\r?\n/).filter(Boolean) : []);
const saveState = (patch) => { Object.assign(state, patch, { lastRun: KST() }); writeFileSync(STATE, JSON.stringify(state, null, 2)); };
const fail = (msg) => { writeFileSync(LASTERR, `[${KST()}] ${msg}\n`); saveState({ lastErr: msg }); console.error('🔴', msg); process.exit(1); };

const launch = async (headless) => {
  const opts = { headless, viewport: { width: 1280, height: 900 }, locale: 'ko-KR',
    args: headless ? [] : ['--window-position=-32000,-32000', '--window-size=1280,900'] };
  try { return await chromium.launchPersistentContext(PROFILE, opts); }
  catch { return await chromium.launchPersistentContext(PROFILE, { ...opts, channel: 'chrome' }); }
};

const ctx = await launch(false && !LOGIN);   // 헤드리스는 인스타가 막는 경우가 많아 창을 화면 밖에 둔다
if (LOGIN) {
  // 로그인 모드: 창을 화면 안으로 가져와 사장님이 직접 로그인. 60분 대기 후 닫는다.
  const p = await ctx.newPage();
  await p.goto('https://www.instagram.com/accounts/login/');
  console.log('창에서 로그인하세요. 로그인이 확인되면 자동으로 닫힙니다 (최대 60분).');
  for (let i = 0; i < 360; i++) {
    await p.waitForTimeout(10000);
    if (/instagram\.com\/?$/.test(p.url()) || await p.$('svg[aria-label="홈"], a[href="/direct/inbox/"]')) { console.log('✅ 로그인 확인'); break; }
  }
  await ctx.close(); process.exit(0);
}

const page = await ctx.newPage();
page.setDefaultTimeout(30000);
try {
  await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);
  // 로그아웃 상태면 "/" 에 로그인 폼이 그대로 뜬다(리다이렉트 없음) → 로그인 표식(받은편지함 링크)이 있어야 통과
  const loggedIn = await page.waitForSelector('a[href="/direct/inbox/"], svg[aria-label="홈"], svg[aria-label="Home"]', { timeout: 15000 }).then(() => true).catch(() => false);
  if (!loggedIn || /accounts\/login/.test(page.url()) || await page.$('input[name="username"]')) {
    saveState({ loginNeeded: true }); fail('로그인 필요 — node tools/daily/ig_feed_sweep.mjs --login 을 사장님이 실행');
  }
  // 알림 팝업 닫기
  for (const t of ['나중에 하기', 'Not Now']) { const b = await page.$(`text=${t}`); if (b) await b.click().catch(() => {}); }

  // ── 1. 홈피드 스크롤 수집 ──
  const found = {};
  for (let i = 0; i < SCROLLS; i++) {
    const batch = await page.evaluate(() => {
      const out = [];
      for (const a of document.querySelectorAll('article')) {
        const u = [...a.querySelectorAll('a[href^="/"]')].map(x => x.getAttribute('href')).find(h => /^\/[A-Za-z0-9._]+\/$/.test(h));
        const pl = [...a.querySelectorAll('a[href*="/p/"],a[href*="/reel/"]')].map(x => x.getAttribute('href')).find(h => /\/(p|reel)\/[A-Za-z0-9_-]+/.test(h));
        const code = pl ? pl.match(/\/(?:p|reel)\/([A-Za-z0-9_-]+)/)[1] : null;
        const t = a.querySelector('time')?.getAttribute('datetime') || '';
        const ad = /광고|Sponsored/.test(a.innerText.slice(0, 80));
        if (code) out.push({ code, u: (u || '?').replace(/\//g, ''), t: t.slice(0, 10), ad, src: 'feed' });
      }
      const sc = [...document.querySelectorAll('div,main,section')].filter(e => { const s = getComputedStyle(e); return /(auto|scroll)/.test(s.overflowY) && e.scrollHeight > e.clientHeight + 300; }).sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
      if (sc) sc.scrollTop = sc.scrollHeight; else window.scrollTo(0, document.body.scrollHeight);
      return out;
    });
    for (const b of batch) if (!found[b.code]) found[b.code] = b;
    await page.waitForTimeout(2000 + Math.random() * 1500);
  }

  // ── 2. 해시태그 top 섹션 ──
  for (const tag of TAGS) {
    const items = await page.evaluate(async (tag) => {
      const r = await fetch('/api/v1/tags/web_info/?tag_name=' + encodeURIComponent(tag), { headers: { 'x-ig-app-id': '936619743392459', 'x-requested-with': 'XMLHttpRequest' } });
      if (!r.ok) return [];
      const j = await r.json(); const out = [];
      for (const s of (j?.data?.top?.sections || [])) for (const m of ((s.layout_content || {}).medias || (s.layout_content || {}).fill_items || [])) {
        const md = m.media || m; if (!md.user || !md.code) continue;
        out.push({ code: md.code, u: md.user.username, t: new Date(md.taken_at * 1000).toISOString().slice(0, 10), ad: false, src: '#' + tag, cap: md.caption?.text || '' });
      }
      return out;
    }, tag).catch(() => []);
    for (const b of items) if (!found[b.code]) found[b.code] = b;
    await page.waitForTimeout(1500);
  }

  // ── 3. 캡션 채우기 (피드 게시물은 /p/<code>/ og:description) ──
  const fresh = Object.values(found).filter(f => !seen.has(f.code));
  for (const f of fresh) {
    if (f.cap) continue;
    f.cap = await page.evaluate(async (code) => {
      try {
        const r = await fetch('/p/' + code + '/'); const h = await r.text();
        const m = h.match(/<meta property="og:description" content="([^"]*)"/); if (!m) return '';
        const ta = document.createElement('textarea'); ta.innerHTML = m[1];
        return ta.value.replace(/^[^:]*?(?:likes|comments|좋아요|댓글)[^:]*?:\s*/, '').trim();
      } catch { return ''; }
    }, f.code);
    await page.waitForTimeout(800 + Math.random() * 700);
  }

  // ── 4. 저장 ──
  const day = today();
  const jsonl = path.join(OUT_DIR, `${day}.jsonl`);
  const cand = path.join(OUT_DIR, `후보_${day}.md`);
  const isLead = (c) => /공구|오픈|OPEN|마감|D-\d|\d{1,2}\/\d{1,2}|\d{1,2}월\s?\d{1,2}일/i.test(c || '');
  let leads = 0;
  for (const f of fresh) {
    appendFileSync(jsonl, JSON.stringify({ ...f, seenAt: KST() }) + '\n');
    appendFileSync(SEEN, f.code + '\n'); seen.add(f.code);
    if (isLead(f.cap) && !f.ad) {
      if (!existsSync(cand)) writeFileSync(cand, `## 인스타 피드 후보 ${day} (자동 수집 — 세션이 /파싱 게이트로 등록)\n| 시각 | 계정 | 게시일 | 출처 | 캡션 |\n|---|---|---|---|---|\n`);
      appendFileSync(cand, `| ${KST().slice(11, 16)} | ${f.u} | ${f.t} | ${f.src} | ${(f.cap || '').replace(/\s+/g, ' ').replace(/\|/g, '｜').slice(0, 220)} |\n`);
      leads++;
    }
  }
  saveState({ lastOk: KST(), loginNeeded: false, runs: (state.runs || 0) + 1, newPosts: (state.newPosts || 0) + fresh.length, lastNew: fresh.length, lastLeads: leads, lastErr: null });
  console.log(`✅ 피드 ${Object.values(found).filter(f => f.src === 'feed').length} · 태그 ${Object.values(found).filter(f => f.src !== 'feed').length} · 새 게시물 ${fresh.length} · 공구 단서 ${leads}`);
} catch (e) {
  fail(String(e && e.message || e).split('\n')[0].slice(0, 200));
} finally {
  await ctx.close().catch(() => {});
}
