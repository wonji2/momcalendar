// 아침 인스타 카드 만들기 (사장님 지시 2026-08-09)
//
// reelcard.html 을 진짜 브라우저로 열어 카드 PNG 와 캡션을 뽑는다.
// html2canvas 로 그리는 구조라 headless 브라우저가 없으면 재현이 안 된다.
//
//   node tools/daily/make-card.mjs          ← 오늘
//   DAY=2026-08-10 node tools/daily/make-card.mjs
import { chromium } from 'playwright';
import { pwGuard } from './pw_guard.mjs';   // 2026-10-02: 예외·매달림에도 크롬과 임시프로필을 남기지 않는다
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';   // 인기 검색어 굽기(아래) — 아래쪽 동적 import 와 겹쳐도 무해

const SITE = 'https://momcalendar.com';
const kstToday = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const day = process.env.DAY?.trim() || kstToday();

// ⚠ 번들 headless 브라우저 → 없으면 설치된 Chrome 으로 폴백 (browser.js 와 같은 패턴).
//   Claude 앱은 MSIX 패키지라 앱 안에서 `playwright install` 한 브라우저는 AppData\Local 의
//   앱 전용 가상 폴더(Packages\Claude_*\LocalCache\Local\ms-playwright)에만 있고
//   윈도우 예약작업(앱 밖)에서는 "Executable doesn't exist" 로 죽는다 (2026-09-05·06 이틀 블로그 예약 실패).
const guard = pwGuard('공구 카드 만들기', 5 * 60e3);
const browser = await chromium.launch().catch(() => chromium.launch({ channel: 'chrome' }));
guard.use(browser);
const page = await browser.newPage({ viewport: { width: 1200, height: 2400 }, deviceScaleFactor: 1 });

const errors = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 120)));

// 🔴 2026-09-01: reelcard.html → instastudio.html 로 교체 (사장님 지시)
//    "내 계정은 맨날 똑같은 폼이라 조회수가 안 나와" — reelcard 는 시안이 하나뿐이었다
//    (A|B|C 는 글씨 크기만 다름). instastudio 는 요일별 7종 + 캡션 랜덤 엔진을 갖고 있다.
//    월 주간예고 / 화·목 카테고리 / 수 인기TOP10 / 금 주말 / 토 마감임박 / 일 핫딜베스트
await page.goto(`${SITE}/instastudio.html?d=${day}&fmt=auto&cb=${Date.now()}`, { waitUntil: 'networkidle', timeout: 60000 });

// 캡션이 채워질 때까지 기다린다(데이터 로딩 완료 신호)
await page.waitForFunction(() => {
  const t = document.getElementById('captxt');
  return t && t.value && t.value.length > 200;
}, { timeout: 60000 });

// 🔴 캡션이 찼다고 다 그려진 게 아니다 — instastudio 도 그 뒤에 정렬·자체상품 우선 넣기를 끝낸다.
//    스레드 카드가 이 구멍으로 제목·목록이 틀린 채 나갔다(2026-09-30). 카드 안 줄 수가 멈출 때까지 기다린다.
{
  let prev = -1, settled = false;
  for (let t = 1; t <= 8; t++) {
    const n = await page.evaluate(() => document.querySelectorAll('#card .bit-nm, #card .dit-nm, #card .wit-nm, #card .rk-nm').length);
    if (n > 0 && n === prev) { settled = true; break; }
    prev = n; await new Promise((r) => setTimeout(r, 800));
  }
  if (!settled) console.log('⚠ 인스타 카드 줄 수가 계속 바뀐다 — 마지막 값으로 진행');
}
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
guard.clear();   // 브라우저는 다 썼다 — 뒤쪽 후처리는 제한시간에서 뺀다

if (!pngDataUrl) { console.error('카드를 못 그렸다'); process.exit(1); }
if (errors.length) console.log('페이지 오류:', errors.slice(0, 3).join(' | '));

