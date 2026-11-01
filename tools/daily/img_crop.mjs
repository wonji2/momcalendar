/**
 * 📐 긴 상세페이지 사진에서 **쓸 부분만 잘라낸다** (2026-10-06 신설)
 *
 * 왜 만들었나: 브랜드가 주는 상세페이지는 1080×3795 처럼 세로로 아주 길다.
 *   스레드는 4:5, 인스타 카드는 1:1 이라 **그대로 올리면 뭉개지거나 위아래가 잘린다.**
 *   사장님이 주신 사진을 손으로 자르게 하지 않는다(메모리 hotdeal-image-sources — 사진 요청 금지).
 *
 *   node tools/daily/img_crop.mjs <원본> <산출> [--ratio 4:5] [--top 0] [--w 1080]
 *     --ratio  잘라낼 비율 (기본 4:5). 1:1 · 16:9 도 됨
 *     --top    위에서 몇 px 부터 자를지 (기본 0 — 맨 위가 보통 대표 컷이다)
 *
 * 어떻게: playwright 로 흰 바탕에 사진을 얹고 **clip 스크린샷**을 찍는다.
 *   순수 JS 로 JPEG 를 다시 인코딩하는 것보다 글자가 덜 뭉개진다(기존 카드 도구들과 같은 방식).
 */
import { chromium } from 'playwright';
import { readFileSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const a = process.argv.slice(2);
const arg = (k, d) => { const i = a.indexOf('--' + k); return i >= 0 ? a[i + 1] : d; };
const [src, out] = a.filter((x) => !x.startsWith('--') && !a[a.indexOf(x) - 1]?.startsWith('--'));
if (!src || !out) { console.error('사용법: node tools/daily/img_crop.mjs <원본> <산출> [--ratio 4:5] [--top 0]'); process.exit(1); }
if (!existsSync(src)) { console.error(`🔴 원본이 없다: ${src}`); process.exit(1); }

const [rw, rh] = String(arg('ratio', '4:5')).split(':').map(Number);
const top = Number(arg('top', 0));

const b = readFileSync(src);
let W = 0, H = 0, i = 2;
// PNG 는 머리 8바이트 뒤 IHDR 에 크기가 있다 (2026-10-07 — 카드 PNG 를 확대해 보려다 못 읽어서 추가)
if (b.length > 24 && b[0] === 0x89 && b.toString('latin1', 1, 4) === 'PNG') {
  W = b.readUInt32BE(16); H = b.readUInt32BE(20); i = b.length;
}
while (i < b.length) {                                   // JPEG 크기 읽기
  if (b[i] !== 0xFF) { i++; continue; }
  const m = b[i + 1];
  if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) { H = b.readUInt16BE(i + 5); W = b.readUInt16BE(i + 7); break; }
  i += 2 + b.readUInt16BE(i + 2);
}
if (!W || !H) { console.error('🔴 JPEG 크기를 못 읽었다 (PNG 면 이 도구를 쓰지 않는다)'); process.exit(1); }

const cutH = Math.min(Math.round(W * rh / rw), H - top);
if (cutH <= 0) { console.error(`🔴 --top ${top} 이 사진(${H}px)보다 아래다`); process.exit(1); }

const br = await chromium.launch();
try {
  const pg = await br.newPage({ viewport: { width: W, height: cutH }, deviceScaleFactor: 1 });
  // 🔴 file:// 주소를 주면 about:blank 페이지가 보안상 못 읽는다 — **빈 사진이 나온다**(2026-10-06 실측).
  //    사진을 data URI 로 박아 넣는다.
  const mime = /\.png$/i.test(src) ? 'image/png' : 'image/jpeg';
  await pg.setContent(`<body style="margin:0;background:#fff">
    <img id="t" src="data:${mime};base64,${b.toString('base64')}" style="width:${W}px;display:block;margin-top:${-top}px">
  </body>`);
  await pg.waitForFunction(() => { const i = document.getElementById('t'); return i && i.complete && i.naturalWidth > 0; }, null, { timeout: 30000 });
  await pg.screenshot({ path: out, type: 'jpeg', quality: 92, clip: { x: 0, y: 0, width: W, height: cutH } });
  console.log(`✂️ ${W}×${H} → ${W}×${cutH} (${rw}:${rh}, 위에서 ${top}px) → ${out}`);
} finally { await br.close(); }
