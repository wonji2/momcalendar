// 출석체크 당첨자 발표 카드 + 공유 페이지 만들기 (사장님 지시 2026-09-22 "/당첨자 스킬로 저장해놔")
//
//   node tools/daily/winner_card.mjs 2026-08          ← 그 달 것을 뽑는다
//   node tools/daily/winner_card.mjs                  ← 지난달 (달이 바뀐 직후에 쓰는 기본값)
//   node tools/daily/winner_card.mjs 2026-08 --dry    ← 파일만 만들고 배포는 안 함(기본도 배포는 안 한다)
//
// 만드는 것
//   event/<YYYY-MM>-winners.png   1080×1920 카드
//   event/<YYYY-MM>.html          공유용 페이지 (og:image 로 카톡에 카드가 크게 뜬다)
//
// 🔴 지켜야 할 것 (사장님이 정한 것)
//   · 닉네임은 **가운데를 가린다** — 3글자면 이*영, 4글자 이상이면 가운데 전부. 한 글자는 가릴 데가 없어 그대로.
//   · 경품은 **실제로 보낸 것**을 쓴다. DB prize 가 실제와 다르면 DB 부터 고치고 뽑는다(2026-08 에 한 건 어긋나 있었다).
//   · 전화번호는 절대 넣지 않는다. (발송 체크를 누르면 DB 에서도 지워진다)
//   · 하단 경품 3종은 **출석체크 화면이 쓰는 같은 파일**(prize/*.jpg)을 쓴다 — 화면과 어긋나지 않게.
//     경품·조건이 바뀌면 index.html 의 보상 등급표를 고치고 여기 PRIZES 도 같이 고친다.
//   · 그림 파일에는 링크를 못 심는다 → 공유는 **페이지 주소**로 한다(사장님 질문 2026-09-22).
//
// 배포: 이 도구는 파일만 만든다. 라이브는 사장님이 "올려" 하실 때 커밋·푸시한다(규칙 0-A).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import { parseRows } from './sb_query.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = process.env.SUPABASE_CLI || 'C:/Users/FAMILY/supabase-cli/supabase.exe';

// 지난달을 기본값으로 (달이 바뀌고 나서 뽑는 게 보통이다)
const kst = () => new Date(Date.now() + 9 * 3600e3);
function defaultMonth() {
  const d = kst(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 7);
}
const month = (process.argv[2] && /^\d{4}-\d{2}$/.test(process.argv[2])) ? process.argv[2] : defaultMonth();
const [Y, M] = month.split('-');
const mLabel = `${Number(M)}월`;
const nextLabel = `${(Number(M) % 12) + 1}월`;

// 출석체크 화면(index.html)의 보상 등급과 같은 값 — 바뀌면 둘 다 고친다
const PRIZES = [
  { img: 'coffee.jpg',  bg: 'linear-gradient(160deg,#EFE6FA,#F7F1FD)', cond: '20일 이상', name: '커피 기프티콘',  how: '추첨 5명' },
  { img: 'daiso.jpg',   bg: 'linear-gradient(160deg,#FCE7F0,#FDF2F8)', cond: '25일 이상', name: '다이소 3천원권', how: '추첨 3명' },
  { img: 'chicken.jpg', bg: 'linear-gradient(160deg,#FFE9D9,#FFF4EC)', cond: '개근',      name: '치킨 or 피자',   how: '추첨 1명' },
];

// 닉네임 가리기 — 사장님 지시 2026-09-22
const mask = (s) => {
  const t = String(s || '').trim();
  if (t.length <= 1) return t;                       // 한 글자는 가릴 데가 없다
  if (t.length === 2) return t[0] + '*';
  return t[0] + '*'.repeat(t.length - 2) + t[t.length - 1];
};
const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ── ① 당첨자 읽기
const sqlFile = path.join(REPO, 'scratchpad', `_winner_${month}.sql`);
fs.mkdirSync(path.dirname(sqlFile), { recursive: true });
fs.writeFileSync(sqlFile, `select nickname, days, prize, (sent_at is not null) as sent
from attendance_winners where month = '${month}-01' order by days desc, id;`, 'utf8');
const raw = execFileSync(CLI, ['db', 'query', '--linked', '--file', path.relative(REPO, sqlFile).split(path.sep).join('/')],
  { cwd: REPO, encoding: 'utf8', timeout: 120000, stdio: ['ignore', 'pipe', 'pipe'] });
const got = parseRows(raw);
if (!got.ok) { console.error('당첨자 조회 실패'); process.exit(1); }
const rows = got.rows || [];
if (!rows.length) { console.error(`${month} 당첨자가 없습니다 — 추첨을 먼저 하세요(관리자 → 💜 출석·추첨)`); process.exit(1); }
const sentAll = rows.every((r) => r.sent === true || r.sent === 't');
console.log(`${month} 당첨자 ${rows.length}명 · 발송 ${sentAll ? '완료' : '미완료 있음'}`);
for (const r of rows) console.log(`   ${mask(r.nickname)} (${r.days}일) — ${r.prize}`);