mkdirSync('daily', { recursive: true });
// 🔤 인기 검색어를 먼저 굽는다 — 캡션의 상품 해시태그가 이걸 읽는다 (사장님 2026-09-30)
//   못 구워도 카드는 만든다(페이지가 폴백으로 상품명 앞 낱말을 쓴다)
try { execFileSync(process.execPath, ['tools/daily/search_terms_bake.mjs'], { encoding: 'utf8', timeout: 180e3 }); }
catch (e) { console.log('검색어 굽기 생략:', String(e.message || e).slice(0, 80)); }
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

const seller = (g) => (g.influencer || g.insta || '').trim();
// 🔴 셀러를 모르는 행은 카드·블로그에서 통째로 뺀다 (사장님 지시 2026-09-01)
//    "누가 하는지를 모르는데" — 손님이 어디서 사는지 알 수 없는 줄은 실어봐야 소용이 없다.
//    카페 크롤러 등록분(cafe_crawl.mjs)은 카페 글 제목에 셀러가 없어 insta/influencer 가 빈 문자열이다.
//    ⚠ 걸러낸 뒤에 건수를 세야 한다 — 본문의 "오늘 오픈 N건"이 실제 실린 줄 수와 어긋나면 안 된다.
const droppedNoSeller = opens.filter((g) => !seller(g)).length
                      + closes.filter((g) => !seller(g)).length;
opens  = opens.filter(seller);
closes = closes.filter(seller);
if (droppedNoSeller) console.log(`셀러 미상 ${droppedNoSeller}건 제외 (카드·블로그 양쪽)`);
// 셀러가 없으면 구분자(—)째 생략 — 위 필터가 뚫려도 "상품명 — " 이 나가지 않게 하는 2중 방어
const sellerSuffix = (g) => { const s = seller(g); return s ? ` — ${s}` : ''; };
const mmdd = (s) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s)) ? `${+s.slice(5, 7)}/${+s.slice(8, 10)}` : '';
// 상품명 첫 토큰에서 브랜드 후보를 뽑는다. 일반명사·수식어는 제외 (제목·태그용 3개면 충분)
const BRAND_STOP = new Set(['국민','만능','오늘','미니','역시즌','특가','신상','베스트','국산','유아','아기','키즈',
  '시그니처','프리미엄','여름','겨울','간식','분리수거함','목욕놀이','새치컷팅기','고구마','돌반지','가족여행','부모님','추석선물','명절선물',
  '일본','마그네틱','원목','유기농','국내산','수입','무료','한정','도서','난각번호',
  '카시트','휴대용','스텐','심발기','이유식','비타민','마스크','유아식','단백질','주방','아보카도','이유식용기']);   // 2026-09-28 검증 2차: 일반어 첫 낱말이 검색량 점수를 받던 것   // 2026-09-28: 검색량 정렬로 앞에 나오던 일반어("일본 공구"·"마그네틱 공구") 차단
