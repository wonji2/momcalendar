// 아침 인스타 카드 만들기 (사장님 지시 2026-08-09)
//
// reelcard.html 을 진짜 브라우저로 열어 카드 PNG 와 캡션을 뽑는다.
// html2canvas 로 그리는 구조라 headless 브라우저가 없으면 재현이 안 된다.
//
//   node tools/daily/make-card.mjs          ← 오늘
//   DAY=2026-08-10 node tools/daily/make-card.mjs
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';

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

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const d = new Date(day + 'T00:00:00');
const label = `${d.getMonth() + 1}월 ${d.getDate()}일(${'일월화수목금토'[d.getDay()]})`;

// ── 네이버 블로그 초안 (사장님 지시 2026-08-12: blog.naver.com/momcal 에 매일 1건) ──
// 글쓰기 API 가 2020년에 종료돼 발행은 사장님이 폰에서 붙여넣는다. 여기선 복붙 세트만 만든다.
// 검색 실측 근거: 사람들은 "공구일정"(붙임)·"인스타 공구"·"브랜드명+공구" 로 검색한다.
const SB = 'https://hycaqsqeogjtbscmzrtm.supabase.co/rest/v1';
const SB_KEY = 'sb_publishable_u4hR4mdNTSss3kdjFH6R5Q_iuJ2MuGE';
const rest = (p) => fetch(`${SB}/gonggu?${p}`, { headers: { apikey: SB_KEY } }).then((r) => r.json());
// 블로그 초안이 실패해도 카드는 살아야 한다 → 실패 시 빈 목록으로 계속
let opens = [], closes = [];
try {
  opens  = await rest(`select=name,influencer,insta,major,end_date&approved=eq.true&open_date=eq.${day}&order=major.asc,name.asc`);
  closes = await rest(`select=name,influencer,insta&approved=eq.true&end_date=eq.${day}&order=name.asc`);
  if (!Array.isArray(opens))  opens  = [];
  if (!Array.isArray(closes)) closes = [];
} catch (e) { console.log('블로그용 REST 실패:', String(e).slice(0, 120)); }

const seller = (g) => g.influencer || g.insta || '';
const mmdd = (s) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s)) ? `${+s.slice(5, 7)}/${+s.slice(8, 10)}` : '';
// 상품명 첫 토큰에서 브랜드 후보를 뽑는다. 일반명사·수식어는 제외 (제목·태그용 3개면 충분)
const BRAND_STOP = new Set(['국민','만능','오늘','미니','역시즌','특가','신상','베스트','국산','유아','아기','키즈',
  '시그니처','프리미엄','여름','겨울','간식','분리수거함','목욕놀이','새치컷팅기','고구마','돌반지','가족여행']);
const brandOf = (n) => {
  const t = (String(n).replace(/[^\p{L}\p{N} ]/gu, ' ').trim().split(/\s+/)[0] || '');
  return (t.length >= 2 && t.length <= 7 && !BRAND_STOP.has(t) && !/^\d/.test(t)) ? t : '';
};
const brands = [...new Set(opens.map((o) => brandOf(o.name)).filter(Boolean))].slice(0, 8);   // 브랜드+공구가 실제 유입 검색어 — 8개 나열 (사장님 지시)

// ── 브랜드+제품어 (사장님 지시 2026-08-27: A+B 조합 — "무아스 디스펜서 공구"형이 실제 유입) ──
// 앞쪽 브랜드 2개에만 상품명 둘째 낱말을 붙인다. 8개 전부 붙이면 제목이 넘쳐 뒷브랜드가 잘린다.
const PROD_STOP = /^(세트|모음전|모음|기획전|골라담기|특가|공구|오픈|외|신상|국산|프리미엄|시그니처)$/;
const prodWordOf = (brand) => {
  const o = opens.find((x) => brandOf(x.name) === brand);
  if (!o) return '';
  const toks = String(o.name).replace(/[^\p{L}\p{N} ]/gu, ' ').trim().split(/\s+/).slice(1);
  const w = toks.find((t) => t.length >= 2 && t.length <= 6 && !BRAND_STOP.has(t) && !PROD_STOP.test(t) && !/^\d/.test(t));
  return w || '';
};
// 제목이 넘치면(58자) ①뒷브랜드부터 떨구고(최소 4개) ②그래도 넘치면 제품어를 뗀다
const brandLine = (n, withProd) => brands.slice(0, n).map((b, i) => {
  if (withProd && i < 2) { const w = prodWordOf(b); if (w && (b + w).length <= 11) return `${b} ${w}`; }
  return b;
}).join('·');

