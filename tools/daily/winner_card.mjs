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
import { pwGuard } from './pw_guard.mjs';   // 2026-10-02: 예외·매달림에도 크롬과 임시프로필을 남기지 않는다
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
// --bonus="문구" : 당첨자 위에 강조 띠 한 줄 (2026-10-17 9월 개근 2명 둘 다 증정 「방장이 쏜다」)
const BONUS = (process.argv.find((a) => a.startsWith('--bonus=')) || '').slice(8);
const mLabel = `${Number(M)}월`;
const nextLabel = `${(Number(M) % 12) + 1}월`;

// 출석체크 화면(index.html)의 보상 등급과 같은 값 — 바뀌면 둘 다 고친다
// 11월분(2026-10 카드의 「다음 달」)부터 경품 개편 — 20일↑ 3명 커피 · 25일↑ 2명 다이소 · 개근 1명 맥도날드 버거세트
const NEW_RULES = month >= '2026-10';
const PRIZES_OLD = [
  { img: 'coffee.jpg',  bg: 'linear-gradient(160deg,#EFE6FA,#F7F1FD)', cond: '20일 이상', name: '커피 기프티콘',  how: '추첨 5명' },
  { img: 'daiso.jpg',   bg: 'linear-gradient(160deg,#FCE7F0,#FDF2F8)', cond: '25일 이상', name: '다이소 3천원권', how: '추첨 3명' },
  { img: 'chicken.jpg', bg: 'linear-gradient(160deg,#FFE9D9,#FFF4EC)', cond: '개근',      name: '치킨 or 피자',   how: '추첨 1명' },
];
const PRIZES_NEW = [
  { img: 'coffee.jpg',  bg: 'linear-gradient(160deg,#EFE6FA,#F7F1FD)', cond: '20일 이상', name: '커피 기프티콘',  how: '추첨 3명' },
  { img: 'daiso.jpg',   bg: 'linear-gradient(160deg,#FCE7F0,#FDF2F8)', cond: '25일 이상', name: '다이소 3천원권', how: '추첨 2명' },
  { img: 'burger.jpg',  bg: '#FFFFFF', cond: '개근',      name: '맥도날드 버거세트', how: '추첨 1명' },
];
const PRIZES = NEW_RULES ? PRIZES_NEW : PRIZES_OLD;

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