const brandOf = (n) => {
  const t = (String(n).replace(/[^\p{L}\p{N} ]/gu, ' ').trim().split(/\s+/)[0] || '').replace(/\d+차$/, '').replace(/([가-힣])\d+$/, '$1');   // 회차 잔해 제거("빠이염4차"·"니가드키즈4", 2026-09-28)
  return (t.length >= 2 && t.length <= 7 && !BRAND_STOP.has(t) && !/^\d/.test(t)) ? t : '';
};
// ── 사이트 검색량으로 브랜드 우선순위 (사장님 지시 2026-09-28 "넘버블럭스·미니두두·스트라이더처럼 사이트 안에서 검색량 많은 걸 블로그에 우선 키워드로") ──
//   site_search_stats(30일 집계, pg_cron 새벽 03:20 갱신 · supabase/sql/site_search_stats_65.sql)를 CLI(관리자)로 읽는다.
//   anon 으로는 못 읽는다(검색 횟수는 파는 데이터). CLI 가 없거나 실패하면 검색량 0 으로 두고 기존 순서(오픈 목록 순)로 간다 — 카드·블로그는 살아야 한다.
//   점수 = **브랜드 낱말**과 맞는 검색어의 30일 검색 수(최대). 맞는다 = 검색어가 브랜드와 같다 / 검색어가 브랜드(3자 이상)로 시작한다("망고라이언공구"→망고라이언).
//          상품명 나머지 낱말(퓨레·캐리어·사운드북)은 안 본다 — 그렇게 하면 일반 검색어가 브랜드 점수로 새어 들어간다(2026-09-28 검증 1차: 28개 중 19개 오탐).
//          "브랜드가 검색어로 시작" 규칙도 뺐다 — 검증 2차: 이유식(236)→이유식용기, 비타민→비타민C 가 제목 2위로 올라왔다. 2자 브랜드 접두도 뺐다(마이←마이아).
//   브랜드 순서·제목 앞자리·태그 순서·오늘의 브랜드 꼭지가 이 순서를 따른다.
const siteSearch = await (async () => {
  try {
    const { execFileSync } = await import('node:child_process');
    const { sbArgs, parseRows } = await import('./sb_query.mjs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const CLI = 'C:/Users/FAMILY/supabase-cli/supabase.exe';
    const f = join(tmpdir(), 'mc_site_search.sql');
    writeFileSync(f, 'select term, c30 from public.site_search_stats order by c30 desc limit 600;');
    const out = execFileSync(CLI, sbArgs(f), { encoding: 'utf8', timeout: 60e3, stdio: ['ignore', 'pipe', 'pipe'] });
    const p = parseRows(out);
    if (!p.ok) throw new Error('CLI 출력 못 읽음');
    return p.rows.map((r) => [String(r.term || '').replace(/\s+/g, ''), Number(r.c30) || 0]).filter((x) => x[0].length >= 2);
  } catch (e) { console.log('사이트 검색량 생략(기존 순서로):', String(e.message || e).slice(0, 80)); return []; }
})();
const brandSearchScore = (brand) => {
  const b = String(brand || '').toLowerCase(); let best = 0;
  for (const [t, c] of siteSearch) {
    if (c <= best) continue;
    const hit = t === b || (b.length >= 3 && t.startsWith(b));
    if (hit) best = c;
  }
  return best;
};
// 브랜드별 점수. 점수 같으면 오픈 목록 순(안정 정렬)을 지킨다.
const brandScore = {};
for (const o of opens) { const b = brandOf(o.name); if (!b || b in brandScore) continue; brandScore[b] = brandSearchScore(b); }
const allBrands = [...new Set(opens.map((o) => brandOf(o.name)).filter(Boolean))].sort((a, b) => (brandScore[b] || 0) - (brandScore[a] || 0));
const searchedBrands = allBrands.filter((b) => brandScore[b] > 0);
if (searchedBrands.length) console.log('사이트 검색량 반영 브랜드:', searchedBrands.map((b) => `${b}(${brandScore[b]})`).join(' · '));
const brands = allBrands.slice(0, 8);   // 브랜드+공구가 실제 유입 검색어 — 8개 나열 (사장님 지시). 검색량 많은 브랜드가 앞이다

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
let tail = tailRaw.replace(/^공구\s*/, '');   // 앞말이 늘 '공구…'라 "공구일정 공구하는 곳" 중복 방지
// 🔴 2026-09-14 실제 발행 사고: head "인스타 공구 모음" + tail "모음" → "인스타 공구 모음 모음" 이 그대로 나갔다.
//    head 가 이미 그 꼬리말로 끝나면 꼬리를 뺀다 (모음·사이트 처럼 head 풀과 tail 풀에 같은 말이 있다). 난수 순서는 건드리지 않는다.
//    2026-09-14 확장: head "지금 하는 공구" + tail "하는 곳" → "하는" 이 겹친다. 꼬리의 낱말 하나라도 head 에 있으면 꼬리를 뺀다.
if (tail && tail.split(' ').some((w) => head.split(' ').includes(w))) tail = '';
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
  ...allBrands.slice(0, 22).map((b) => `${b}공구`)].map((t) => `#${t}`).join(' ');   // 네이버 태그 상한 30 = 고정 8 + 브랜드 22 (2026-09-28: 8개→전 브랜드)

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

