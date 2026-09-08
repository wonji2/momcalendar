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

const seen = new Set(existsSync(SEEN) ? readFileSync(SEEN, 'utf8').split(/\r?\n/).filter(Boolean) : []);
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

const dateFrom = (cap, base) => {
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
  const c = cap.replace(/^"|"\.?$/g, '').replace(/https?:\/\/\S+/g, ' ').replace(/[#@]\S+/g, ' ');
  const lines = c.split(/\n+/).map(s => s.trim()).filter(Boolean);
  const pick = (s) => { const q = s.match(/[❝“"「『【<\[]([^❞”"」』】>\]]{2,40})[❞”"」』】>\]]/); return q ? q[1] : null; };
  const cands = [];
  for (const l of lines.slice(0, 6)) { const q = pick(l); if (q) cands.push(q); }
  for (const l of lines.slice(0, 4)) if (/공구|오픈|OPEN|공동구매/i.test(l)) cands.push(l);
  if (lines[0]) cands.push(lines[0]);
  for (let s of cands) {
    s = cleanName(s).replace(/[^\p{L}\p{N}\s&+·.,\/'\-]/gu, ' ');
    s = s.replace(/^[가-힣A-Za-z]{2,8}\s?[xX×]\s?/, '').replace(/핫딜|최저가|공구가|특가/g, ' ');   // "다니맘X기운찬 …" 셀러 접두·판촉어
    s = s.replace(PROMO, ' ').replace(/\s+/g, ' ').trim().replace(/^[\s,.·&+\/\-]+|[\s,.·&+\/\-]+$/g, '');
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
const SENTENCE2 = /(아시나요|된다고|배우는|그리고|돌아온|함께|인기폭발|폭발|인상전|가격 인상|만원대|천원대|원대|이라니|라니|미쳤|놀랬|가져왔|드디어|하자마자|품절되는|써보|먹어|마시|입히|신기|놓치|기다리|준비|소개|시작|끝|까지만|만에|무조건|필수|꿀템|찐|갓성비|가성비)/;
const goodName = (s) => {
  if (!s || s.length > 22 || SENTENCE.test(s) || SENTENCE2.test(s)) return false;
  const toks = s.split(/[\s&+·,\/]+/).filter(t => t.length >= 2);
  return toks.some(t => vocab.has(t) || [...vocab].some(v => v.length >= 3 && t.includes(v)));
};

const cleanFn = (fn) => { const s = (fn || '').split(/[|｜ㅣ·•\/(\[]/)[0].replace(/[^\p{L}\p{N}\s]/gu, '').trim(); return s.length >= 2 && s.length <= 12 ? s : ''; };

let kept = 0; const rows = [], names = new Map(), drops = [];
for (const p of posts) {
  const cap = (p.cap || '').replace(/\r/g, '');
  const why = (r) => drops.push(`${p.u}\t${p.t}\t${r}\t${cap.replace(/\s+/g, ' ').slice(0, 90)}`);
  if (p.ad) { why('광고'); continue; }
  if (!KW.test(cap)) { why('공구 언급 없음'); continue; }
  if (ENDED.test(cap)) { why('마감/종료 글'); continue; }
  if (NOT_GG.test(cap) && !/공구\s*(오픈|시작|예고|일정|중)/.test(cap)) { why('핫딜/체험단/협찬'); continue; }
  if (REVIEW.test(cap) && !/공구\s*(오픈|시작|예고|일정)/.test(cap)) { why('후기/인증 글'); continue; }
  const { open, end } = dateFrom(cap, p.t);
  if (!open) { why('오픈 날짜 없음'); continue; }
  if (open < addDays(today, -3) || open > addDays(today, 60)) { why(`날짜 범위 밖 ${open}`); continue; }
  const name = productFrom(cap);
  if (!name) { why('상품명 못 뽑음'); continue; }
  if (!goodName(name)) { why(`상품명 불확실: ${name}`); continue; }
  rows.push([p.u, p.u, name, open, end, ''].join('\t'));
  if (p.fn && !names.has(p.u)) { const n = cleanFn(p.fn); if (n) names.set(p.u, n); }
  kept++;
}
writeFileSync(outF, rows.join('\n') + (rows.length ? '\n' : ''));
writeFileSync(outF + '.names', [...names].map(([h, n]) => `${h}|${n}`).join('\n') + (names.size ? '\n' : ''));
writeFileSync(outF + '.drop', drops.join('\n') + (drops.length ? '\n' : ''));
appendFileSync(SEEN, posts.map(p => p.code).join('\n') + (posts.length ? '\n' : ''));
console.log(`변환: 게시물 ${posts.length} → 공구 후보 ${kept} · 버림 ${drops.length} → ${path.relative(ROOT, outF)}`);
