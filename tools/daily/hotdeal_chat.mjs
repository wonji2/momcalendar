// 카톡 핫딜 덤프 → 우리 수익링크로 변환 → hotdeals 등록 (사장님 지시 2026-10-01
//   "니가 알아서 변환해서 올려야지" · "베이비핫딜도 파싱루틴 돌리고 당연히 내 수익링크로 니가 바꿔서")
//
// 왜 이 도구가 필요한가
//   사장님이 주시는 카톡 딜은 지금까지 admin.html 변환기에 **사람이 링크를 하나씩 붙여넣어야** 했다.
//   받은 링크를 그대로 등록하면 수수료가 그 채널(해장일지·짠댕이)로 가고, 변환기는 한 번에 15개뿐이라
//   한 밤에 30건이 오면 손으로 두 번 나눠 붙여야 했다. 그리고 그 경로는 **정가·할인율·소분류를 버린다**
//   (cvSave 가 title·price·major·img·link 만 넣는다) → 카드에 "74%↓" 가 안 붙는다.
//   그래서 카톡 덤프 한 장을 넣으면 파싱·중복제거·분류·변환·등록까지 한 번에 끝낸다.
//
// 변환을 어떻게 사람 없이 하나 (admin 로그인 없이)
//   토스는 **출발지 IP 가 DB 서버(3.39.214.69)로 등록**돼 있어서 바깥 호출을 DB 가 대신 낸다
//   (toss_bridge_38.sql 의 toss_http / toss_http_result, 토큰은 toss_token 표).
//   · 상품 식별 : 쉐어링크를 직접 따라가 tacaId / tacaItemId 를 찾는다 (toss-sync 의 resolveOne 과 같은 규칙)
//   · 상품 정보 : sharelink /products/detail  ← DB 브리지
//   · 우리 링크 : sharelink /links            ← DB 브리지 (publisherId 필요)
//   · 쿠팡      : coupang-hotdeal?deeplink=   ← x-cron-secret 필요
//   edge 함수의 mode=convert 는 **관리자 로그인 전용**(isAdmin)이라 무인으로는 못 쓴다. 그래서 같은 일을 여기서 한다.
//
// 실행
//   node tools/daily/hotdeal_chat.mjs scratchpad/카톡.txt          ① 파싱만 (통신 없음) → 목록·json
//   node tools/daily/hotdeal_chat.mjs --convert                    ② 변환 미리보기 (등록 안 함)
//   node tools/daily/hotdeal_chat.mjs --convert --go                ③ 변환 + 등록 (manual=true)
//   옵션: --include-flash  100원딜·95% 이상도 넣는다(기본은 품절 확실로 보고 뺀다)
//         --day=2026-10-01 등록 날짜 지정(기본 오늘 KST)
//   필요한 환경값: TOSS_PUBLISHER_ID (토스 링크 발급) · PUSH_CRON_SECRET (쿠팡 딥링크)
//                  없으면 그 몰만 변환을 건너뛰고 **등록하지 않는다**(남의 링크를 올리지 않는다)
//   상태: scratchpad/hotdeal_chat/<날짜>.json · 로그 scratchpad/hotdeal_chat_log.txt
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { sbArgs, parseRows } from './sb_query.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SB_CLI = process.env.SUPABASE_CLI || 'C:/Users/FAMILY/supabase-cli/supabase.exe';
const SB_URL = process.env.SUPABASE_URL || 'https://hycaqsqeogjtbscmzrtm.supabase.co';
const ANON = process.env.SUPABASE_ANON_KEY || 'sb_publishable_u4hR4mdNTSss3kdjFH6R5Q_iuJ2MuGE';
const PUB = process.env.TOSS_PUBLISHER_ID || '';
const CRON = process.env.PUSH_CRON_SECRET || '';
const DIR = join(ROOT, 'scratchpad', 'hotdeal_chat');
const LOG = join(ROOT, 'scratchpad', 'hotdeal_chat_log.txt');
const SQLF = join(ROOT, 'scratchpad', '_hotdeal_chat.sql');
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15';
const NL = String.fromCharCode(10);

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const argv = (k, d) => { const a = args.find((x) => x.startsWith(k + '=')); return a ? a.slice(k.length + 1) : d; };
const KST = () => new Date(Date.now() + 9 * 3600e3);
const today = argv('--day', KST().toISOString().slice(0, 10));
const log = (s) => {
  const t = KST().toISOString().slice(0, 16).replace('T', ' ');
  try { mkdirSync(join(ROOT, 'scratchpad'), { recursive: true }); appendFileSync(LOG, `[${t}] ${s}${NL}`); } catch {}
  console.log(s);
};
const won = (n) => (n == null ? '-' : Number(n).toLocaleString('ko-KR') + '원');

