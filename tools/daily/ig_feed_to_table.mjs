// 인스타 스윕 캡션(jsonl) → 수확 TSV 변환기 (사장님 2026-09-08 "무인으로 완성해 · 공구 아닌 건 꼭 거르고 공구만")
//
// 입력: scratchpad/ig_feed/<날짜>.jsonl (ig_feed_sweep.mjs 가 쌓는 {code,u,fn,t,ad,src,cap})
// 출력: <out.tsv>  기존 수확 파이프라인과 같은 6열 (handle, slug, name, open, end, link)
//       <out.tsv>.names  handle|한글명 (인스타 full_name 에서 뽑은 것 — DB 에 이름이 없는 셀러용)
//       <out.tsv>.drop   왜 버렸는지 (사람이 나중에 볼 것)
// 상태: scratchpad/ig_feed_conv_seen.txt (변환한 게시물 code)
//
// 공구 판정 (전부 만족해야 통과) — 아니면 drop 파일에 사유를 남긴다
//   ① 캡션에 "공구" 또는 "공동구매" 가 있다 (OPEN·오픈만으로는 안 됨)
//   ② 오픈 날짜가 확실하다: 9/9 · 9월 9일 · 9.9 · (수) 붙은 것 · "오늘/내일/모레 오픈" (게시일 기준)
//   ③ 마감·종료·품절 글, 핫딜·체험단·협찬·광고 글(공구 언급 없이), 후기·인증 글이 아니다
//   ④ 상품명이 뽑힌다 (2자 이상, 판촉어만 남은 것 제외)
//   ⑤ 광고(ad) 게시물 제외, 오픈일이 오늘-3 이전이거나 60일 뒤면 제외
import { readFileSync, writeFileSync, appendFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { cleanName } from '../../scratchpad/profiles/decode_names.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..');
const DIR = path.join(ROOT, 'scratchpad', 'ig_feed');
const SEEN = path.join(ROOT, 'scratchpad', 'ig_feed_conv_seen.txt');
const outF = process.argv[2] || path.join(DIR, `_conv_${Date.now()}.tsv`);
const KST = () => new Date(Date.now() + 9 * 3600e3);
const today = KST().toISOString().slice(0, 10);
const ymd = (d) => d.toISOString().slice(0, 10);
const valid = (s) => { const d = new Date(s + 'T00:00:00Z'); return !isNaN(d) && ymd(d) === s; };   // 9/31 같은 가짜 날짜 차단
const addDays = (s, n) => { if (!valid(s)) return ''; const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return ymd(d); };

const DRY = !!process.env.DRY;   // DRY=1: seen 을 무시하고 전부 다시 판정, seen 에 기록도 안 한다(규칙 시험용)
const seen = new Set(!DRY && existsSync(SEEN) ? readFileSync(SEEN, 'utf8').split(/\r?\n/).filter(Boolean) : []);
const files = readdirSync(DIR).filter(f => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f)).sort().slice(-3);
const posts = [];
for (const f of files) for (const line of readFileSync(path.join(DIR, f), 'utf8').split('\n')) {
  if (!line.trim()) continue; try { const j = JSON.parse(line); if (j.code && !seen.has(j.code)) posts.push(j); } catch {}
}