// ── 매일 다른 글이 되게 (사장님 지시 2026-09-01 "맨날 똑같은 폼이라 조회수가 안 나와") ──
// 날짜를 시드로 고른다 → 같은 날 다시 만들어도 같은 글이 나오고, 날마다는 달라진다.
// instastudio 캡션 엔진과 같은 사상. ⚠ 제목·링크블록·태그는 SEO 자산이라 건드리지 않는다.
const seed = Number(day.replace(/-/g, ''));
const rot = (arr, salt = 0) => arr[(seed + salt) % arr.length];
const dow = new Date(day + 'T00:00:00').getDay();

const OPENERS = [
  `${label}, 오늘 새로 오픈하는 인스타 공구일정 ${opens.length}건을 카테고리별로 정리했어요.`,
  `${label} 공구 일정이에요. 오늘 오픈하는 ${opens.length}건을 한 번에 모았어요.`,
  `${label}, 오늘 문 여는 공동구매 ${opens.length}건이에요. 카테고리별로 보기 좋게 정리했어요.`,
  `${label} 오늘의 공구 소식이에요. 새로 시작하는 ${opens.length}건을 담았어요.`,
  `${label}, 인스타 셀러들이 오늘 여는 공구 ${opens.length}건을 모아왔어요.`,
  `${label} 공구 오픈 소식이에요. 오늘 올라온 ${opens.length}건을 정리해 뒀어요.`,
];
const SUBS = [
  `오늘 마감되는 공구도 ${closes.length}건 있으니 놓치지 마세요.`,
  `오늘 끝나는 공구가 ${closes.length}건이라 아래쪽도 같이 확인해 보세요.`,
  `마감이 오늘인 공구도 ${closes.length}건 있어요. 담아두셨다면 서두르셔야 해요.`,
  `함께 마감 ${closes.length}건도 정리했어요. 놓친 게 없는지 훑어보세요.`,
];
const OPEN_H = [`■ 오늘 오픈하는 공구 ${opens.length}건`, `■ 오늘 새로 열리는 공구 ${opens.length}건`, `■ 오늘 시작하는 공구 ${opens.length}건`];
const CLOSE_H = [`■ 오늘 마감하는 공구 ${closes.length}건`, `■ 오늘 끝나는 공구 ${closes.length}건`, `■ 오늘까지인 공구 ${closes.length}건`];
const OUTROS = [
  `※ 공구 일정은 판매자 사정에 따라 변경되거나 조기 마감될 수 있어요. 구매 전에 해당 셀러 계정에서 한 번 더 확인해 주세요.`,
  `※ 일정과 가격은 셀러 사정으로 바뀔 수 있어요. 결제 전에 셀러 계정 공지를 꼭 다시 확인해 주세요.`,
  `※ 수량이 빨리 소진되면 예정보다 일찍 닫히기도 해요. 관심 있는 공구는 오픈일에 바로 확인하시는 게 좋아요.`,
  `※ 정확한 구성·가격은 셀러 공지 기준이에요. 이 글은 일정 모음이라 참고용으로 봐주세요.`,
];
// 마감이 임박한 날(금·토)엔 마감 목록을 먼저 보여준다 — 그날 급한 정보가 위로.
const closeFirst = (dow === 5 || dow === 6) && closes.length > 0;
const openBlock = [
  rot(OPEN_H, 1),
  ...byMajor.flatMap(([m, arr]) => [``, `[${m}]`,
    ...arr.map((o) => `· ${o.name}${sellerSuffix(o)}${mmdd(o.end_date) ? ` (~${mmdd(o.end_date)} 마감)` : ''}`)]),
];
const closeBlock = [rot(CLOSE_H, 2), ...closes.map((o) => `· ${o.name}${sellerSuffix(o)}`)];