// ── 카테고리 ──
// linkprice-hotdeal/index.ts 의 CAT_RULES 와 **같은 사상**으로 맞춘다(한쪽만 고치지 말 것).
// 못 맞히면 리빙 — 사장님 2026-08-05 "꼭 그 카테고리여야 하는 건 아닌데".
// 🔴 순서가 규칙이다 — 위에서 먼저 맞은 것이 이긴다.
//   "네스카페 돌체구스토 커피머신" 은 커피(간식)보다 머신(가전)이 먼저여야 한다.
//   "군고구마도나스" 는 고구마(신선)보다 도나스(간식)가 먼저여야 한다.  (둘 다 2026-10-01 실측 오분류)
const CAT_RULES = [
  ['육아', '기저귀·물티슈', /기저귀|물티슈|배변|아기띠|유모차|카시트|젖병|분유|이유식|쪽쪽이|턱받이/],
  ['육아', '장난감/놀이', /장난감|블럭|블록|교구|퍼즐|인형|놀이|사운드북|전집|그림책|색칠|보드게임/],
  ['육아', '육아용품', /아기|유아|신생아|베이비|키즈|어린이|주니어|아동|웨건/],
  ['가전', '디지털', /이어폰|헤드폰|스마트폰|갤럭시|galaxy|아이폰|iphone|태블릿|노트북|워치|폴드|fold|플립|flip|충전기|보조배터리/],
  ['가전', '생활가전', /커피머신|구스토|청소기|세탁기|건조기|에어컨|선풍기|공기청정|제습|가습|믹서|블렌더|전기포트|밥솥|에어프라이/],
  ['식품', '간식', /도나스|도넛|약과|스낵|과자|초코|사탕|젤리|견과/],
  ['식품', '간편식', /밀키트|간편식|즉석|국물|탕|찌개|만두|볶음밥|도시락|반찬|삼계탕|곰탕|떡갈비|폭립|갈비|족발|어묵|장조림/],
  ['식품', '신선', /한우|돼지|삼겹|닭|계란|달걀|우유|치즈|요거트|과일|사과|복숭아|토마토|수박|딸기|채소|쌀|김치|알밤|햇밤|고구마/],
  ['식품', '음료', /음료|커피|아메리카노|주스|쥬스|과채|생수|탄산|차\b/],
  ['생필품', '세제·위생', /세제|섬유유연제|주방세제|화장지|휴지|비누|샴푸|치약|칫솔|생리대|세정제|탈취|행주|살균/],
  ['생필품', '주방', /냄비|프라이팬|후라이팬|밀폐용기|도마|수저|그릇|텀블러|보온병|주방/],
  ['리빙', '수납·정리', /정리함|수납|선반|행거|옷걸이|바구니|트레이|리빙박스/],
  ['리빙', '침구', /이불|베개|매트|패드|커튼|러그|카페트|침대/],
  ['뷰티', '스킨케어', /크림|로션|에센스|세럼|앰플|토너|선크림|선스틱|마스크팩|클렌징|퍼퓸/],
  ['리빙', '레저', /캠핑|텐트|돗자리|타프/],
  ['식품', '간식', /빵|떡|아이스크림|오징어|장족|김\b/],
];
const categorize = (name) => {
  const s = String(name || '').toLowerCase();
  for (const [a, b, re] of CAT_RULES) if (re.test(s)) return [a, b];
  return ['리빙', ''];
};