// 제목 조합 엔진 (사장님 지시 2026-08-12): 고정 템플릿 대신 키워드 풀(head×tail×audience) 조합 — 수백 가지.
// 풀은 tools/daily/blog_keywords.json — serp_check 로그 보고 잘 걸리는 키워드를 위로 올리면 제목이 진화한다.
// 날짜 시드 LCG 라 같은 날을 다시 생성해도 제목이 같다(재생성 안전). 앞쪽 키워드가 뽑힐 확률이 높다(순서=가중치).
const KW = JSON.parse(readFileSync('tools/daily/blog_keywords.json', 'utf8'));
let _seed = d.getFullYear() * 372 + (d.getMonth() + 1) * 31 + d.getDate();
const rnd = () => { _seed = (_seed * 1103515245 + 12345) % 2147483648; return _seed / 2147483648; };
const pick = (arr) => arr[Math.floor(Math.pow(rnd(), 1.6) * arr.length)];   // 지수로 앞쪽 편향

// "8월 공구일정" 류 시즌 키워드는 실제 유입 패턴 — 두 번째 가중치로 끼워 넣는다
const heads = [KW.head[0], `${d.getMonth() + 1}월 공구일정`, ...KW.head.slice(1)];
const head = pick(heads), tailRaw = pick(KW.tail), aud = pick(KW.audience);
const tail = tailRaw.replace(/^공구\s*/, '');   // 앞말이 늘 '공구…'라 "공구일정 공구하는 곳" 중복 방지
const audSp = aud ? `${aud} ` : '';
// 모든 프레임에 head(공구일정 계열)가 반드시 들어간다 — 핵심 검색어 보장 (사장님 지시 2026-08-12)
// 2026-08-27 A+B 조합(사장님 지시): head 계열을 항상 제목 앞쪽에 두고(검색결과는 앞 ~30자만 보인다),
// 브랜드 자리엔 앞 2개에 제품어를 붙인다. 넘치면 뒷브랜드부터 떨궈 58자 안에 맞춘다.
const FRAMES = [
  (b) => `${label} ${audSp}${head} ${tail} | ${b} 공구 오픈`,
  (b) => `${label} ${audSp}${head} | ${b} 공구 ${tail}`,
  (b) => `${label} ${audSp}${head} ${tail} | ${b} 공구 오픈`,
  // 🔴 2026-08-19 수정: 이 틀만 brands[0] 하나만 쓰고 나머지 7개를 버렸다.
  //   틀 모양(변화용)은 살리되 브랜드는 전부 싣는다.
  (b) => `${label} ${(head.includes('오늘') || head.includes('오픈')) ? '' : '오늘 오픈 '}${audSp}${head} ${tail} | ${b} 공구 외`,
];
let blogTitle = '';
if (brands.length) {
  const frame = FRAMES[Math.floor(rnd() * FRAMES.length)];
  const nMin = Math.min(4, brands.length);
  const tries = [];
  for (const withProd of [true, false])
    for (let n = brands.length; n >= nMin; n--) tries.push([n, withProd]);
  for (const [n, withProd] of tries) {
    blogTitle = frame(brandLine(n, withProd)).replace(/\s+/g, ' ').trim();
    if (blogTitle.length <= 58) break;
  }
} else {
  blogTitle = `${label} ${audSp}${head} ${tail} | 오늘 오픈 공구`.replace(/\s+/g, ' ').trim();
}
const MAJOR_ORDER = ['육아', '리빙', '식품', '건강', '뷰티', '가전', '패션', '여행', '인테리어', '반려동물'];
const byMajor = MAJOR_ORDER.map((m) => [m, opens.filter((o) => o.major === m)]).filter(([, a]) => a.length);
const etc = opens.filter((o) => !MAJOR_ORDER.includes(o.major));
if (etc.length) byMajor.push(['기타', etc]);

// 해시태그를 본문 끝에 넣으면 네이버 에디터가 태그로 인식한다 → 본문 한 번 복사로 태그까지 해결
const blogTags = ['공구일정', '인스타공구', '인스타공구일정', '공동구매', '오늘의공구', '육아공구', '육아템', '공구모음',
  ...brands.map((b) => `${b}공구`)].map((t) => `#${t}`).join(' ');

