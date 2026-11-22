/**
 * 달력 게시물의 **뒷장(캐러셀 2~5번째)** 을 받는다
 *   사장님 지시 2026-10-05: *"24시간 내내 10월 달력 지금까지 올라온거 전부 파싱해놔라"*
 *
 * 🔴 왜 따로 필요한가 (2026-10-05 실측)
 *   첫 장이 「COMING SOON · 10월 일정 👉👉」 같은 **예고 사진**이고 달력은 2번째 장에 있는 셀러가 많다
 *   (heeah_family · iam_yaksa 가 그랬다). `calendar_img_fetch.mjs` 는 첫 장만 받으므로 그런 셀러를 놓친다.
 *   253명 전부에게 캐러셀을 돌리면 인스타를 몰아치게 되니, **첫 장을 읽어 보고 달력이 아니었던 셀러에게만** 돌린다.
 *
 * 🔴 내 첫 판이 틀렸던 이유 (같은 날, 고쳐 둠)
 *   「Next 를 눌러야 다음 장이 로드된다」고 짐작하고 **먼저 보이는 큰 그림을 전부 seen 에 넣고** 시작했다.
 *   실제로는 비로그인 화면이 **2장을 처음부터 DOM 에 같이 그려 둔다** → 새 그림이 없어 「뒷장이 없다」로 끝났다.
 *   → 짐작하지 말고 **DOM 순서대로 전부 받는다.** Next 는 아직 안 그려진 뒷장을 끌어오는 용도로만 누른다.
 *   ⚠ 가로 700px 초과만 쓴다 — 아래쪽 「관련 게시물」 썸네일이 640px 라 그걸로 갈린다.
 *
 * 실행: node tools/daily/calendar_img_more.mjs <핸들> [핸들…]
 *   (node 는 절대경로 — C:/Users/FAMILY/node-portable/node-v24.18.0-win-x64/node.exe)
 * 산출물: scratchpad/calimg/<핸들>_2.jpg · _3.jpg …  (1번째 장은 fetch 쪽이 이미 받아 뒀다)
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIR = join(ROOT, 'scratchpad', 'calimg');
const STATE = join(ROOT, 'scratchpad', 'calendar_img_state.json');
const SRC = join(ROOT, 'scratchpad', '_cal_strong.json');
const LOG = join(ROOT, 'scratchpad', 'calendar_img_log.txt');
const NL = String.fromCharCode(10);
const log = (s) => { console.log(s); try { appendFileSync(LOG, s + NL); } catch (_) {} };
const MIN_W = 700;

const handles = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (!handles.length) { console.log('핸들을 주세요'); process.exit(1); }
if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true });
const state = existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : {};
const list = existsSync(SRC) ? JSON.parse(readFileSync(SRC, 'utf8')) : [];
const codeOf = (h) => (state[h] && state[h].code) || (list.find((x) => x.u === h) || {}).code;
const bigImgs = `[...document.querySelectorAll('img')].filter(i=>i.naturalWidth>${MIN_W}).map(i=>({u:i.src,w:i.naturalWidth,h:i.naturalHeight}))`;

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const ctx = await browser.newContext({
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36',
  viewport: { width: 1280, height: 1600 },
});
try {
  for (const h of handles) {
    const code = codeOf(h);
    if (!code) { log(`  ✖ @${h} 게시물 번호를 모른다`); continue; }
    const p = await ctx.newPage();
    try {
      await p.goto(`https://www.instagram.com/p/${code}/`, { waitUntil: 'domcontentloaded', timeout: 40000 }).catch(() => {});
      await p.waitForTimeout(3500);
      /** DOM 순서 그대로 모은다. Next 는 아직 안 그려진 뒷장을 끌어오는 용도 */
      const seen = [];
      const take = async () => {
        const now = await p.evaluate(`(${bigImgs})`).catch(() => []);
        for (const x of now) if (!seen.some((s) => s.u === x.u)) seen.push(x);
      };
      await take();
      for (let i = 0; i < 4 && seen.length < 6; i++) {
        const btn = await p.$('button[aria-label="다음"], button[aria-label="Next"], [role="button"][aria-label="다음"], [role="button"][aria-label="Next"]');
        if (!btn) break;
        await btn.click().catch(() => {});
        await p.waitForTimeout(1600);
        const before = seen.length;
        await take();
        if (seen.length === before) break;      // 더 안 나온다
      }
      let got = 0;
      for (let n = 2; n <= seen.length; n++) {   // 1번째 장은 fetch 쪽이 이미 받았다
        const x = seen[n - 1];
        const buf = await p.evaluate(async (u) => {
          const r = await fetch(u); return Array.from(new Uint8Array(await r.arrayBuffer()));
        }, x.u).catch(() => null);
        if (!buf || buf.length < 2000) continue;
        const f = join(DIR, h.replace(/[^A-Za-z0-9._]/g, '_') + '_' + n + '.jpg');
        writeFileSync(f, Buffer.from(buf));
        log(`  ✅ @${h} ${n}번째장 ${x.w}x${x.h} ${Math.round(buf.length / 1024)}KB`);
        got++;
      }
      if (!got) log(`  ✖ @${h} 뒷장이 없다(단일 사진)`);
      state[h] = { ...(state[h] || {}), slides: seen.length };
    } finally { await p.close().catch(() => {}); }
    await new Promise((r) => setTimeout(r, 1500));
  }
} finally {
  await ctx.close().catch(() => {}); await browser.close().catch(() => {});
  writeFileSync(STATE, JSON.stringify(state, null, 1), 'utf8');
}