// ── 링크 ──
// 토스 쉐어링크 코드는 8자다(실측 2026-10-01: 카톡에서 한 글자 잘린 7자 링크가 섞여 왔다) → 길이가 다르면 보류한다.
// ⚠ /g 정규식에 .test() 를 쓰면 lastIndex 가 남아 다음 줄을 건너뛴다 → 검사용은 /g 없는 쌍으로 따로 둔다.
const RE_LINK = /https?:\/\/[^\s)<>"']+/g;
const HAS_LINK = /https?:\/\//;
const MALL_OF = (u) =>
  /link\.coupang\.com|coupang\.com/.test(u) ? '쿠팡'
    : /toss\.(im|shopping)/.test(u) ? '토스쇼핑'
      : /naver\.me|smartstore\.naver|shopping\.naver/.test(u) ? '네이버'
        : '';
// 상품이 아닌 링크 — 경쟁 핫딜 사이트(작업규칙 2-7)·멤버십·가입 유도는 등록하지 않는다
const RE_NOTDEAL = /pages\.dev|todaydeal|insta-gong|82market|09pangpang|open\.kakao|pf\.kakao|instagram\.com|blog\.naver|cafe\.naver/i;
const tossCode = (u) => (u.match(/toss\.(?:im|shopping)\/_m\/([A-Za-z0-9]+)/) || [])[1] || '';
const tossDirect = (u) => /toss\.shopping\/[ti]\/\d+/.test(u);      // 이미 상품 주소면 코드가 없어도 된다
// 카톡 내보내기 머리말 "[해장일지] [오후 5:14] " 을 떼어 본문만 본다
const IS_MSG = /^\[[^\]]{1,40}\]\s*\[[^\]]{1,20}\]/;   // 카톡 메시지 머리말이 있는 줄 = 새 메시지
const unhead = (s) => s.replace(/^\[[^\]]{1,40}\]\s*\[[^\]]{1,20}\]\s*/, '').trim();
// 상품명 줄은 두 채널 모두 이모지(🍖 ⛺ ✅ -) 로 시작한다. 글자로 시작하는 줄은 사장님 코멘트다.
const isMarked = (s) => s.length > 0 && !/^[\p{L}\p{N}]/u.test(s);