// ── 오늘의 브랜드 꼭지 (사장님 지시 2026-08-14) ──
// "OO 공구 가격·정품·차이" 같은 정보성 검색은 네이버 블로그가 잘 받는다(자동완성 실측).
// ⚠ 진행 횟수·셀러 수 같은 집계 수치는 넣지 않는다 — 사장님이 파는 데이터 자산(2026-08-11 지시).
let brandStory = [];
try {
  const b = brands[0];
  if (b) {
    const hist = await rest(`select=name,influencer,insta,open_date&approved=eq.true&name=like.${encodeURIComponent(b)}*&order=open_date.desc&limit=60`);
    const hs = Array.isArray(hist) ? hist : [];
    const recentSellers = [...new Set(hs.map(seller).filter(Boolean))].slice(0, 3);
    // 🔴 2026-08-19 사장님 지시: "여기 들어가는 링크는 뭐든지 걍 맘캘 메인 홈페이지 링크로"
    //   예전엔 브랜드 페이지(/g/데코아르.html)로 보냈는데
    //     · 슬러그가 이름과 다르면 404 로 빠지고
    //     · 한글이 인코딩돼 주소가 흉하게 길어진다(%EB%8D%B0%EC%BD%94...)
    //     · 손님은 메인에서 검색하면 어차피 다 찾는다 — 브랜드 검색도 붙어 있다
    //   → 본문에 나가는 링크는 **전부 메인 홈**으로 통일한다.
    const bLink = 'https://momcalendar.com';
    if (hs.length >= 2 && recentSellers.length) {
      brandStory = [
        ``,
        `■ 오늘의 브랜드: ${b}`,
        `· ${b} 공구는 인스타 셀러들이 기간을 정해 여는 공동구매예요. 최근에는 ${recentSellers.join(', ')} 님이 진행했어요.`,
        `· 가격은 오픈일에 셀러 계정 공지로 공개돼요. 같은 제품이라도 셀러·구성에 따라 조금씩 달라서, 공지에서 확인하는 게 가장 정확해요.`,
        `· 이번에 놓쳤다면 너무 아쉬워하지 마세요. ${b} 공구는 보통 일정 간격을 두고 다시 열려요. 전체 일정은 여기서 → ${bLink}`,
      ];
    }
  }
} catch (e) { console.log('브랜드 꼭지 생략:', String(e).slice(0, 80)); }

const blogBody = [
  // 전부 클릭되는 링크로. 네이버 에디터는 맨 위 URL(맘캘린더)만 카드로 펼치고 나머지는 텍스트 링크가 된다 (사장님 확인 2026-08-12)
  `맘캘린더 채널 한눈에`,
  `· 전체 공구 일정 실시간 검색 → https://momcalendar.com`,
  `· 네이버카페 → https://cafe.naver.com/momcal`,
  `· 인스타그램 → https://www.instagram.com/momcal_`,
  ``,
  `· 오늘 공구 중인 링크 → https://link.inpock.co.kr/momcal`,
  ``,
  `· 카톡 공지방(공구 알림) → https://open.kakao.com/o/gJ3NIKCh`,
  `· 카톡 수다방 → https://open.kakao.com/o/gr2kJhCh`,
  `─────────────`,
  ``,
  `${label}, 오늘 새로 오픈하는 인스타 공구일정 ${opens.length}건을 카테고리별로 정리했어요.`,
  `오늘 마감되는 공구도 ${closes.length}건 있으니 놓치지 마세요.`,
  ``,
  `(여기에 저장해 두신 카드 사진을 넣어주세요)`,
  ``,
  `■ 오늘 오픈하는 공구 ${opens.length}건`,
  ...byMajor.flatMap(([m, arr]) => [``, `[${m}]`,
    ...arr.map((o) => `· ${o.name} — ${seller(o)}${mmdd(o.end_date) ? ` (~${mmdd(o.end_date)} 마감)` : ''}`)]),
  ``,
  `■ 오늘 마감하는 공구 ${closes.length}건`,
  ...closes.map((o) => `· ${o.name} — ${seller(o)}`),
  ...brandStory,
  ``,
  `※ 공구 일정은 판매자 사정에 따라 변경되거나 조기 마감될 수 있어요. 구매 전에 해당 셀러 계정에서 한 번 더 확인해 주세요.`,
  ``,
  blogTags,
].join('\n');