// ── ② 카드 HTML
const MEDAL_BG = ['#FFF0F6', '#F4EEFF', '#FFF6E8'];
const html = `<!DOCTYPE html>
<html lang="ko"><head><meta charset="UTF-8">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.css">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{width:1080px;height:1920px;font-family:'Pretendard','Malgun Gothic',sans-serif}
  #card{width:1080px;height:1920px;position:relative;overflow:hidden;
    background:linear-gradient(160deg,#FFF1F6 0%,#F8EEFF 52%,#F2EEFF 100%);
    display:flex;flex-direction:column;align-items:center}
  .blob{position:absolute;border-radius:50%;filter:blur(2px);opacity:.5}
  .b1{width:420px;height:420px;background:#FBDCEA;top:-120px;left:-120px}
  .b2{width:340px;height:340px;background:#E6DCFB;bottom:180px;right:-110px}
  .brand{display:flex;align-items:center;gap:14px;margin-top:78px;z-index:2}
  .brand .ico{width:60px;height:60px;border-radius:16px;background:linear-gradient(135deg,#B57BE0,#8C5FD6);
    display:flex;align-items:center;justify-content:center;font-size:32px}
  .brand .nm{font-size:34px;font-weight:800;color:#4A1A78;letter-spacing:-.5px}
  .ribbon{margin-top:36px;background:#C2417A;color:#fff;font-size:27px;font-weight:800;
    padding:14px 36px;border-radius:999px;z-index:2}
  h1{margin-top:24px;font-size:86px;font-weight:900;color:#2A1D4E;letter-spacing:-3px;line-height:1.08;text-align:center;z-index:2}
  .sub{margin-top:16px;font-size:29px;color:#7A6E92;font-weight:600;text-align:center;line-height:1.55;z-index:2}
  .list{margin-top:46px;width:840px;display:flex;flex-direction:column;gap:18px;z-index:2}
  .row{background:#fff;border-radius:28px;padding:28px 36px;display:flex;align-items:center;gap:28px;
    box-shadow:0 6px 26px rgba(120,60,150,.10)}
  .medal{width:80px;height:80px;border-radius:26px;display:flex;align-items:center;justify-content:center;font-size:46px;flex:none}
  .who{flex:1;min-width:0}
  .nick{font-size:42px;font-weight:800;color:#232326;letter-spacing:-1px}
  .days{font-size:27px;color:#9A93A6;font-weight:600;margin-top:7px}
  .prize{font-size:30px;font-weight:800;color:#C2417A;text-align:right;line-height:1.4;flex:none;max-width:250px}
  .sent{margin-top:40px;font-size:27px;color:#8A8395;font-weight:600;z-index:2}
  .next{margin-top:56px;width:900px;background:rgba(255,255,255,.82);border:2px solid #EFE2F6;
    border-radius:34px;padding:40px 34px 36px;text-align:center;z-index:2}
  .next-t{font-size:37px;font-weight:900;color:#4A1A78;letter-spacing:-1px}
  .prizes{margin-top:30px;display:flex;gap:20px;justify-content:center}
  .pz{flex:1}
  .pz-img{width:100%;aspect-ratio:1/1;border-radius:26px;overflow:hidden;display:flex;align-items:center;justify-content:center}
  .pz-img img{width:100%;height:100%;object-fit:cover}
  .pz-c{margin-top:14px;font-size:24px;font-weight:800;color:#C2417A}
  .pz-n{margin-top:5px;font-size:26px;font-weight:800;color:#232326;letter-spacing:-.8px}
  .pz-h{margin-top:4px;font-size:22px;color:#9A93A6;font-weight:600}
  .site{margin-top:28px;font-size:27px;font-weight:800;color:#7B68EE}
</style></head>
<body><div id="card">
  <div class="blob b1"></div><div class="blob b2"></div>
  <div class="brand"><div class="ico">💜</div><div class="nm">맘캘린더</div></div>
  <div class="ribbon">${mLabel} 출석체크 이벤트</div>
  <h1>당첨자 발표</h1>
  <div class="sub">${mLabel} 한 달 매일 출석해주신 분들 중<br>${rows.length === 3 ? '세 분' : rows.length + '명'}을 뽑았어요</div>
  <div class="list">
    ${rows.map((r, i) => `<div class="row">
      <div class="medal" style="background:${MEDAL_BG[i % 3]}">🎀</div>
      <div class="who"><div class="nick">${esc(mask(r.nickname))}</div><div class="days">${mLabel} 출석 ${r.days}일</div></div>
      <div class="prize">${esc(r.prize).replace(/\s+/, '<br>')}</div>
    </div>`).join('')}
  </div>
  ${sentAll ? '<div class="sent">기프티콘은 당첨되신 분들께 모두 보내드렸어요 💌</div>' : ''}
  <div class="next">
    <div class="next-t">${nextLabel}에도 출석체크 하면 🎁</div>
    <div class="prizes">
      ${PRIZES.map((p) => `<div class="pz"><div class="pz-img" style="background:${p.bg}"><img src="../prize/${p.img}"></div>
        <div class="pz-c">${p.cond}</div><div class="pz-n">${p.name}</div><div class="pz-h">${p.how}</div></div>`).join('')}
    </div>
    <div class="site">매일 출석은 momcalendar.com</div>
  </div>
</div></body></html>`;