// ── ① 카톡 덤프 파싱 ───────────────────────────────────────────
// 카톡 한 줄 한 줄을 훑으며 '이름 → 가격 → 링크' 를 모은다.
// 묶음 글(0시 특가 모음)은 한 메시지에 5~6건이 들어 있어서, **링크를 만날 때마다** 한 건을 끊는다.
//   🍖 셰프초이스 … 떡갈비, 2kg, 1개        ← 이름
//   💰 25,900원 → 17,900원 (30%↓)          ← 가격 (화살표는 →, ->, ⇒ 다 온다)
//   https://toss.shopping/_m/j0sgerbw      ← 링크 = 한 건 끝
// 짠댕이 형식도 같은 흐름이다: "✅ 상품명" → "↳ 초대박 🚨 13,500원" → 링크 (정가 없음)
function parseChat(text) {
  const out = [];
  let name = '', price = null, before = null, drop = null, note = [];
  const clean = (s) => s
    .replace(/^[^\p{L}\p{N}(\[]+/u, '')                      // 앞머리 이모지·기호
    .replace(/\s*\[(\d+)(개|팩|구|매|봉|병|입)\]\s*$/u, ', $1$2') // 짠댕이 "[12개]" → ", 12개"
    .replace(/\s+/g, ' ').trim();
  const num = (s) => Number(String(s).replace(/[^\d]/g, '')) || null;

  for (let raw of String(text).split(/\r?\n/)) {
    const t = raw.trim();
    // 🔴 새 메시지가 시작되면 모아둔 이름·가격을 버린다.
    //   한 건(이름·가격·링크)은 **언제나 한 메시지 안에** 있다(두 채널 모두). 묶음 글도 그렇다.
    //   안 버리면 중간의 홍보 메시지가 다음 상품의 이름을 가로챈다
    //   (2026-10-01 실측: "🚨무지성급 재입고🚨" 가 크라운제과 스낵모음의 상품명으로 올라갔다).
    if (IS_MSG.test(t)) { name = ''; price = null; before = null; drop = null; note = []; }
    const line = unhead(t);
    if (!line) continue;
    // 안내·고지는 건너뛴다
    if (/(수수료|파트너스|쉐어링|제공받습니다|커넥트)/.test(line) && !HAS_LINK.test(line)) continue;
    if (/^(사진|동영상|메시지가 삭제|이모티콘)/.test(line)) continue;
    if (/^\d{4}년 \d{1,2}월 \d{1,2}일/.test(line)) continue;        // 카톡 날짜 구분줄

    // 가격줄 — "💰 199,800원 → 51,840원 (74%↓)" / "💰12,900원->7,800원 (43%↓)" / "↳ … 13,500원"
    const pm = line.match(/([\d,]+)\s*원\s*(?:→|->|⇒|~>)\s*([\d,]+)\s*원(?:\s*\(?\s*(\d{1,2})\s*%)?/);
    if (pm) { before = num(pm[1]); price = num(pm[2]); drop = pm[3] ? Number(pm[3]) : null; continue; }
    const pm2 = line.match(/^[^\d]{0,24}?([\d,]{3,})\s*원\s*$/);          // 할인가만 적힌 줄(짠댕이)
    if (pm2 && !/원가|정가/.test(line)) { price = num(pm2[1]); before = null; drop = null; continue; }

    // 링크줄 — 한 건을 끊는다
    const links = line.match(RE_LINK);
    if (links) {
      for (const u of links) {
        // 상품이 아닌 링크(경쟁 핫딜 사이트·공지)면 그 메시지는 딜이 아니다 → 모아둔 이름·가격도 버린다
        // (2026-10-01: 짠댕이 "곧 재입고" 공지의 '- 할리스…' 줄이 다음 메시지 상품명을 가로챘다)
        if (RE_NOTDEAL.test(u)) { name = ''; price = null; before = null; drop = null; note = []; continue; }
        const mall = MALL_OF(u);
        if (!mall) continue;
        out.push({ title: name, price, price_before: before, discount_rate: drop, link: u, mall, note: note.join(' ') });
        // 묶음 글에서 다음 건으로 — 이름·가격은 비우고 이어 읽는다
        name = ''; price = null; before = null; drop = null; note = [];
      }
      continue;
    }

    // 상품명 줄 — 이모지/✅ 로 시작하는 줄만. 글자로 시작하는 줄은 사장님 코멘트다.
    // 먼저 온 것이 이름이다(뒤에 붙는 "🎁 최대 28,987원 쿠팡캐시 적립" 같은 혜택줄에 이름을 빼앗기지 않게).
    if (!isMarked(line)) continue;
    const c = clean(line);
    if (c.length >= 6 && !/[?!‼]$/u.test(c) && !/(입니다|이에요|해주세|고고|대기|품절리스트|굿나잇|기회|서둘러|확인해|쟁여|챙겨|사세|갑시다|올려놨|선착순)/.test(c)) {
      if (!name) name = c; else note.push(c);
    }
  }
  return out;
}

// ── ② 정리 — 중복·비상품·플래시딜 걸러내기 ─────────────────────
// 작업규칙 1-2 "파싱하는 그 순간 거른다" · 1-6 "상품명 절대 줄이지 말 것"(수식어도 여기선 안 건드린다)
function tidy(deals) {
  const keep = [], drop = [];
  const seenCode = new Set(), seenName = new Set();
  const baseKey = (s) => String(s || '').toLowerCase().replace(/\([^)]*\)/g, '')
    .replace(/[\d,.]+\s*(g|kg|ml|l|매|개|팩|구|봉|입|세트|박스|롤|m)\b/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(' ').slice(0, 2).join(' ');

  for (const d of deals) {
    const why = (r) => { drop.push({ ...d, why: r }); };
    if (!d.title) { why('상품명을 못 읽었다'); continue; }
    if (!d.price) { why('가격을 못 읽었다'); continue; }
    const code = tossCode(d.link);
    if (d.mall === '토스쇼핑' && !tossDirect(d.link) && code.length !== 8) {
      why(`쉐어링크 코드가 ${code.length || 0}자(정상 8자) — 카톡에서 잘린 링크`); continue;
    }
    const id = code || d.link;
    if (seenCode.has(id)) { why('같은 링크가 이미 있다'); continue; }
    const bk = baseKey(d.title);
    if (bk && seenName.has(bk)) { why(`같은 상품이 이미 있다(${bk})`); continue; }
    const rate = d.discount_rate ?? (d.price_before ? Math.round((1 - d.price / d.price_before) * 100) : null);
    // 100원딜·95% 이상은 몇 초 만에 끝난다 → 등록하면 품절 카드가 된다
    if (!has('--include-flash') && (d.price <= 1000 || (rate != null && rate >= 95))) { why(`플래시딜(${won(d.price)}${rate ? ' · ' + rate + '%' : ''}) — 품절 확실`); continue; }
    const [major, minor] = categorize(d.title);
    seenCode.add(id); if (bk) seenName.add(bk);
    keep.push({ ...d, discount_rate: rate, major, minor });
  }
  return { keep, drop };
}

// ── DB ──
function q(sql) {
  writeFileSync(SQLF, sql, 'utf8');
  const raw = execFileSync(SB_CLI, sbArgs(SQLF), { encoding: 'utf8', timeout: 120000 });
  const r = parseRows(raw);
  if (!r.ok) throw new Error('DB 응답을 못 읽었다: ' + r.why);
  return r.rows;
}
const lit = (s) => (s == null || s === '' ? 'null' : `'${String(s).replace(/'/g, "''")}'`);
const numlit = (n) => (n == null || !Number.isFinite(Number(n)) ? 'null' : String(Math.round(Number(n))));

// 토스 호출은 DB 가 대신 낸다(출발지 IP 고정). 요청 → 응답 수거.
async function tossCall(method, path, body) {
  const tok = q('select access_token, expires_at from public.toss_token where id = 1;')[0];
  if (!tok || new Date(tok.expires_at) <= new Date()) {
    // 토큰 갱신은 edge 함수가 한다(mode=health 는 관리자 확인이 없다)
    await fetch(`${SB_URL}/functions/v1/toss-sync?mode=health`, { headers: { apikey: ANON, Authorization: `Bearer ${ANON}` } })
      .then((r) => r.text()).catch(() => '');
    const again = q('select access_token, expires_at from public.toss_token where id = 1;')[0];
    if (!again || new Date(again.expires_at) <= new Date()) throw new Error('토스 토큰이 없다/만료다 — toss-sync?mode=health 를 먼저 확인할 것');
    tok.access_token = again.access_token;
  }
  const hdr = `jsonb_build_object('Authorization','Bearer ${tok.access_token}','Content-Type','application/json')`;
  const rid = q(method === 'GET'
    ? `select public.toss_http('GET', ${lit('https://sharelink.toss.im/openapi' + path)}, ${hdr}) rid;`
    : `select public.toss_http('POST', ${lit('https://sharelink.toss.im/openapi' + path)}, ${hdr}, ${lit(JSON.stringify(body || {}))}) rid;`)[0]?.rid;
  if (!rid) throw new Error('토스 요청을 넣지 못했다');
  for (let i = 0; i < 30; i++) {                                   // 응답은 비동기 — 최대 21초 기다린다
    await new Promise((r) => setTimeout(r, 700));
    const row = q(`select status, content from public.toss_http_result(${numlit(rid)});`)[0];
    if (row && row.content != null) { try { return JSON.parse(row.content); } catch { return null; } }
  }
  throw new Error('토스 응답이 21초 안에 안 왔다');
}

// 쉐어링크를 따라가 상품 번호를 찾는다 (toss-sync 의 resolveOne 과 같은 규칙)
async function resolveToss(url) {
  let u = url;
  for (let hop = 0; hop < 3; hop++) {
    const m = u.match(/toss\.shopping\/([ti])\/(\d+)/);
    if (m) return { idKind: m[1] === 'i' ? 'item' : 'taca', id: m[2] };
    const r = await fetch(u, { headers: { 'User-Agent': UA }, redirect: 'follow' });
    // 🔴 "못 찾았다" 와 "못 열었다" 를 섞지 않는다 — 통신이 막힌 회차가 조용히 0건으로 끝나면 안 된다
    //    (sb_query.mjs 머리말의 그 사고: 성공했는데 아무 일도 안 한 회차가 로그상 정상으로 보였다)
    if (!r.ok && r.status >= 400) throw new Error(`쉐어링크를 못 열었다(HTTP ${r.status})`);
    if (r.url && r.url !== u) { u = r.url; continue; }
    const html = await r.text();
    const tm = html.match(/toss\.shopping\/([ti])\/(\d+)/);
    if (tm) return { idKind: tm[1] === 'i' ? 'item' : 'taca', id: tm[2] };
    break;
  }
  return null;
}

// 쿠팡 중계링크 → 상품 번호 (toss-sync 의 resolveOne 과 같은 규칙)
async function resolveCoupang(url) {
  let u = url;
  for (let hop = 0; hop < 3; hop++) {
    const m = u.match(/coupang\.com\/vp\/products\/(\d+)/);
    if (m) { const it = u.match(/itemId=(\d+)/); return { productId: m[1], url: `https://www.coupang.com/vp/products/${m[1]}${it ? `?itemId=${it[1]}` : ''}` }; }
    const r = await fetch(u, { headers: { 'User-Agent': UA }, redirect: 'follow' });
    if (r.url && r.url !== u) { u = r.url; continue; }
    const html = await r.text();
    const pm = html.match(/productId.{0,6}?(\d{6,})/);
    if (pm) { const im = html.match(/itemId.{0,6}?(\d{6,})/); return { productId: pm[1], url: `https://www.coupang.com/vp/products/${pm[1]}${im ? `?itemId=${im[1]}` : ''}` }; }
    break;
  }
  return null;
}

// ── 메인 ──
const jsonPath = join(DIR, `${today}.json`);

if (!has('--convert')) {
  // ① 파싱만 — 통신이 필요 없다
  const src = args.find((a) => !a.startsWith('--'));
  if (!src) { console.log('사용법: node tools/daily/hotdeal_chat.mjs <카톡.txt> [--include-flash]   그 뒤 --convert [--go]'); process.exit(1); }
  const text = src === '-' ? readFileSync(0, 'utf8') : readFileSync(src, 'utf8');
  const { keep, drop } = tidy(parseChat(text));
  mkdirSync(DIR, { recursive: true });
  writeFileSync(jsonPath, JSON.stringify({ day: today, at: KST().toISOString(), deals: keep, dropped: drop }, null, 1), 'utf8');
  const md = [`# 카톡 핫딜 ${today} — 등록 후보 ${keep.length}건`, '',
    '| # | 상품명 | 정가→할인가 | 할인율 | 분류 | 몰 |', '|---|---|---|---|---|---|',
    ...keep.map((d, i) => `| ${i + 1} | ${d.title} | ${won(d.price_before)} → ${won(d.price)} | ${d.discount_rate ?? '-'}% | ${d.major}/${d.minor || '-'} | ${d.mall} |`),
    '', `## 뺀 것 ${drop.length}건`, '', '| 상품명 | 이유 |', '|---|---|',
    ...drop.map((d) => `| ${d.title || d.link} | ${d.why} |`)].join(NL);
  writeFileSync(join(DIR, `${today}.md`), md, 'utf8');
  log(`파싱 끝 — 등록 후보 ${keep.length}건 · 뺀 것 ${drop.length}건 → ${jsonPath}`);
  for (const d of keep) console.log(`  · ${d.mall} ${d.title} ${won(d.price)}${d.discount_rate ? ` (${d.discount_rate}%↓)` : ''} [${d.major}/${d.minor || '-'}]`);
  for (const d of drop) console.log(`  ✖ ${(d.title || d.link).slice(0, 40)} — ${d.why}`);
  process.exit(0);
}

// ② 변환 (+ --go 면 등록)
if (!existsSync(jsonPath)) { log(`${jsonPath} 가 없다 — 먼저 카톡 덤프로 파싱할 것`); process.exit(1); }
const saved = JSON.parse(readFileSync(jsonPath, 'utf8'));
const deals = saved.deals || [];
if (!deals.length) { log('등록 후보가 없다'); process.exit(0); }

// 이미 올라간 것은 건너뛴다 (작업규칙 1-1·1-2 — 중복은 보내지도 않는다)
const titles = deals.map((d) => lit(d.title)).join(',');
const already = new Set(q(`select title from public.hotdeals
 where created_at > now() - interval '14 days' and title in (${titles});`).map((r) => r.title));

const rows = [], fails = [];
for (const d of deals) {
  if (already.has(d.title)) { fails.push({ ...d, why: '이미 등록돼 있다(14일 내)' }); continue; }
  try {
    if (d.mall === '토스쇼핑') {
      if (!PUB) { fails.push({ ...d, why: 'TOSS_PUBLISHER_ID 가 없어 우리 링크를 못 만든다' }); continue; }
      const r = await resolveToss(d.link);
      if (!r) { fails.push({ ...d, why: '토스 상품 번호를 못 찾았다' }); continue; }
      const key = r.idKind === 'item' ? 'tacaItemIds' : 'tacaIds';
      const det = await tossCall('GET', `/products/detail?${key}=${r.id}`);
      const it = det?.success?.items?.[0] ?? null;
      if (it?.isSoldOut) { fails.push({ ...d, why: '품절' }); continue; }
      const lr = await tossCall('POST', '/links', r.idKind === 'item'
        ? { tacaItemId: Number(r.id), publisherId: PUB } : { tacaId: Number(r.id), publisherId: PUB });
      const link = lr?.success?.shortUrl || '';
      if (!link) { fails.push({ ...d, why: '쉐어링크 발급 실패' }); continue; }
      rows.push({ ...d, link, source: 'toss', product_id: `toss_${it?.tacaItemId ?? r.id}`,
        img_url: it?.thumbnailUrl || '', price: it?.displayPrice ?? d.price,
        price_before: it?.originalPrice ?? d.price_before, discount_rate: it?.discountRate ?? d.discount_rate });
    } else if (d.mall === '쿠팡') {
      if (!CRON) { fails.push({ ...d, why: 'PUSH_CRON_SECRET 이 없어 쿠팡 딥링크를 못 만든다' }); continue; }
      const pid = await resolveCoupang(d.link);
      if (!pid) { fails.push({ ...d, why: '쿠팡 상품 번호를 못 찾았다' }); continue; }
      const rr = await fetch(`${SB_URL}/functions/v1/coupang-hotdeal?deeplink=${encodeURIComponent(pid.url)}`,
        { headers: { 'x-cron-secret': CRON } }).then((r) => r.json()).catch(() => null);
      const link = rr?.body?.data?.[0]?.shortenUrl || '';
      if (!link) { fails.push({ ...d, why: '쿠팡 딥링크 발급 실패' }); continue; }
      rows.push({ ...d, link, source: 'coupang', product_id: `cp_${pid.productId}`, img_url: '' });
    } else {
      // 네이버는 우리 커넥트 링크를 자동 발급할 길이 없다 → 남의 링크를 올리지 않는다
      fails.push({ ...d, why: '네이버는 자동 변환 경로가 없다(사장님 결정 필요)' });
    }
  } catch (e) { fails.push({ ...d, why: String(e.message || e).slice(0, 120) }); }
}

console.log(`${NL}변환 성공 ${rows.length}건 · 못 한 것 ${fails.length}건`);
for (const r of rows) console.log(`  ✔ ${r.title} ${won(r.price)} → ${r.link}`);
for (const f of fails) console.log(`  ✖ ${(f.title || '').slice(0, 36)} — ${f.why}`);

if (!rows.length) { log('등록할 것이 없다'); process.exit(0); }
if (!has('--go')) { log(`미리보기만 했다(등록 안 함). 등록하려면 --go 를 붙일 것 — 변환 ${rows.length}건`); process.exit(0); }

// ③ 등록 — manual=true (hotdeal_manual_43.sql: 사장님이 주신 딜은 할인율로 자동 판단하지 않는다)
// 같은 상품번호가 한 회차에 두 번 나오면(채널 두 곳이 같은 딜을 올린 경우) 하나만 넣는다 —
// hotdeals 에는 (product_id, deal_day) 유일키가 있어서(toss-sync 의 on_conflict 와 같은 키) 그대로 넣으면 회차 전체가 깨진다.
const byPid = new Map();
for (const r of rows) if (!byPid.has(r.product_id)) byPid.set(r.product_id, r);
if (byPid.size !== rows.length) log(`같은 상품번호 ${rows.length - byPid.size}건을 합쳤다`);
rows.length = 0; rows.push(...byPid.values());

// ⚠ VALUES 목록의 null 은 타입이 없다(text 로 추론) → 숫자 칸에 넣을 때 거부당한다. select 에서 반드시 캐스팅한다.
const values = rows.map((r) => `(${[lit(r.title), lit(r.link), lit(r.major), lit(r.minor), numlit(r.price),
  numlit(r.price_before), numlit(r.discount_rate), lit(r.img_url), lit(r.source), lit(r.product_id),
  lit(r.mall), lit(today)].join(',')})`).join(',' + NL);
const n = q(`with v(title,link,major,minor,price,price_before,discount_rate,img_url,source,product_id,mall,deal_day) as (
  values ${NL}${values}
)
insert into public.hotdeals(title,link,major,minor,price,price_before,discount_rate,img_url,source,product_id,mall,deal_day,manual,is_lowest)
select v.title::text, v.link::text, v.major::text, nullif(v.minor,'')::text,
       v.price::int, v.price_before::int, v.discount_rate::int,
       nullif(v.img_url,'')::text, v.source::text, v.product_id::text, v.mall::text,
       v.deal_day::date, true, false
  from v
 where not exists (select 1 from public.hotdeals h
                    where h.title = v.title::text and h.deal_day = v.deal_day::date)
    on conflict do nothing
returning id, title;`);
log(`등록 완료 ${n.length}건 (${today}) — ${n.map((r) => r.title.slice(0, 14)).join(' · ')}`);
writeFileSync(join(DIR, `${today}_등록결과.json`), JSON.stringify({ at: KST().toISOString(), registered: n, failed: fails }, null, 1), 'utf8');