const blogBody = [
  // 🔴 링크 블록은 한 줄에 하나씩, 사이마다 빈 줄 (사장님 지시 2026-09-01)
  //    빈 줄이 없으면 네이버 에디터에서 URL 뒤에 다음 항목이 그대로 붙어버린다
  //    ("…momcalendar.com· 네이버카페 →…" 실제 사고). 링크는 이 글에서 제일 중요한 부분이다.
  //    맨 앞 빈 줄 3개 = 사진 아래 여백. 사장님이 사진을 맨 위에 넣고 시작하신다.
  ``,
  ``,
  ``,
  `맘캘린더 채널 한눈에`,
  ``,
  `· 전체 공구 일정 실시간 검색`,
  `https://momcalendar.com`,
  ``,
  `· 네이버카페`,
  `https://cafe.naver.com/momcal`,
  ``,
  `· 인스타그램`,
  `https://www.instagram.com/momcal_`,
  ``,
  `· 오늘 공구 중인 링크`,
  `https://link.inpock.co.kr/momcal`,
  ``,
  `· 카톡 공지방(공구 알림)`,
  `https://open.kakao.com/o/gJ3NIKCh`,
  ``,
  `· 카톡 수다방`,
  `https://open.kakao.com/o/gr2kJhCh`,
  ``,
  `─────────────`,
  ``,
  rot(OPENERS),
  rot(SUBS, 3),
  // 오늘 오픈 브랜드를 한 줄로 (2026-09-28 사장님 지시: 브랜드+공구 검색 유입이 전체의 대부분 → 본문에 브랜드를 많이 실을수록 걸린다).
  //   순서 = 사이트 검색량 순(allBrands). 건수·셀러 수 같은 집계 수치는 넣지 않는다(2026-08-11 지시).
  ...(allBrands.length ? [``, `오늘 공구 브랜드 한눈에: ${allBrands.slice(0, 40).join(' · ')}`] : []),
  ``,
  // (사진 안내 문장 제거 — 사장님 지시 2026-08-27 "복사해서 그대로 붙여넣게". 사진 넣는 순서는 페이지 하단 안내문에만 남긴다)
  ...(closeFirst ? [...closeBlock, ``, ...openBlock] : [...openBlock, ``, ...closeBlock]),
  ...brandStory,
  ``,
  rot(OUTROS, 4),
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
    <div class="meta">순서: 사진 저장 → 블로그 앱 글쓰기 → 제목 붙여넣기 → 본문 붙여넣기 → 본문 맨 위에 사진 추가 → 발행. 끝의 #태그들은 자동으로 태그가 돼요</div>
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
// 🔴 index.html 은 daily 폴더의 대문이다 — **오늘 것보다 미래를 가리키면 안 된다.**
//   DAY= 로 앞날 카드를 미리 만들면(주간 선생성) 대문이 그 미래 날짜로 덮여,
//   오늘 들어온 사람이 일주일 뒤 카드를 보게 된다. 2026-10-04 에는 그 덮어쓰기가
//   머지 충돌(10-03 ↔ 10-11)로 남아 daily 폴더 커밋을 통째로 막고 있었다.
if (day <= kstToday()) {
  writeFileSync('daily/index.html',
    `<!DOCTYPE html><meta charset="UTF-8"><meta http-equiv="refresh" content="0;url=./${day}.html">`, 'utf8');
} else {
  console.log(`(index.html 은 그대로 둔다 — ${day} 는 앞날 카드다)`);
}

console.log(`카드 생성 완료: ${day} · 캡션 ${info.cap.length}자 · ${info.st}`);
