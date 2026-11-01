/**
 * 달력 셀러 피드를 **직접 열어** 이번 달 달력 게시물 후보를 모은다
 *   사장님 지시 2026-10-05: *"니가 달력올리는 셀러들 계정 다 들어가서 피드 보고 직접 db에 넣어야지"*
 *                           *"24시간 내내 10월 달력 지금까지 올라온거 전부 파싱해놔라"*
 *
 * 왜 필요한가
 *   달력은 **이미지**다. 캡션에 일정이 없으면 기존 파서(캡션 기반)가 못 읽는다.
 *   니니맘·마이희로가 그랬다 — 10월 일정이 DB 에 0~1건이었다(2026-10-05 실측).
 *   인스타 프로필은 **로그인 없이** 열린다 → 게시물 이미지 주소와 alt(날짜)를 긁어 둔다.
 *   그 뒤 사람(또는 나)이 이미지를 보고 일정을 읽어 등록한다.
 *
 * 실행: node tools/daily/calendar_feed_scan.mjs [핸들…]            특정 셀러만
 *       node tools/daily/calendar_feed_scan.mjs --gaps [--n=10]    이번 달 달력이 없는 셀러부터
 * 산출물: scratchpad/calendar_feed_scan.json  (핸들 → 후보 게시물 [{date, img, alt}])
 *        이어서 돌면 이미 본 셀러는 건너뛴다(--again 이면 다시 본다)
 * 로그: scratchpad/calendar_feed_scan_log.txt
 */
import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(ROOT, 'scratchpad', 'calendar_feed_scan.json');
const LOG = join(ROOT, 'scratchpad', 'calendar_feed_scan_log.txt');
const GAPS = join(ROOT, 'scratchpad', '_cal_gap_handles.txt');
const NL = String.fromCharCode(10);

const args = process.argv.slice(2);
const argv = (k, d) => { const a = args.find((x) => x.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : d; };
const N = Number(argv('n', '8')) || 8;
const AGAIN = args.includes('--again');
let handles = args.filter((a) => !a.startsWith('--'));
if (!handles.length) {
  if (!existsSync(GAPS)) { console.log('핸들을 주거나 --gaps 명단을 먼저 만드세요'); process.exit(1); }
  handles = readFileSync(GAPS, 'utf8').split(/\r?\n/).filter(Boolean);
}

const log = (s) => {
  const t = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');
  console.log(s);
  try { appendFileSync(LOG, `[${t}] ${s}${NL}`); } catch (_) {}
};

const store = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : {};
const todo = handles.filter((h) => AGAIN || !store[h]).slice(0, N);
if (!todo.length) { log('새로 볼 셀러가 없다 (--again 이면 다시 본다)'); process.exit(0); }
log(`피드 훑기 시작 — ${todo.length}명 (남은 대상 ${handles.filter((h) => !store[h]).length}명)`);

// 이번 달과 지난달 말 = 달력이 올라오는 때
const kst = new Date(Date.now() + 9 * 3600e3);
const Y = kst.getUTCFullYear(), M = kst.getUTCMonth() + 1;
const MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const want = new RegExp(`(${MON[M - 1]} 0?[1-9]|${MON[M - 1]} 1[0-5]|${MON[(M + 10) % 12]} (2[5-9]|3[01]))`);

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const ctx = await browser.newContext({
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36',
  viewport: { width: 1280, height: 1600 },
});
try {
  for (const h of todo) {
    const p = await ctx.newPage();
    try {
      await p.goto(`https://www.instagram.com/${h}/`, { waitUntil: 'domcontentloaded', timeout: 40000 }).catch(() => {});
      await p.waitForTimeout(2600);
      const got = await p.evaluate(() => {
        const d = document.querySelector('meta[property="og:description"]');
        const imgs = [...document.querySelectorAll('article img, main img')]
          .map((i) => ({ src: i.src || '', alt: i.alt || '' }))
          .filter((x) => x.src && /Photo by|Video by/.test(x.alt));
        return { og: d ? d.content : '', imgs };
      }).catch(() => null);
      if (!got) { log(`  ⚠ ${h} 프로필을 못 읽음`); store[h] = { at: new Date().toISOString(), fail: true }; continue; }
      // 달력이 올라올 만한 날짜의 게시물만 남긴다
      const cands = got.imgs.filter((x) => want.test(x.alt)).slice(0, 6)
        .map((x) => ({ alt: x.alt.replace(/\s+/g, ' ').slice(0, 130), img: x.src }));
      store[h] = { at: new Date().toISOString(), og: String(got.og).slice(0, 120), total: got.imgs.length, cands };
      log(`  ${h} — 게시물 ${got.imgs.length} · 달력후보 ${cands.length}`);
      for (const c of cands) log(`      · ${c.alt.slice(0, 90)}`);
    } finally { await p.close().catch(() => {}); }
    await new Promise((r) => setTimeout(r, 1800));   // 인스타를 몰아치지 않는다
  }
} finally { await ctx.close().catch(() => {}); await browser.close().catch(() => {}); }

writeFileSync(OUT, JSON.stringify(store, null, 1), 'utf8');
const left = handles.filter((h) => !store[h]).length;
log(`저장 → ${OUT} · 남은 셀러 ${left}명`);