fs.mkdirSync(path.join(REPO, 'event'), { recursive: true });
const htmlFile = path.join(REPO, 'scratchpad', `_winner_card_${month}.html`);
fs.writeFileSync(htmlFile, html, 'utf8');

// ── ③ PNG 렌더 (#card 기준 1080×1920)
const png = path.join(REPO, 'event', `${month}-winners.png`);
const browser = await chromium.launch().catch(() => chromium.launch({ channel: 'chrome' }));
const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
await page.goto(pathToFileURL(htmlFile).href, { waitUntil: 'networkidle', timeout: 60000 });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(700);
// 🔴 경품 사진이 실제로 떴는지 본다 — 파일이 없으면 빈 칸으로 나간다
const imgOk = await page.evaluate(() => [...document.querySelectorAll('.pz-img img')].every((i) => i.complete && i.naturalWidth > 0));
if (!imgOk) console.log('⚠ 경품 사진 중 안 뜬 게 있다 — prize/*.jpg 를 확인하세요');
await page.locator('#card').screenshot({ path: png, type: 'png' });
await browser.close();

// ── ④ 공유 페이지 (그림엔 링크를 못 심으니 페이지를 한 겹 둔다)
const utm = (m) => `https://momcalendar.com/?utm_source=event&utm_medium=${m}&utm_campaign=${month}-winners`;
fs.writeFileSync(path.join(REPO, 'event', `${month}.html`), `<!DOCTYPE html>
<html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${mLabel} 출석체크 당첨자 발표 · 맘캘린더</title>
<meta property="og:type" content="website">
<meta property="og:title" content="${mLabel} 출석체크 당첨자 발표 🎉">
<meta property="og:description" content="${nextLabel}에도 출석하면 커피·다이소·치킨 기프티콘을 드려요. 맘캘린더에서 매일 출석체크하세요.">
<meta property="og:image" content="https://momcalendar.com/event/${month}-winners.png">
<meta property="og:url" content="https://momcalendar.com/event/${month}.html">
<meta name="twitter:card" content="summary_large_image">
<style>*{margin:0;padding:0;box-sizing:border-box}
body{background:#F6F4F9;font-family:-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;display:flex;flex-direction:column;align-items:center;padding:0 0 28px}
.wrap{width:100%;max-width:540px}
a.card{display:block}a.card img{width:100%;display:block}
.go{display:block;margin:16px 14px 0;padding:17px;background:#7B68EE;color:#fff;text-align:center;border-radius:14px;font-size:16px;font-weight:800;text-decoration:none;box-shadow:0 4px 14px rgba(123,104,238,.28)}
.sub{display:block;margin:10px 14px 0;padding:14px;background:#fff;color:#6D6579;text-align:center;border-radius:13px;font-size:14px;font-weight:700;text-decoration:none;border:1.5px solid #EDE8F5}
.note{margin:18px 16px 0;font-size:12px;color:#9A93A6;text-align:center;line-height:1.75}</style></head>
<body><div class="wrap">
  <a class="card" href="${utm('card')}"><img src="./${month}-winners.png" alt="${mLabel} 출석체크 당첨자 발표"></a>
  <a class="go" href="${utm('button')}">💜 출석체크 하러 가기</a>
  <a class="sub" href="https://cafe.naver.com/momcal">공구·핫딜 같이 보는 네이버 카페</a>
  <div class="note">${sentAll ? '당첨되신 분들께는 기프티콘을 모두 보내드렸어요.<br>' : ''}${nextLabel} 출석체크도 진행 중이에요 🎁</div>
</div></body></html>`, 'utf8');

console.log(`\n카드  event/${month}-winners.png (${(fs.statSync(png).size / 1024).toFixed(0)}KB)`);
console.log(`페이지 event/${month}.html`);
console.log(`\n올리려면: git add event/${month}.html event/${month}-winners.png && git commit && git push`);
console.log(`올린 뒤 주소: https://momcalendar.com/event/${month}.html`);