const KW = /공구|공동구매/;
const ENDED = /마감\s*(되었|됐|했|입니다|이에요|예요)|종료\s*(되었|됐)|품절\s*(되었|됐)|마감되어|완판되었/;
const NOT_GG = /핫딜|체험단|서포터즈|협찬|제품제공|원고료|리뷰이벤트/;
const REVIEW = /후기|구매완료 인증|인증샷|사용후기/;
const PROMO = /(단독|최초|역대급|최저가|초특가|특가|앵콜|앙코르|리오더|재입고|한정|선착순|오늘|내일|모레|드디어|드뎌|이번|이번주|이번엔|지금|바로|곧|마지막|마감|임박|런칭|출시|신상|공구|공동구매|오픈|OPEN|open|예고|시작|안내|공지|알림|링크|댓글|이벤트|여기|합니다|해요|입니다|예요|에요|했어요|됐어요|중|D-\d+|\d+차|\d+회|\d+월|\d+일|\d+시|\d+분|오전|오후|저녁|밤|\(.*?\)|\[.*?\])/g;
// 판촉어 뒤에 한 글자가 붙어 있으면 그것까지 함께 뗀다: "최저가전" → 통째로.
//   최저가만 떼면 "전"이 남아 상품명이 된다(2026-09-09 id 22773 실사고).
//   낱말 끝에서만 적용하므로 "오늘의집" 같은 이름은 건드리지 않는다. PROMO 보다 먼저 돌린다.
const PROMO_TAIL = new RegExp('(' + "단독|최초|역대급|최저가|초특가|특가|앵콜|앙코르|리오더|재입고|한정|선착순|오늘|내일|모레|드디어|드뎌|이번|이번주|이번엔|지금|바로|마지막|마감|임박|런칭|출시|신상|공구|공동구매|오픈|예고|시작|안내|공지|알림|링크|댓글|이벤트|여기|합니다|해요|입니다|예요|에요|했어요|됐어요|오전|오후|저녁" + ')[가-힣](?=[\s,.·&+/-]|$)', 'g');

// 캡션에서 날짜로 읽으면 안 되는 구간을 먼저 지운다 (2026-09-09 오픈일 오류 3건의 원인)
//   · 사이즈·용량 표기: 110 / 17~20kg · 30x40 · 500ml
//   · 배송/발송 안내: "9월 15일부터 순차 발송"
//   · 다른 상품 예고 목록: "📍 공구일정" 아래 줄들
// 수학용 볼드·이탤릭 영문(𝙊𝙥𝙚𝙣 · 𝑶𝑷𝑬𝑵)을 보통 A-Z 로 되돌린다.
//   그대로 두면 PROMO 의 OPEN 이 안 걸려 "무선 미니 후드 𝙊𝙥𝙚𝙣" 이 상품명이 된다 (2026-09-09 실측)
const unfancy = (s) => String(s).replace(/[𝐀-𝟿]/gu, (ch) => {
  const c = ch.codePointAt(0);
  for (const [a, b, base] of [[0x1D400, 0x1D419, 65], [0x1D41A, 0x1D433, 97], [0x1D434, 0x1D44D, 65], [0x1D44E, 0x1D467, 97],
    [0x1D468, 0x1D481, 65], [0x1D482, 0x1D49B, 97], [0x1D5A0, 0x1D5B9, 65], [0x1D5BA, 0x1D5D3, 97],
    [0x1D5D4, 0x1D5ED, 65], [0x1D5EE, 0x1D607, 97], [0x1D608, 0x1D621, 65], [0x1D622, 0x1D63B, 97],
    [0x1D63C, 0x1D655, 65], [0x1D656, 0x1D66F, 97], [0x1D670, 0x1D689, 65], [0x1D68A, 0x1D6A3, 97]])
    if (c >= a && c <= b) return String.fromCharCode(base + (c - a));
  return " ";
});
const stripNonDate = (cap) => String(cap)
  // 세 자리 이상 숫자에 붙은 / 구간은 사이즈표다
  .replace(/\d{3,}\s*[/]\s*\d{1,3}(\s*[~-]\s*\d{1,3})?/g, ' ')
  // 배송·발송·출고 안내가 붙은 날짜
  .replace(/\d{1,2}\s*[/.월]\s*\d{1,2}\s*일?\s*(부터|이후|경)?\s*(순차)?\s*(발송|배송|출고|입고)/g, ' ');
