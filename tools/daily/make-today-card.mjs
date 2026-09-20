// 「오늘 공구 캘린더」 카드 만들기 — 사장님 전용 고정 링크용 (사장님 지시 2026-09-21)
//
// 왜 따로 있나: 인스타에 올리는 카드는 요일별 7종 로테이션(make-card.mjs, fmt=auto)이다.
//   사장님은 **매일 같은 「오늘 공구 캘린더」 형식**(오늘 오픈 / 오늘 마감 두 칸 = instastudio 의 `list` 시안)을
//   하나씩 보고 싶어 하셔서, 인스타 로테이션은 그대로 두고 이 카드만 따로 뽑는다.
//
//   node tools/daily/make-today-card.mjs          ← 오늘
//   DAY=2026-09-21 node tools/daily/make-today-card.mjs
//
// 산출물 (둘 다 덮어쓴다 — 주소가 매일 같아야 사장님이 즐겨찾기 하나로 본다)
//   daily/today.png   ← 카드 그림
//   daily/today.html  ← 그림 + 날짜만 있는 보기 페이지 (카톡으로 그대로 공유 가능)
//   daily/<날짜>_today.png  ← 그날치 보관본
//
// 주기: 아침 카드(make-card.mjs) 예약작업 바로 뒤에 같이 돈다.
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';

const SITE = 'https://momcalendar.com';
const kstToday = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const day = process.env.DAY?.trim() || kstToday();

// 번들 headless → 없으면 설치된 Chrome 으로 폴백 (make-card.mjs 와 같은 이유·같은 패턴)
const browser = await chromium.launch().catch(() => chromium.launch({ channel: 'chrome' }));
const page = await browser.newPage({ viewport: { width: 1200, height: 2400 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 120)));

// fmt=list = instastudio 의 「리스트형(기존)」 = 인스타에 오래 올리던 '오늘 공구 캘린더' 그 형식
await page.goto(`${SITE}/instastudio.html?d=${day}&fmt=list&cb=${Date.now()}`, { waitUntil: 'networkidle', timeout: 60000 });

// 데이터가 다 들어왔는지(캡션이 채워지는 것으로 판단) 기다린다
await page.waitForFunction(() => {
  const t = document.getElementById('captxt');
  return t && t.value && t.value.length > 200;
}, { timeout: 60000 });

const pngDataUrl = await page.evaluate(async () => {
  const card = document.getElementById('card');
  if (!card) return null;
  document.body.classList.remove('mini');
  document.body.classList.add('clean');
  await document.fonts.ready;
  await new Promise((r) => setTimeout(r, 400));
  const canvas = await window.html2canvas(card, {
    width: 1080, height: 1920, scale: 1,
    backgroundColor: '#ffffff', useCORS: true, logging: false,
    windowWidth: 1080, windowHeight: 1920,
  });
  return canvas.toDataURL('image/png');
});
await browser.close();

if (!pngDataUrl) { console.error('카드를 못 그렸다'); process.exit(1); }
if (errors.length) console.log('페이지 오류:', errors.slice(0, 3).join(' | '));

mkdirSync('daily', { recursive: true });
const buf = Buffer.from(pngDataUrl.split(',')[1], 'base64');
writeFileSync('daily/today.png', buf);
writeFileSync(`daily/${day}_today.png`, buf);

const d = new Date(day + 'T00:00:00');
const label = `${d.getMonth() + 1}/${d.getDate()}(${'일월화수목금토'[d.getDay()]})`;
writeFileSync('daily/today.html', `<!DOCTYPE html><html lang="ko"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${label} 오늘 공구 캘린더</title>
<meta property="og:title" content="${label} 오늘 공구 캘린더">
<meta property="og:image" content="https://momcalendar.com/daily/today.png?v=${day}">
<style>body{margin:0;background:#F6F4F9;font-family:-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;text-align:center}
h1{font-size:17px;color:#4A1A78;padding:14px 0 10px;margin:0}
img{width:100%;max-width:540px;display:block;margin:0 auto;border-radius:12px;box-shadow:0 2px 12px rgba(96,32,144,.12)}
p{font-size:12.5px;color:#8A8A8A;padding:12px}</style></head><body>
<h1>${label} 오늘 공구 캘린더</h1>
<img src="./today.png?v=${Date.now()}" alt="${label} 오늘 공구 캘린더">
<p>매일 아침 자동으로 새로 그려집니다 · <a href="https://momcalendar.com">맘캘린더</a></p>
</body></html>`, 'utf8');

console.log(`오늘 카드 완성: daily/today.png (${(buf.length / 1024).toFixed(0)}KB) · 보관본 daily/${day}_today.png`);
