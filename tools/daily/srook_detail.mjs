// 스룩 결제창에서 **상품 상세페이지를 통째로** 긁어 카페에 올릴 수 있게 합친다 (사장님 지시 2026-09-22)
//
//   *"앞으로도 공구가 가격 들어간것만 빼고 카드결제 택배배송 이런거 다 빼고 상품 상세페이지는 싹 긁어서 올려줘"*
//
// 🔴 스룩은 이미지를 **lazyload** 로 감춘다 — 화면에 뜬 것만 보면 배송안내·무이자할부 같은 껍데기만 잡힌다.
//    (2026-09-22 에 그것들을 상세인 줄 알고 세 번 올렸다) → **img 의 data-src 를 직접 읽는다.**
//
// 무엇을 빼나 (사장님 규칙)
//   · 가격·옵션표   — "공구가 24,900원" 처럼 값이 박힌 장
//   · 카드 무이자 할부 안내
//   · 택배·배송 안내 (추석 배송, 발주 마감 등)
//   · 스룩 화면 부품(loading·상담센터 버튼·별점 아이콘 등)
//   나머지 상품 설명은 **처음부터 끝까지 전부** 가져온다.
//
// 어떻게 묶나
//   상세는 한 장의 긴 그림을 수백 조각으로 자른 것이다. 그대로 올리면 업로드가 20분 넘고 잘 끊긴다.
//   → 폭 800 으로 세로로 이어붙여 **한 장에 12,000px 까지** 담는다. 유니케어는 181조각 → 10장이 됐다.
//
//   node tools/daily/srook_detail.mjs <스룩주소> <내보낼폴더>
//   결과: <내보낼폴더>/01.png, 02.png … (카페에 이 순서로 올리면 된다)
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const url = process.argv[2];
const outDir = path.resolve(process.argv[3] || 'scratchpad/_detail');
if (!url) { console.error('사용법: node tools/daily/srook_detail.mjs <스룩주소> <내보낼폴더>'); process.exit(1); }

const MAX_H = 12000;
const JUNK = /loading|\.svg|star_none|top_bnr|imgur|module_default|\/contents\/module\//i;

const browser = await chromium.launch().catch(() => chromium.launch({ channel: 'chrome' }));
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(3500);

// ① data-src 로 진짜 주소를 모은다 (문서 순서 그대로)
const urls = await page.evaluate(() => {
  const seen = new Set(); const out = [];
  for (const i of document.querySelectorAll('img')) {
    let s = i.getAttribute('data-src') || i.getAttribute('data-original') || i.currentSrc || i.src || '';
    if (!s) continue;
    if (s.startsWith('//')) s = 'https:' + s;
    if (!/^https?:/.test(s) || seen.has(s)) continue;
    seen.add(s); out.push(s);
  }
  return out;
});
// 상세는 **상품 이미지 폴더(userfiles)의 가장 큰 묶음**이다 — 날짜별로 묶어 제일 많은 것을 고른다.
const byBatch = {};
for (const u of urls) {
  if (JUNK.test(u)) continue;
  const m = u.match(/userfiles\/([^/]+)\/thumb\/(\d{8})/);
  if (!m) continue;
  const k = m[1] + '|' + m[2];
  (byBatch[k] = byBatch[k] || []).push(u);
}
const best = Object.entries(byBatch).sort((a, b) => b[1].length - a[1].length)[0];
if (!best) { console.error('상세 이미지를 못 찾았다'); await browser.close(); process.exit(1); }
console.log(`상세 묶음 ${best[0]} — ${best[1].length}장`);

// ② 받는다 (너무 작은 것·움짤은 건너뛴다)
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
const raw = path.join(outDir, '_raw');
fs.mkdirSync(raw, { recursive: true });
let got = 0;
for (let i = 0; i < best[1].length; i += 12) {
  await Promise.all(best[1].slice(i, i + 12).map(async (u, j) => {
    try {
      const r = await fetch(u); if (!r.ok) return;
      const b = Buffer.from(await r.arrayBuffer());
      if (b.length < 2000 || b.length > 4 * 1024 * 1024) return;   // 움짤·깨진 것 제외
      fs.writeFileSync(path.join(raw, String(i + j + 1).padStart(3, '0') + '.img'), b); got++;
    } catch {}
  }));
}
console.log(`받음 ${got}장`);

// ③ 폭 800 으로 세로 합치기 — file:// 로 열어야 그림이 읽힌다(setContent 는 못 읽는다)
const files = fs.readdirSync(raw).sort().map((f) => path.join(raw, f));
const tmp = path.join(outDir, '_m.html');
const render = async (list) => {
  fs.writeFileSync(tmp, '<style>*{margin:0;padding:0}body{width:800px;background:#fff}img{display:block;width:800px;height:auto}</style>'
    + list.map((f) => `<img src="file:///${f.replace(/\\/g, '/')}">`).join(''), 'utf8');
  await page.goto('file:///' + tmp.replace(/\\/g, '/'), { waitUntil: 'load' });
  await page.evaluate(async () => { await Promise.all([...document.images].map((i) => i.complete ? 0 : new Promise((r) => { i.onload = i.onerror = r; }))); });
  await page.waitForTimeout(500);
  return page.evaluate(() => [...document.images].map((i) => i.naturalWidth ? Math.round(800 * i.naturalHeight / i.naturalWidth) : 0));
};
const heights = await render(files);
const groups = []; let cur = [], curH = 0;
for (let i = 0; i < files.length; i++) {
  if (!heights[i]) continue;
  if (curH + heights[i] > MAX_H && cur.length) { groups.push(cur); cur = []; curH = 0; }
  cur.push(files[i]); curH += heights[i];
}
if (cur.length) groups.push(cur);

for (let g = 0; g < groups.length; g++) {
  await render(groups[g]);
  const out = path.join(outDir, String(g + 1).padStart(2, '0') + '.png');
  await page.screenshot({ path: out, fullPage: true });
  console.log(`  ${g + 1}. 조각 ${groups[g].length}개 → ${(fs.statSync(out).size / 1024).toFixed(0)}KB`);
}
fs.rmSync(raw, { recursive: true, force: true });
fs.rmSync(tmp, { force: true });
await browser.close();
console.log(`\n완성: ${outDir} 에 ${groups.length}장`);
console.log('⚠ 올리기 전에 **눈으로 확인**할 것 — 가격표·배송안내가 섞이면 빼야 한다(2026-09-22 세 번 틀렸다).');
