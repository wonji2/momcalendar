// 「오늘 핫딜 모음」 카드 만들기 (사장님 지시 2026-09-28 "핫딜카드도 이런식으로 하나 뽑아봐")
//
//   렌더러 = hotdealcard.html (todaycard.html 과 같은 1080×1920 2단 꽉 찬 판 — 왼쪽 오늘 뜬 핫딜 · 오른쪽 아직 살아있는 핫딜)
//   node tools/daily/make-hotdeal-card.mjs          ← 오늘
//   DAY=2026-09-28 node tools/daily/make-hotdeal-card.mjs
//   SITE=file:///C:/Users/FAMILY/Desktop/MOMCALENDAR node …   ← 배포 전 로컬 파일로 검증
//
// 산출물 (주소가 매일 같아야 사장님이 즐겨찾기 하나로 본다)
//   daily/hotdeal.png · daily/hotdeal.html(보기 페이지) · daily/<날짜>_hotdeal.png(보관본)
// 주기: 아침 카드 워크플로(.github/workflows/daily-card.yml) 에서 make-today-card.mjs 바로 뒤. 스레드 낮 글은 threads-listcard.js hotdealCard() 가 그때그때 새로 그린다.
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
const SITE = process.env.SITE?.trim() || 'https://momcalendar.com';
const kstToday = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const day = process.env.DAY?.trim() || kstToday();
const browser = await chromium.launch().catch(() => chromium.launch({ channel: 'chrome' }));
const page = await browser.newPage({ viewport: { width: 1200, height: 2400 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 120)));
await page.goto(`${SITE}/hotdealcard.html?d=${day}&cb=${Date.now()}`, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForFunction(() => window.__READY === true || window.__ERROR, null, { timeout: 60000 });
const err = await page.evaluate(() => window.__ERROR || '');
if (err) { console.error('데이터 실패:', err); await browser.close(); process.exit(1); }
const counts = await page.evaluate(() => ({ today: window.__DATA[1].length, alive: window.__DATA[2].length, shown: document.querySelectorAll('#L1 .it, #L2 .it').length }));
const pngDataUrl = await page.evaluate(async () => {
  const card = document.getElementById('card');
  document.body.classList.remove('mini'); document.body.classList.add('clean');
  await document.fonts.ready; await new Promise((r) => setTimeout(r, 400));
  const canvas = await window.html2canvas(card, { width: 1080, height: 1920, scale: 1, backgroundColor: '#ffffff', useCORS: true, logging: false, windowWidth: 1080, windowHeight: 1920, onclone: window.trimToFit });
  return canvas.toDataURL('image/png');
});
const caption = await page.evaluate(() => document.getElementById('captxt').value);
await browser.close();
if (!pngDataUrl) { console.error('카드를 못 그렸다'); process.exit(1); }
if (errors.length) console.log('페이지 오류:', errors.slice(0, 3).join(' | '));
mkdirSync('daily', { recursive: true });
const buf = Buffer.from(pngDataUrl.split(',')[1], 'base64');
writeFileSync('daily/hotdeal.png', buf);
writeFileSync(`daily/${day}_hotdeal.png`, buf);
writeFileSync('daily/hotdeal.txt', caption, 'utf8');
writeFileSync('daily/hotdeal.html', `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>오늘 핫딜 카드 ${day}</title>
<style>body{margin:0;background:#3A3145;color:#fff;font-family:sans-serif;text-align:center;padding:14px}img{max-width:100%;height:auto;border-radius:12px}p{font-size:14px;color:#C9BFD8}</style></head>
<body><p>${day} 오늘 핫딜 카드 · 길게 눌러 저장</p><img src="hotdeal.png?v=${Date.now()}" alt="오늘 핫딜 카드"></body></html>`, 'utf8');
console.log(`핫딜 카드 완성: daily/hotdeal.png (${Math.round(buf.length / 1024)}KB) · 보관본 daily/${day}_hotdeal.png · 오늘 ${counts.today}건 · 진행중 ${counts.alive}건 · 카드에 ${counts.shown}줄`);
