// 아침 인스타 카드 만들기 (사장님 지시 2026-08-09)
//
// reelcard.html 을 진짜 브라우저로 열어 카드 PNG 와 캡션을 뽑는다.
// html2canvas 로 그리는 구조라 headless 브라우저가 없으면 재현이 안 된다.
//
//   node tools/daily/make-card.mjs          ← 오늘
//   DAY=2026-08-10 node tools/daily/make-card.mjs
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';

const SITE = 'https://momcalendar.com';
const kstToday = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const day = process.env.DAY?.trim() || kstToday();

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 2400 }, deviceScaleFactor: 1 });

const errors = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 120)));

await page.goto(`${SITE}/reelcard.html?d=${day}&cb=${Date.now()}`, { waitUntil: 'networkidle', timeout: 60000 });

// 캡션이 채워질 때까지 기다린다(데이터 로딩 완료 신호)
await page.waitForFunction(() => {
  const t = document.getElementById('captxt');
  return t && t.value && t.value.length > 200;
}, { timeout: 60000 });

const info = await page.evaluate(() => {
  const cap = document.getElementById('captxt').value;
  const st  = (document.getElementById('st')?.textContent || '').replace(/\s+/g, ' ').trim();
  const lab = (document.getElementById('caplen')?.textContent || '').trim();
  return { cap, st, lab };
});

// 카드 PNG — reelcard 의 savePng 와 똑같은 조건으로 그린다
// (mini 해제 + clean 으로 가이드선 끄기 + 1080×1920 고정. 하나라도 다르면 다른 그림이 나온다)
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
const b64 = pngDataUrl.split(',')[1];
writeFileSync(`daily/${day}.png`, Buffer.from(b64, 'base64'));
writeFileSync(`daily/${day}.txt`, info.cap, 'utf8');

// 폰에서 바로 저장·복사할 수 있는 페이지
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const d = new Date(day + 'T00:00:00');
const label = `${d.getMonth() + 1}월 ${d.getDate()}일(${'일월화수목금토'[d.getDay()]})`;
const html = `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${label} 인스타 카드 | 맘캘린더</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Malgun Gothic",sans-serif;background:#F6F3FA;color:#241C2E;padding:0 0 40px}
.hd{background:linear-gradient(135deg,#4A2B7A,#7B3FB5);color:#fff;padding:20px 16px}
.hd h1{font-size:20px}.hd p{font-size:12.5px;opacity:.9;margin-top:4px}
.wrap{max-width:560px;margin:0 auto;padding:0 14px}
.card{background:#fff;border:1px solid #E9E2F2;border-radius:14px;padding:12px;margin-top:14px}
img{width:100%;border-radius:10px;display:block}
textarea{width:100%;height:260px;border:1px solid #E3DCEF;border-radius:10px;padding:11px;font-size:12.5px;font-family:inherit;line-height:1.6;resize:vertical}
.btn{display:block;width:100%;text-align:center;background:#5B2E8C;color:#fff;border:none;border-radius:11px;padding:14px;font-size:14.5px;font-weight:800;margin-top:9px;text-decoration:none;cursor:pointer;font-family:inherit}
.btn2{background:#fff;color:#5B2E8C;border:1.5px solid #5B2E8C}
.meta{font-size:12px;color:#8B82A0;margin-top:8px}
</style></head><body>
<div class="hd"><div class="wrap"><h1>${label} 인스타 카드</h1><p>${esc(info.st)}</p></div></div>
<div class="wrap">
  <div class="card"><img src="./${day}.png" alt="오늘 공구 카드"></div>
  <a class="btn" href="./${day}.png" download="momcal_${day.replace(/-/g,'')}.png">사진 저장</a>
  <div class="card">
    <textarea id="cap" readonly>${esc(info.cap)}</textarea>
    <div class="meta">${esc(info.lab)}</div>
    <button class="btn btn2" onclick="cp()">캡션 복사</button>
  </div>
</div>
<script>
function cp(){
  var t=document.getElementById('cap');
  navigator.clipboard.writeText(t.value).then(function(){ alert('캡션을 복사했어요'); })
   .catch(function(){ t.removeAttribute('readonly'); t.select(); document.execCommand('copy'); alert('캡션을 복사했어요'); });
}
</script></body></html>`;
writeFileSync(`daily/${day}.html`, html, 'utf8');
writeFileSync('daily/index.html',
  `<!DOCTYPE html><meta charset="UTF-8"><meta http-equiv="refresh" content="0;url=./${day}.html">`, 'utf8');

console.log(`카드 생성 완료: ${day} · 캡션 ${info.cap.length}자 · ${info.st}`);