const dateFrom = (rawCap, base) => {
  const cap = stripNonDate(unfancy(rawCap));
  // "오늘 자정 마감" 은 오늘 끝나는 공구다. 캡션 아래 다른 상품 예고 날짜를 오픈일로 삼지 않게 여기서 끝낸다
  //   (2026-09-09 id 22773: 쿠진아트 마감글에 적힌 알텐바흐 9/10 을 쿠진아트 오픈일로 가져왔다)
  if (/오늘\s*자정\s*마감|자정\s*마감|오늘\s*(밤)?\s*마감/.test(rawCap))
    return { open: addDays(base, -3), end: base };
  const m = cap.match(/(\d{1,2})\s*[\/.월]\s*(\d{1,2})\s*일?\s*(?:\([월화수목금토일]\))?/g) || [];
  const ds = [];
  for (const s of m) { const mm = s.match(/(\d{1,2})\s*[\/.월]\s*(\d{1,2})/); const M = +mm[1], D = +mm[2]; if (M < 1 || M > 12 || D < 1 || D > 31) continue; ds.push(`${today.slice(0, 4)}-${String(M).padStart(2, '0')}-${String(D).padStart(2, '0')}`); }
  let open = null, end = null;
  if (ds.length) {
    // "9/9 ~ 9/12" 또는 "9/9-9/12" 처럼 범위가 있으면 앞이 오픈, 뒤가 마감
    const range = cap.match(/(\d{1,2}\s*[\/.월]\s*\d{1,2}\s*일?\s*(?:\([월화수목금토일]\))?)\s*[~\-–—∼]\s*(\d{1,2}\s*[\/.월]\s*\d{1,2})/);
    if (range) { const a = range[1].match(/(\d{1,2})\s*[\/.월]\s*(\d{1,2})/), b = range[2].match(/(\d{1,2})\s*[\/.월]\s*(\d{1,2})/); open = `${today.slice(0, 4)}-${a[1].padStart(2, '0')}-${a[2].padStart(2, '0')}`; end = `${today.slice(0, 4)}-${b[1].padStart(2, '0')}-${b[2].padStart(2, '0')}`; }
    else { open = ds[0]; const kk = cap.match(/(\d{1,2}\s*[\/.월]\s*\d{1,2})\s*일?\s*(?:\([월화수목금토일]\))?\s*까지/); if (kk) { const b = kk[1].match(/(\d{1,2})\s*[\/.월]\s*(\d{1,2})/); const e = `${today.slice(0, 4)}-${b[1].padStart(2, '0')}-${b[2].padStart(2, '0')}`; if (e !== open) end = e; else if (ds.length > 1) open = ds.find(d => d !== e) || open, end = e; } }
  } else if (/오늘\s*(?:\S+\s*){0,3}(오픈|공구|시작)/.test(cap) || /오늘부터/.test(cap)) open = base;
  else if (/내일\s*(?:\S+\s*){0,3}(오픈|공구|시작)/.test(cap)) open = addDays(base, 1);
  else if (/모레\s*(?:\S+\s*){0,3}(오픈|공구|시작)/.test(cap)) open = addDays(base, 2);
  if (open && !valid(open)) open = null;
  if (end && !valid(end)) end = null;
  if (open && !end) end = addDays(open, 3);
  if (open && end && (end < open || end > addDays(open, 13))) end = addDays(open, 3);
  return { open, end };
};

