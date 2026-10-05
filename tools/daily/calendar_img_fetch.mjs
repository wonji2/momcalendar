/**
 * 달력 게시물의 **원본 이미지**를 받아 둔다 — 캡션에 없는 일정은 그림에만 있다
 *   사장님 지시 2026-10-05: *"니가 달력올리는 셀러들 계정 다 들어가서 피드 보고 직접 db에 넣어야지"*
 *                           *"24시간 내내 10월 달력 지금까지 올라온거 전부 파싱해놔라"*
 *
 * 🔑 왜 그동안 못 잡았나 (2026-10-05 실측)
 *   달력 셀러의 캡션에는 「10월 일정 나왔어요」까지만 있고 **날짜별 상품은 이미지에만** 있다.
 *   기존 달력 파서(`_calendar_parse.mjs`)는 캡션을 읽으므로 그런 셀러를 통째로 놓쳤다.
 *   실측: 피드 스윕에 10월 달력글이 **978건·셀러 689명** 쌓여 있었는데 DB 반영은 0.
 *
 * 🔴 og:image 를 쓰면 안 된다 — **정사각으로 잘린 썸네일**이라 달력 위쪽만 보인다.
 *   URL 의 크롭 파라미터(`stp=c288.0.864.864a_…`)를 손으로 고치면 **403**(서명이 stp 를 포함한다).
 *   → **브라우저로 게시물을 열어** `img.naturalWidth > 600` 인 원본 src 를 받아야 한다(1440×1789 확인).
 *
 * 실행: node tools/daily/calendar_img_fetch.mjs [--n=20] [--again]
 * 입력: scratchpad/_cal_strong.json  (피드 jsonl 에서 고른 달력 게시물 — 핸들·shortcode)
 * 산출물: scratchpad/calimg/<핸들>.jpg · 진행상태 scratchpad/calendar_img_state.json
 *        받은 그림은 **사람이(또는 Claude 가) 읽어** 일정을 뽑아 등록한다.
 * 로그: scratchpad/calendar_img_log.txt
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = join(ROOT, 'scratchpad', '_cal_strong.json');
const DIR = join(ROOT, 'scratchpad', 'calimg');
const STATE = join(ROOT, 'scratchpad', 'calendar_img_state.json');
const LOG = join(ROOT, 'scratchpad', 'calendar_img_log.txt');
const NL = String.fromCharCode(10);

const args = process.argv.slice(2);
const argv = (k, d) => { const a = args.find((x) => x.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : d; };
const N = Number(argv('n', '20')) || 20;
const AGAIN = args.includes('--again');

const log = (s) => {
  const t = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');
  console.log(s);
  try { appendFileSync(LOG, `[${t}] ${s}${NL}`); } catch (_) {}
};
if (!existsSync(SRC)) { log('🔴 달력 게시물 목록(_cal_strong.json)이 없다'); process.exit(1); }
if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true });
const state = existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : {};
const list = JSON.parse(readFileSync(SRC, 'utf8'));
// 그림을 실제로 받은 것만 '완료'로 본다 (예전 og:image 판은 다시 받는다)
const done = (h) => state[h] && state[h].full;
const todo = list.filter((x) => AGAIN || !done(x.u)).slice(0, N);
if (!todo.length) { log(`받을 것이 없다 — 전체 ${list.length}명 완료`); process.exit(0); }
log(`달력 원본 받기 — ${todo.length}명 (남은 ${list.filter((x) => !done(x.u)).length} / 전체 ${list.length})`);

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const ctx = await browser.newContext({
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36',
  viewport: { width: 1280, height: 1600 },
});
let ok = 0, fail = 0;
try {
  for (const it of todo) {
    const p = await ctx.newPage();
    try {
      await p.goto(`https://www.instagram.com/p/${it.code}/`, { waitUntil: 'domcontentloaded', timeout: 40000 }).catch(() => {});
      await p.waitForTimeout(3200);
      const got = await p.evaluate(() => {
        // ⚠ `article img` 로 좁히면 못 찾는다 — 비로그인 화면에선 게시물이 article 밖에 그려진다(2026-10-05 실측).
        //   모든 img 중 **원본 크기(600px 초과)** 인 것을 고른다. 프로필·아이콘은 150px 라 걸러진다.
        const img = [...document.querySelectorAll('img')].filter((i) => i.naturalWidth > 600)[0];
        return img ? { url: img.src, w: img.naturalWidth, h: img.naturalHeight, alt: (img.alt || '').slice(0, 80) } : null;
      }).catch(() => null);
      if (!got) { log(`  ✖ @${it.u} 원본 이미지를 못 찾음`); state[it.u] = { at: Date.now(), fail: 'no-img' }; fail++; continue; }
      // 그 페이지가 받은 URL 은 서명이 유효하다 — 같은 컨텍스트에서 받는다
      const buf = await p.evaluate(async (u) => {
        const r = await fetch(u); const b = await r.arrayBuffer();
        return Array.from(new Uint8Array(b));
      }, got.url).catch(() => null);
      if (!buf || buf.length < 2000) { log(`  ✖ @${it.u} 내려받기 실패`); state[it.u] = { at: Date.now(), fail: 'dl' }; fail++; continue; }
      const f = join(DIR, it.u.replace(/[^A-Za-z0-9._]/g, '_') + '.jpg');
      writeFileSync(f, Buffer.from(buf));
      state[it.u] = { at: Date.now(), code: it.code, file: f, kb: Math.round(buf.length / 1024), w: got.w, h: got.h, full: true, read: false };
      log(`  ✅ @${it.u} ${got.w}x${got.h} ${Math.round(buf.length / 1024)}KB`);
      ok++;
    } finally { await p.close().catch(() => {}); }
    await new Promise((r) => setTimeout(r, 1500));   // 인스타를 몰아치지 않는다
  }
} finally {
  await ctx.close().catch(() => {}); await browser.close().catch(() => {});
  writeFileSync(STATE, JSON.stringify(state, null, 1), 'utf8');
}
log(`끝 — 받음 ${ok} · 실패 ${fail} · 남은 ${list.filter((x) => !done(x.u)).length}명`);