// ── ② 카드 HTML — 2026-11-05 새 디자인(사장님 「상품명 한 줄 · 심플하고 예쁘게 · 몇 월인지 크게」)
//   색·글자는 디자인 헌법(0-DS) 값: 라일락 #7C54C4 · 글자 #191F28/#4E5968/#8B95A1 · 바탕 흰색·#F6F3FA · 이모지 장식 없음
//   첫 화면 위계: 큰 「10월」 → 「당첨자 발표」 → 한 줄 안내 → 한 줄짜리 명단 → 다음 달 안내
const PZ_TINT = (p) => /치킨|피자|버거/.test(p) ? ['#FFF1E6', '#C25A10'] : /커피/.test(p) ? ['#F3ECE6', '#7A4A2A'] : ['#FDEBEF', '#C2334D'];
const many = rows.length > 5;
const html = `<!DOCTYPE html>
<html lang="ko"><head><meta charset="UTF-8">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.css">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{width:1080px;height:1920px;font-family:'Pretendard','Malgun Gothic',sans-serif}
  #card{width:1080px;height:1920px;position:relative;overflow:hidden;background:linear-gradient(180deg,#F6F3FA 0%,#FFFFFF 46%,#F6F3FA 100%);
    display:flex;flex-direction:column;align-items:center}
  .brand{margin-top:84px;display:flex;align-items:center;gap:12px;font-size:32px;font-weight:800;color:#7C54C4;letter-spacing:-.02em}
  .brand i{width:44px;height:44px;border-radius:13px;background:#7C54C4;display:flex;align-items:center;justify-content:center}
  .brand svg{width:26px;height:26px}
  .mon{margin-top:${many ? 34 : 54}px;font-size:${many ? 250 : 290}px;font-weight:900;line-height:1;color:#7C54C4;letter-spacing:-.06em}
  h1{margin-top:6px;font-size:${many ? 92 : 104}px;font-weight:900;color:#191F28;letter-spacing:-.04em;line-height:1.1}
  .sub{margin-top:22px;font-size:34px;font-weight:600;color:#8B95A1;letter-spacing:-.02em}
  .bonus{width:900px;margin-top:26px;background:#F0E8FB;color:#6B45B3;font-size:30px;font-weight:800;
    padding:20px 32px;border-radius:22px;text-align:center;line-height:1.45;letter-spacing:-.02em}
  .list{margin-top:${many ? 34 : 46}px;width:900px;display:flex;flex-direction:column;gap:${many ? 12 : 16}px}
  .row{background:#fff;border:2px solid #EDE8F3;border-radius:24px;height:${many ? 92 : 112}px;padding:0 34px;display:flex;align-items:center;gap:22px}
  .no{width:48px;height:48px;border-radius:50%;background:#F0E8FB;color:#7C54C4;font-size:26px;font-weight:800;display:flex;align-items:center;justify-content:center;flex:none}
  .nick{font-size:${many ? 38 : 42}px;font-weight:800;color:#191F28;letter-spacing:-.03em;white-space:nowrap}
  .days{font-size:27px;font-weight:600;color:#8B95A1;white-space:nowrap}
  .sp{flex:1}
  .prize{font-size:${many ? 29 : 32}px;font-weight:800;padding:10px 22px;border-radius:999px;white-space:nowrap;letter-spacing:-.02em}
  .sent{margin-top:34px;font-size:28px;color:#8B95A1;font-weight:600}
  .next{margin-top:${many ? 36 : 56}px;width:900px;text-align:center}
  .next-t{font-size:34px;font-weight:800;color:#4E5968;letter-spacing:-.03em}
  .prizes{margin-top:${many ? 20 : 28}px;display:flex;gap:18px}
  .pz{flex:1}
  .pz-img{width:100%;aspect-ratio:${many ? '4/3' : '1/1'};border-radius:22px;overflow:hidden}
  .pz-img img{width:100%;height:100%;object-fit:cover;display:block}
  .pz-c{margin-top:12px;font-size:23px;font-weight:700;color:#7C54C4}
  .pz-n{margin-top:3px;font-size:27px;font-weight:800;color:#191F28;letter-spacing:-.03em;white-space:nowrap}
  .pz-h{margin-top:2px;font-size:22px;color:#8B95A1;font-weight:600}
  .cas{margin-top:14px;font-size:24px;font-weight:600;color:#8B95A1;letter-spacing:-.02em}
  .site{margin-top:${many ? 22 : 34}px;font-size:28px;font-weight:800;color:#7C54C4;letter-spacing:-.02em}
</style></head>
<body><div id="card">
  <div class="brand"><i><svg viewBox="0 0 24 24" fill="#fff"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg></i>맘캘린더</div>
  <div class="mon">${mLabel}</div>
  <h1>당첨자 발표</h1>
  <div class="sub">출석체크 이벤트 · ${rows.length === 3 ? '세 분' : rows.length + '분'}께 드려요</div>
  ${BONUS ? `<div class="bonus">${esc(BONUS).split(String.fromCharCode(92) + 'n').join('<br>')}</div>` : ''}
  <div class="list">
    ${rows.map((r, i) => { const [bg, fg] = PZ_TINT(r.prize); return `<div class="row" style="padding-left:44px">
      <div class="nick">${esc(mask(r.nickname))}</div><div class="days">출석 ${r.days}일</div><div class="sp"></div>
      <div class="prize" style="background:${bg};color:${fg}">${esc(r.prize)}</div>
    </div>`; }).join('')}
  </div>
  ${sentAll ? '<div class="sent">기프티콘은 당첨되신 분들께 모두 보내드렸어요</div>' : ''}
  <div class="next">
    <div class="next-t">${nextLabel}에도 출석체크 하면</div>
    <div class="prizes">
      ${PRIZES.map((p) => `<div class="pz"><div class="pz-img" style="background:${p.bg}"><img src="../prize/${p.img}"${p.img === 'burger.jpg' ? ' style="object-fit:contain;padding:6px"' : ''}></div>
        <div class="pz-c">${p.cond}</div><div class="pz-n">${p.name}</div><div class="pz-h">${p.how}</div></div>`).join('')}
    </div>
    ${NEW_RULES ? '<div class="cas">개근에서 안 뽑히면 자동으로 25일 이상 추첨자 명단으로 넘어가요</div>' : ''}
    <div class="site">매일 출석은 momcalendar.com</div>
  </div>
</div></body></html>`;

fs.mkdirSync(path.join(REPO, 'event'), { recursive: true });
const htmlFile = path.join(REPO, 'scratchpad', `_winner_card_${month}.html`);
fs.writeFileSync(htmlFile, html, 'utf8');

// ── ③ PNG 렌더 (#card 기준 1080×1920)
const png = path.join(REPO, 'event', `${month}-winners.png`);
const guard = pwGuard('당첨자 카드 만들기', 5 * 60e3);
const browser = await chromium.launch().catch(() => chromium.launch({ channel: 'chrome' }));
guard.use(browser);
const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
await page.goto(pathToFileURL(htmlFile).href, { waitUntil: 'networkidle', timeout: 60000 });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(700);
// 🔴 경품 사진이 실제로 떴는지 본다 — 파일이 없으면 빈 칸으로 나간다
const imgOk = await page.evaluate(() => [...document.querySelectorAll('.pz-img img')].every((i) => i.complete && i.naturalWidth > 0));
if (!imgOk) console.log('⚠ 경품 사진 중 안 뜬 게 있다 — prize/*.jpg 를 확인하세요');
await page.locator('#card').screenshot({ path: png, type: 'png' });
await browser.close();
guard.clear();   // 브라우저는 다 썼다 — 뒤쪽 후처리는 제한시간에서 뺀다

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