const productFrom = (cap) => {
  const c = unfancy(cap).replace(/^"|"\.?$/g, '').replace(/https?:\/\/\S+/g, ' ').replace(/[#@]\S+/g, ' ');
  const lines = c.split(/\n+/).map(s => s.trim()).filter(Boolean);
  const pick = (s) => { const q = s.match(/[❝“"「『【<\[]([^❞”"」』】>\]]{2,40})[❞”"」』】>\]]/); return q ? q[1] : null; };
  const cands = [];
  for (const l of lines.slice(0, 6)) { const q = pick(l); if (q) cands.push(q); }
  for (const l of lines.slice(0, 4)) if (/공구|오픈|OPEN|공동구매/i.test(l)) cands.push(l);
  if (lines[0]) cands.push(lines[0]);
  for (let s of cands) {
    s = cleanName(s).replace(/[^\p{L}\p{N}\s&+·.,\/'\-]/gu, ' ');
    s = s.replace(/^[가-힣A-Za-z]{2,8}\s?[xX×]\s?/, '').replace(/핫딜|최저가|공구가|특가/g, ' ');   // "다니맘X기운찬 …" 셀러 접두·판촉어
    s = s.replace(PROMO_TAIL, ' ').replace(PROMO, ' ').replace(/\s+/g, ' ').trim().replace(/^[\s,.·&+\/\-]+|[\s,.·&+\/\-]+$/g, '');
    if (s.length >= 2 && s.length <= 40 && /[가-힣A-Za-z]{2,}/.test(s) && !/^(제품|상품|아이템|이거|요거|그거|이것)$/.test(s)) return s;
  }
  return null;
};

// 상품명 품질 게이트 (무인 등록이므로 엄격하게): 문장 잔해가 있으면 버리고, DB 분류 사전(catvocab.json 의 tok)에 있는 낱말이 하나는 있어야 통과
const VOCAB_F = path.join(ROOT, 'scratchpad', 'catvocab.json');
const vocab = new Set();
try {
  const raw = readFileSync(VOCAB_F, 'utf8'); const j = JSON.parse(raw.slice(raw.indexOf('{')));
  for (const r of (j.rows || [])) if (r.tok && r.tok.length >= 2 && (r.tot || 0) >= 3) vocab.add(r.tok);
} catch { }
const SENTENCE = /(해요|합니다|했어|했습|드릴|주세요|보세요|하세요|입니다|이에요|예요|하는|하고|해서|이라|라고|저요|보여|같이|먹어야지|놓치지|챙겨|클릭|프로필|구매완료|휴대폰|뒷자리|기간|진행|이슈|반응|정착|실패|써보실|알고|먹으면|모든|상관없이|동안|남겨|댓글|링크|알림|이벤트|당첨|추첨|확인|필독|공지|안내|여러분|분들|엄마|아이가|우리|제가|저는|이거|요거|그냥|진짜|정말|너무|완전|역대급|미친|대박|추천|후기|가능|무료|증정|사은품)/;
const SENTENCE2 = /(아시나요|된다고|배우는|그리고|돌아온|함께|인기폭발|폭발|인상전|가격 인상|만원대|천원대|원대|이라니|라니|미쳤|놀랬|가져왔|드디어|하자마자|품절되는|써보|먹어|마시|입히|신기|놓치|기다리|준비|소개|시작|끝|까지만|만에|무조건|필수|꿀템|찐|갓성비|가성비|누가|따라오|비결|이렇게|맛있었|퀄리티|발송|딱 하루|하루만|시간|Q&A|문의|골라담기 시|모았|드실|잠시후|잠시 후|막차|드셔|넣어|담아|골랐)/;
// 사장님 상품·파싱 제외 셀러는 변환 단계에서 미리 뺀다 (게이트에 걸리면 회차 전체가 멈추므로)
const OWN_PRODUCT = /(^|[^가-힣])(우랩|마이키즈|롤팬)([^가-힣]|$)/;
const EXCLUDED = new Set(['ggumi_geonhu', 'mimimiso_', 'avocado_ha_', 'kkang_twins_', 'hyun._.brother', 'yunu_uno', 'momcal_']);
try { for (const l of readFileSync(path.join(ROOT, 'scratchpad', 'parsing_excluded.txt'), 'utf8').split(/\r?\n/)) { const h = l.trim().split(/[\s|#(]/)[0]; if (/^[a-z0-9._]{3,}$/.test(h)) EXCLUDED.add(h); } } catch { }
// 🔴 2026-09-08 23:16 사고: "욕실 매트 없이도"·"아기랑 여행 한 번 다녀오면 알잖아요" 같은 문장 조각 12건이 자동 등록됐다(삭제).
//    분류 사전 낱말(욕실·아기·여행…)은 일반어라 근거가 못 된다 → **DB 상품명의 첫 낱말(브랜드) 사전**(scratchpad/brand_vocab.txt, 3건 이상)에
//    있는 낱말이 들어 있어야 통과. 문장 어미(…요/다/죠/면/서/고/는/던/를/을/에/도)로 끝나면 버린다.
const BRANDS = new Set();
try { for (const l of readFileSync(path.join(ROOT, 'scratchpad', 'brand_vocab.txt'), 'utf8').split(/\r?\n/)) if (l.trim().length >= 2) BRANDS.add(l.trim()); } catch { }
const ENDING = /(요|다|죠|네|지|든|면|서|고|는|던|를|을|에|의|도|만|까지|부터|라니|잖아|어요|해|봐|자|께)$/;
const BRAND_STOP = /^(자동|아무|무료|국민|국내|첫|새|신|올|온|전|총|각|매일|하루|오늘|내일|이번|다음|여름|가을|겨울|봄|추석|명절|아기|아이|유아|엄마|프리미엄|유기농|무항생제|국내산|제주|유럽|미국|독일|일본)$/;
for (const b of [...BRANDS]) if (BRAND_STOP.test(b) || !/^[가-힣A-Za-z][가-힣A-Za-z0-9]*$/.test(b)) BRANDS.delete(b);
const isBrand = (t) => BRANDS.has(t) || (t.length >= 3 && [...BRANDS].some(b => b.length >= 3 && t.startsWith(b)));
// 예고·안내 글의 꼬리말·머리말. 상품명이 아니다 (2026-09-09 검증자 실측 17건)
//   "오사닛 캔디 coming soon" · "올유베베 가을 PREVIEW" · "빌베리 D-day" · "제주항구 미리보기" · "베이비들 주목" — 국내유일·최대할인·가격표는 정상 상품명에도 쓰여 뺐다
const TEASER = /(coming\s*soon|coming|preview|미리보기|사전예약|예약판매|check\s*point|d-?day|주목|무물모음|무물|연장|선물세트포함)/i;
const JUNK_TOK = /^(or|초|Open|OPEN|open|EVENT|이벤트|자정|떴다링|X|x|카카오톡딜|일정|변경|역대|공유|할인사이트|\d{1,2}\/\d{1,2}|\d+|목|금|토|일|월|화|수)$/;
// 상품명은 **브랜드 낱말로 시작**해야 한다. 앞에 문장 조각이 붙어 있으면 브랜드부터 자르고, 뒤의 잡낱말은 뗀다.
//   "재 문의가 가장 많았던 아오라 우주빔" → "아오라 우주빔" · "9/10 목 유럽 1등 리오마레 참치" → "리오마레 참치"
const normalizeName = (s) => {
  let toks = s.split(/\s+/).filter(Boolean);
  const i = toks.findIndex(t => isBrand(t.replace(/[&+·,\/].*$/, '')));
  if (i < 0) return null;
  toks = toks.slice(i);
  while (toks.length > 1 && JUNK_TOK.test(toks[toks.length - 1])) toks.pop();
  // 판촉어 잔해(“최저가전” 의 “전”)는 PROMO_TAIL 이 productFrom 에서 이미 통째로 뗀다
  toks = toks.filter((t, k) => k === 0 || !JUNK_TOK.test(t));
  toks = toks.slice(0, 5);                                  // 브랜드 + 최대 4낱말
  return toks.join(' ').replace(/\s*[,.]\s*$/, '');
};
const goodName = (s) => {
  if (!s || s.length > 24 || TEASER.test(s) || SENTENCE.test(s) || SENTENCE2.test(s) || ENDING.test(s)) return false;
  if (/\s그\s|^그\s|그런|이런|저런|이거|요거/.test(s)) return false;
  const toks = s.split(/[\s&+·,\/]+/).filter(Boolean);
  if (!toks.length || !isBrand(toks[0])) return false;
  if (toks.length === 1 && toks[0].length < 3) return false;
  // 중간 낱말이 조사로 끝나면 문장 조각이다 ("휴대용을 …", "카시트에 …", "유모차에 …")
  //   의/도/다 는 정상 상품명에도 흔하다(모두의 육수·썼다 지웠다) → 을·를·에·으로·로 만 본다
  //   조사를 뗀 **줄기가 실제로 아는 낱말일 때만** 문장 조각으로 본다.
  //     카시트에 → 카시트(사전에 있다) = 문장 · 자동차마을 → 자동차마(없다) = 그냥 이름 · 라텔리에 → 라텔리(없다) = 브랜드
  //   로·으로 는 아예 보지 않는다 — 뽀로로·일프로·캠브로 처럼 브랜드가 너무 많다
  for (const t of toks.slice(0, -1)) {
    const m = t.match(/^(.+?)(을|를|에)$/);
    //   ⚠ isBrand 는 앞부분만 같아도 참이다(“카시트에” ← 카시트) → 예외는 **정확일치**로만 본다
    if (m && m[1].length >= 2 && !BRANDS.has(t) && !vocab.has(t) && (vocab.has(m[1]) || isBrand(m[1]))) return false;
  }
  //   되풀이는 이름이 **그 낱말 두 번뿐**일 때만 버린다("알텐바흐, 알텐바흐~ 하고").
  //     "사랑해 사랑해 + 사과가 쿵" 같은 책 제목은 되풀이가 정상이다
  if (toks.length === 2 && toks[0] === toks[1]) return false;
  return true;
};

const cleanFn = (fn) => { const s = (fn || '').split(/[|｜ㅣ·•\/(\[]/)[0].replace(/[^가-힣A-Za-z0-9\s]/g, '').trim(); return s.length >= 2 && s.length <= 12 ? s : ''; };   // 한글·영문·숫자만 (ꯁ 같은 장식문자 사고)

let kept = 0; const rows = [], names = new Map(), drops = [];
for (const p of posts) {
  const cap = (p.cap || '').replace(/\r/g, '');
  const why = (r) => drops.push(`${p.u}\t${p.t}\t${r}\t${cap.replace(/\s+/g, ' ').slice(0, 90)}`);
  if (p.ad) { why('광고'); continue; }
  if (EXCLUDED.has(p.u)) { why('제외 셀러'); continue; }
  if (OWN_PRODUCT.test(cap.slice(0, 200))) { why('사장님 상품(우랩·마이키즈·롤팬)'); continue; }
  if (!KW.test(cap)) { why('공구 언급 없음'); continue; }
  if (ENDED.test(cap)) { why('마감/종료 글'); continue; }
  if (NOT_GG.test(cap) && !/공구\s*(오픈|시작|예고|일정|중)/.test(cap)) { why('핫딜/체험단/협찬'); continue; }
  if (REVIEW.test(cap) && !/공구\s*(오픈|시작|예고|일정)/.test(cap)) { why('후기/인증 글'); continue; }
  const { open, end } = dateFrom(cap, p.t);
  if (!open) { why('오픈 날짜 없음'); continue; }
  if (open < addDays(today, -3) || open > addDays(today, 60)) { why(`날짜 범위 밖 ${open}`); continue; }
  const raw = productFrom(cap);
  if (!raw) { why('상품명 못 뽑음'); continue; }
  const name = normalizeName(raw);
  if (!name || !goodName(name)) { why(`상품명 불확실: ${raw}`); continue; }
  rows.push([p.u, p.u, name, open, end, ''].join('\t'));
  if (p.fn && !names.has(p.u)) { const n = cleanFn(p.fn); if (n) names.set(p.u, n); }
  kept++;
}
writeFileSync(outF, rows.join('\n') + (rows.length ? '\n' : ''));
writeFileSync(outF + '.names', [...names].map(([h, n]) => `${h}|${n}`).join('\n') + (names.size ? '\n' : ''));
writeFileSync(outF + '.drop', drops.join('\n') + (drops.length ? '\n' : ''));
if (!DRY) appendFileSync(SEEN, posts.map(p => p.code).join('\n') + (posts.length ? '\n' : ''));
console.log(`변환: 게시물 ${posts.length} → 공구 후보 ${kept} · 버림 ${drops.length} → ${path.relative(ROOT, outF)}`);
