/**
 * 📖 **공구톡톡 카페 본문에서 셀러를 읽는다** — 비용 0원, 무인
 *
 * 사장님 2026-10-01:
 *   *"공구톡톡 글은 당연히 글에서 정보만 읽어와서 인포크나 셀러만 올리는거고"*
 *   *"공구톡톡이 본문에 셀러 인스타도 같이 올리자나"*
 *   *"이전 채팅에서는 스스로 방법 찾아내서 돈 안들이고 원문 링크 읽었어 기록 뒤져"*
 *
 * 🔴 왜 그동안 못 했나 (2026-10-01 실측)
 *   · 목록 API(`gongtok_cafe.mjs`, 2시간마다)는 **제목만** 읽는다 → 셀러 미상이라 등록이 막혔다.
 *     하루 ~48건이 `scratchpad/gongtok/<날짜>.md` 에 쌓이기만 하고 **읽는 도구가 없었다**(등록 0).
 *   · 2026-09-04 에 쓰던 「네이버 검색 API `description` 에 본문 앞부분이 온다」 경로는
 *     **검색 API 가 없어져** 못 쓴다(사장님 확인). 우리 키는 `401 Scopes are Empty`.
 *   · 카페 본문 API(`apis.naver.com/cafe-web/...`)는 HTTP 500 — 회원인증 벽.
 *   ✅ **남은 길 하나: 로그인 세션으로 PC 주소를 연다.** 공구톡톡은 **한잎 등급 이상**만 읽을 수 있고,
 *     `browser-profile-njob`(사장님 계정)이 등급을 충족한다 → 그 프로필을 복사해 전용으로 쓴다
 *     (`browser-profile-gongtok`). 복사하는 이유는 **다른 작업과 크롬 프로필이 겹치면 못 열기** 때문이다
 *     (메모리 cafe-profile-no-manual-run).
 *
 * 본문에 뭐가 있나 (실측 — 글 70392)
 *   제목  「[여성 위생용품] 마호리카드 유산균청결제 (10월30일 open)」 → 상품명 + 오픈일
 *   본문  🔗공동구매 링크 → link.inpock.co.kr/**castella**      (인포크 슬러그)
 *        🔗공동구매 출처 → instagram.com/**_castella_** 「카스테라마켓❤️ 곽혜진」 (핸들 + 한글명)
 *
 * 흐름: 목록 API 단서(scratchpad/gongtok/<날짜>.md) → 글 열기 → 셀러·상품·날짜 추출
 *       → 6열 수확 TSV → 기존 체인(harvest_clean → harvest_to_table → 게이트 → 등록)
 *
 *   node tools/daily/gongtok_body.mjs [--n 40] [--days 2] [--dry]
 * 상태: scratchpad/gongtok_body_seen.txt   로그: scratchpad/gongtok_body_log.txt
 * 주기: 윈도우 예약작업 momcal-gongtok-body — 하루 3회 (09:10 · 15:10 · 21:10)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SP = (f) => path.join(ROOT, 'scratchpad', f);
const PROFILE = path.join(ROOT, 'sns-automation', 'browser-profile-gongtok');
const SEEN_F = SP('gongtok_body_seen.txt');
const LOG_F = SP('gongtok_body_log.txt');

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const N = +arg('--n', 40);
const DAYS = +arg('--days', 2);
const DRY = process.argv.includes('--dry');
const DELAY = +arg('--delay', 1500);   // 글 사이 기본 간격(ms). 실제로는 DELAY~2×DELAY 로 흔든다

const KST = () => new Date(Date.now() + 9 * 3600e3);
const today = KST().toISOString().slice(0, 10);
const YEAR = +today.slice(0, 4);
const log = (s) => { const l = `[${KST().toISOString().slice(0, 16).replace('T', ' ')}] ${s}`; console.log(l); try { fs.appendFileSync(LOG_F, l + '\n'); } catch { } };
for (const ev of ['uncaughtException', 'unhandledRejection']) {
  process.on(ev, (e) => { log(`🔴🔴 ${ev} — ${String((e && e.stack) || e).split('\n').slice(0, 6).join(' | ')}`); process.exit(1); });
}

// ── 단서 모으기: 목록 API 가 남긴 표에서 글번호를 뽑는다
const seen = new Set(fs.existsSync(SEEN_F) ? fs.readFileSync(SEEN_F, 'utf8').split(/\r?\n/).filter(Boolean) : []);
const ids = [];
for (let d = 0; d < DAYS; d++) {
  const day = new Date(KST().getTime() - d * 864e5).toISOString().slice(0, 10);
  const f = SP(path.join('gongtok', `${day}.md`));
  if (!fs.existsSync(f)) continue;
  for (const l of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
    const m = l.match(/cafe\.naver\.com\/gongz\/(\d+)/);
    if (m && !seen.has(m[1]) && !ids.includes(m[1])) ids.push(m[1]);
  }
}
log(`단서 ${ids.length}건 (이미 본 글 ${seen.size}건 제외) — 이번에 ${Math.min(ids.length, N)}건 읽는다`);
if (!ids.length) { log('읽을 글 0건 — 끝'); process.exit(0); }

// 제목에서 상품명·오픈일: 「[말머리] 상품명 (10월30일 open)」
const parseTitle = (t) => {
  let s = String(t || '').replace(/^\s*\[[^\]]{1,20}\]\s*/, '').trim();
  let open = '';
  const m = s.match(/\(\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일?\s*(?:open|오픈)?\s*\)\s*$/i);
  if (m) {
    const mo = +m[1], da = +m[2];
    if (mo >= 1 && mo <= 12 && da >= 1 && da <= 31) {
      open = `${YEAR}-${String(mo).padStart(2, '0')}-${String(da).padStart(2, '0')}`;
      s = s.slice(0, m.index).trim();
    }
  }
  return { name: s, open };
};
const addDays = (s, n) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