writeFileSync(`daily/${day}_blog.txt`, `${blogTitle}\n\n${blogBody}`, 'utf8');

// 폰에서 바로 저장·복사할 수 있는 페이지
// 사장님께 아침에 알릴 것. 매일 아침 이 페이지를 여시니 여기 띄우는 게 가장 확실하다.
// 처리되면 이 상수를 비워 두면 사라진다. (todo/README 로 관리하지 않는 이유: 파일이 늘면 안 본다)
const TODO = {
  until: '2026-08-20',
  title: '링크프라이스 · 오늘의집 제휴 신청 (각 5분)',
  body: `핫딜을 우리 수익링크로 바꿀 수 있는 곳을 늘리는 일입니다.<br>
    ① <b>링크프라이스</b> 로그인 → 머천트 검색 → <b>오늘의집·SSG</b> 제휴 신청
    (지마켓·옥션·11번가·보리보리는 이미 열려 있습니다. 오늘의집은 "승인되지 않은 링크"로 막혀 있어요)<br>
    ② <b>오늘의집 큐레이터</b> → 정산 정보가 아직 <b>미등록</b>이라 리워드가 지급되지 않습니다.
    <a href="https://ohou.se/curator/activity" target="_blank">ohou.se/curator/activity</a> 하단에서 등록해 주세요.<br>
    ③ 오늘의집 상품 아무거나 <b>공유 → 링크 복사</b> 한 번만 해서 보내주시면,
    그 형식을 보고 자동 변환을 붙이겠습니다.`,
};
const todoHtml = (TODO.title && day <= TODO.until)
  ? `<div class="todo"><b>사장님 확인 부탁드려요 · ${TODO.title}</b><p>${TODO.body}</p></div>`
  : '';
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
.todo{background:#FFF8E6;border:1.5px solid #F0DFA8;border-radius:14px;padding:14px 15px;margin-top:14px}
.todo b{color:#8A6A2E;font-size:14px}
.todo p{font-size:12.5px;color:#6B6379;line-height:1.75;margin-top:6px}
.todo a{color:#5B2E8C;font-weight:700}
</style></head><body>
<div class="hd"><div class="wrap"><h1>${label} 인스타 카드</h1><p>${esc(info.st)}</p></div></div>
<div class="wrap">
  ${todoHtml}
  <div class="card"><img src="./${day}.png" alt="오늘 공구 카드"></div>
  <a class="btn" href="./${day}.png" download="momcal_${day.replace(/-/g,'')}.png">사진 저장</a>
  <div class="card">
    <textarea id="cap" readonly>${esc(info.cap)}</textarea>
    <div class="meta">${esc(info.lab)}</div>
    <button class="btn btn2" onclick="cp('cap','캡션')">캡션 복사</button>
  </div>
  <div class="card">
    <div class="meta" style="margin:0 0 8px;font-weight:800;color:#5B2E8C">네이버 블로그용 (blog.naver.com/momcal) — 수정해서 쓰셔도 돼요</div>
    <textarea id="btitle" style="height:54px">${esc(blogTitle)}</textarea>
    <button class="btn btn2" onclick="cp('btitle','블로그 제목')">블로그 제목 복사</button>
    <textarea id="bbody" style="margin-top:9px">${esc(blogBody)}</textarea>
    <button class="btn" onclick="cp('bbody','블로그 본문 전체')">블로그 본문 전체 복사 (태그 포함)</button>
    <div class="meta">순서: 사진 저장 → 블로그 앱 글쓰기 → 제목 붙여넣기 → 본문 붙여넣기 → (여기에 카드 사진) 자리에 사진 → 발행. 끝의 #태그들은 자동으로 태그가 돼요</div>
  </div>
</div>
<script>
function cp(id,label){
  var t=document.getElementById(id);
  navigator.clipboard.writeText(t.value).then(function(){ alert(label+'을(를) 복사했어요'); })
   .catch(function(){ t.removeAttribute('readonly'); t.select(); document.execCommand('copy'); alert(label+'을(를) 복사했어요'); });
}
</script></body></html>`;
writeFileSync(`daily/${day}.html`, html, 'utf8');
writeFileSync('daily/index.html',
  `<!DOCTYPE html><meta charset="UTF-8"><meta http-equiv="refresh" content="0;url=./${day}.html">`, 'utf8');

console.log(`카드 생성 완료: ${day} · 캡션 ${info.cap.length}자 · ${info.st}`);
