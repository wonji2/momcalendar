// 「오늘 핫딜 모음」 카드 만들기 (사장님 지시 2026-09-28 "핫딜카드도 이런식으로 하나 뽑아봐")
//
//   렌더러 = hotdealcard.html (todaycard.html 과 같은 1080×1920 2단 꽉 찬 판 — 왼쪽 오늘 뜬 핫딜 · 오른쪽 아직 살아있는 핫딜)
//   node tools/daily/make-hotdeal-card.mjs          ← 오늘
//   DAY=2026-09-28 node tools/daily/make-hotdeal-card.mjs
//   SITE=file:///C:/Users/FAMILY/Desktop/MOMCALENDAR node …   ← 로컬 파일로도 된다(스크린샷 방식이라 캔버스 오염 문제 없음)
//
// 🔴 그림은 Playwright 스크린샷으로 찍는다 — html2canvas 는 text-overflow:ellipsis 를 못 그려 상품명이 글자 반에서 잘렸다(검증 실측 2026-09-28).
//    스레드 카드(threads-listcard.js hotdealCard)와 같은 방식이라 두 산출물이 같다.
// 산출물 (주소가 매일 같아야 사장님이 즐겨찾기 하나로 본다)
//   daily/hotdeal.png · daily/hotdeal.html(보기 페이지) · daily/<날짜>_hotdeal.png(보관본) · daily/hotdeal.txt(캡션)
// 주기: 아침 카드 워크플로(.github/workflows/daily-card.yml) 에서 make-today-card.mjs 바로 뒤.
import { chromium } from 'playwright';
import { pwGuard } from './pw_guard.mjs';   // 2026-10-02: 예외·매달림에도 크롬과 임시프로필을 남기지 않는다
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
const SITE = process.env.SITE?.trim() || 'https://momcalendar.com';
const kstToday = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const day = process.env.DAY?.trim() || kstToday();
const guard = pwGuard('핫딜 카드 만들기', 5 * 60e3);
const browser = await chromium.launch().catch(() => chromium.launch({ channel: 'chrome' }));
guard.use(browser);
const page = await browser.newPage({ viewport: { width: 1200, height: 2100 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 120)));
await page.goto(`${SITE}/hotdealcard.html?d=${day}&raw=1&v=D&cb=${Date.now()}`, { waitUntil: 'load', timeout: 60000 });
await page.waitForFunction(() => window.__READY === true || window.__ERROR, null, { timeout: 60000 });
const err = await page.evaluate(() => window.__ERROR || '');
if (err) { console.error('데이터 실패:', err); await browser.close(); process.exit(1); }
const counts = await page.evaluate(() => ({ today: window.__DATA[1].length, alive: window.__DATA[2].length, shown: document.querySelectorAll('#L1 .it, #L2 .it').length }));
if (!counts.today && !counts.alive) { console.log('핫딜 0건 — 카드 안 만듦'); await browser.close(); process.exit(0); }
await page.evaluate(() => { document.body.classList.remove('mini'); document.body.classList.add('clean'); const c = document.getElementById('card'); c.style.transform = 'none'; });
// 🔴 사진이 다 뜰 때까지 기다린다(최대 20초) — 안 기다리면 빈 사진칸으로 찍힌다(2026-09-29 사장님 지적 "사진이 2개밖에 없는 걸 검수도 없이 보내니").
await page.waitForFunction(() => [...document.querySelectorAll('#L1 img.th')].every((i) => i.complete), null, { timeout: 20000 }).catch(() => {});
await page.waitForTimeout(800);
// 그래도 못 뜬 사진은 빈칸 대신 🛒 자리표시로 바꾸고 개수를 센다 — 사진 없는 칸이 많으면 실패로 끝낸다(사람이 본다)
const broken = await page.evaluate(() => { let n = 0; for (const i of document.querySelectorAll('#L1 img.th')) { if (!i.naturalWidth) { n++; i.outerHTML = '<div class="th none">🛒</div>'; } } return n; });
const total = await page.evaluate(() => document.querySelectorAll('#L1 .it').length);
if (broken > 0) console.log(`⚠ 사진 못 뜬 칸 ${broken}/${total}`);
if (total && broken / total > 0.3) { console.error(`🔴 사진 ${broken}/${total} 실패 — 카드 안 만듦`); await browser.close(); process.exit(1); }
// 넘침 재확인 — 마지막 줄·더보기가 칼럼 아래를 넘으면 한 줄씩 뺀다 (스크린샷엔 trimToFit 이 없다)
await page.evaluate(() => window.trimToFit && window.trimToFit(document));
const overflow = await page.evaluate(() => ['L1', 'L2'].map((id) => { const l = document.getElementById(id), col = l && l.closest('.col'); if (!l || !col || !l.lastElementChild) return 0; return Math.max(0, Math.round(l.lastElementChild.getBoundingClientRect().bottom - col.getBoundingClientRect().bottom)); }));
mkdirSync('daily', { recursive: true });
await page.locator('#card').screenshot({ path: `daily/${day}_hotdeal.png`, type: 'png' });
const caption = await page.evaluate(() => document.getElementById('captxt').value);
await browser.close();
guard.clear();   // 브라우저는 다 썼다 — 뒤쪽 후처리는 제한시간에서 뺀다
const buf = readFileSync(`daily/${day}_hotdeal.png`);
if (errors.length) console.log('페이지 오류:', errors.slice(0, 3).join(' | '));
writeFileSync('daily/hotdeal.png', buf);
writeFileSync('daily/hotdeal.txt', caption, 'utf8');
writeFileSync('daily/hotdeal.html', `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>오늘 핫딜 카드 ${day}</title>
<style>body{margin:0;background:#3A3145;color:#fff;font-family:sans-serif;text-align:center;padding:14px}img{max-width:100%;height:auto;border-radius:12px}p{font-size:14px;color:#C9BFD8}</style></head>
<body><p>${day} 오늘 핫딜 카드 · 길게 눌러 저장 · 매일 아침 07:40 갱신</p><img src="hotdeal.png?v=${Date.now()}" alt="오늘 핫딜 카드"></body></html>`, 'utf8');
console.log(`핫딜 카드 완성: daily/hotdeal.png (${Math.round(buf.length / 1024)}KB) · 보관본 daily/${day}_hotdeal.png · 오늘 ${counts.today}건 · 진행중 ${counts.alive}건 · 카드에 ${counts.shown}줄 · 넘침 ${overflow.join('/')}px`);