const rows = [], names = [];
let read = 0, noSeller = 0, noDate = 0, failStreak = 0;
const ctx = await chromium.launchPersistentContext(PROFILE, { headless: true, channel: 'chrome', args: ['--no-sandbox'] });
try {
  for (const id of ids.slice(0, N)) {
    const p = await ctx.newPage();
    try {
      await p.goto(`https://cafe.naver.com/gongz/${id}`, { waitUntil: 'networkidle', timeout: 45000 }).catch(() => { });
      await p.waitForTimeout(2200);
      let got = null;
      for (const f of p.frames()) {
        if (!/ca-fe\/cafes/.test(f.url())) continue;
        got = await f.evaluate(() => {
          const box = document.querySelector('.ArticleContentBox');
          if (!box) return null;
          return {
            title: document.querySelector('.title_text')?.innerText || '',
            text: (box.innerText || '').replace(/\s+/g, ' '),
            // 🔑 카페 안 링크는 버린다 — 공지에 다른 글 링크가 잔뜩 있다
            links: [...box.querySelectorAll('a')].map((a) => a.href).filter((h) => !/cafe\.naver\.com|naver\.com\/ca-fe/.test(h)),
          };
        }).catch(() => null);
        if (got) break;
      }
      if (!got) { failStreak++; log(`  ⚠ ${id} 본문 칸을 못 찾음 (연속 ${failStreak})`); continue; }
      failStreak = 0;
      read++;
      seen.add(id);

      const blob = got.text + ' ' + got.links.join(' ');
      const slug = (blob.match(/(?:link\.inpock\.co\.kr|inpk\.link)\/([A-Za-z0-9._-]{2,40})/) || [])[1] || '';
      const handle = (blob.match(/instagram\.com\/([A-Za-z0-9._]{3,30})/) || [])[1] || '';
      // 한글명: 「… 카스테라마켓❤️ 곽혜진(@_castella_) • Instagram」 에서 @ 앞부분
      let kor = '';
      const km = got.text.match(/([^()|]{2,30})\(@[A-Za-z0-9._]{3,30}\)\s*•\s*Instagram/);
      if (km) kor = km[1]
        .replace(/Instagram/gi, '')
        .replace(/^.*?(?:공동구매\s*출처|공동구매\s*링크|🔗)\s*/u, '')   // 「🔗공동구매 출처 …」가 앞에 붙어 온다
        .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}️]/gu, '')   // 이모지
        // 🔴 2026-10-02 실측: 「A4cWw0aw== 토코맘 l 육아꿀팁…」 처럼 **페이지 토큰이 앞에 붙어** 온다.
        //    한글이 들어 있는 이름이면 **첫 한글 앞은 다 버린다.**
        .replace(/^[^가-힣]*(?=[가-힣])/u, '')
        // 「토코맘 l 육아꿀팁…」·「멜맘ㅣ쉽게 만드는…」 뒤 소개문은 이름이 아니다.
        //   ⚠ 구분자로 `ㅣ`(한글 모음)·`｜`(전각)도 쓴다 — 셋 다 본다
        .replace(/\s*[|｜lIㅣ]\s*.*$/u, '')
        .replace(/\s{2,}/g, ' ').trim().slice(0, 20);

      const { name, open } = parseTitle(got.title);
      if (!handle && !slug) { noSeller++; log(`  · ${id} 셀러 없음 — ${name.slice(0, 30)}`); continue; }
      if (!name || !open) { noDate++; log(`  · ${id} 제목에서 ${!name ? '상품명' : '오픈일'}을 못 읽음 — ${got.title.slice(0, 40)}`); continue; }

      // 6열: handle, slug, name, open, end, link   (마감은 오픈+3 — DB등록규칙 1)
      rows.push([handle || slug, slug, name, open, addDays(open, 3), slug ? `https://link.inpock.co.kr/${slug}` : ''].join('\t'));
      if (handle && kor) names.push(`${handle}|${kor}`);
      log(`  ✅ ${id}  ${name} (${open})  @${handle || '-'} / 인포크 ${slug || '-'}${kor ? ' · ' + kor : ''}`);
    } catch (e) {
      failStreak++;
      log(`  🔴 ${id} 실패 (연속 ${failStreak}) — ${String(e.message || e).slice(0, 80)}`);
    } finally { await p.close().catch(() => { }); }
    // 🔑 **막히지 않게 간격을 둔다** (사장님 2026-10-01 "알아서 안막히게 조절해서").
    //    네이버 카페는 같은 세션이 쉼 없이 글을 열면 막는다. 고정 간격은 패턴이 되니 흔든다.
    //    연속 실패가 3건이면 그 회차를 멈춘다 — 밀어붙이면 계정이 막힌다(메모리 blocked-escalate-immediately).
    await new Promise((s) => setTimeout(s, DELAY + Math.floor(Math.random() * DELAY)));
    if (failStreak >= 3) { log('🔴 연속 3건 실패 — 막혔을 수 있다. 이 회차를 멈춘다(다음 회차에 이어서 읽는다)'); break; }
  }
} finally { await ctx.close().catch(() => { }); }

log(`읽음 ${read}건 → 수확 ${rows.length}건 (셀러없음 ${noSeller} · 제목불충분 ${noDate})`);
if (DRY) { log('--dry — 파일에 쓰지 않았다'); process.exit(0); }
fs.writeFileSync(SEEN_F, [...seen].join('\n') + '\n', 'utf8');
if (!rows.length) { log('수확 0건 — 끝'); process.exit(0); }
const out = SP(path.join('gongtok', `_body_${today}_${KST().toISOString().slice(11, 16).replace(':', '')}.tsv`));
fs.writeFileSync(out, rows.join('\n') + '\n', 'utf8');
if (names.length) fs.writeFileSync(out + '.names', names.join('\n') + '\n', 'utf8');
log(`→ ${path.relative(ROOT, out)} (한글명 ${names.length}건)`);
log('  다음: harvest_clean → harvest_to_table → 게이트 → 등록 (ig_feed_pipeline 과 같은 체인)');
