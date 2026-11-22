/**
 * 🔍 집계 사이트(공구팡팡·공구모아)에 있는 공구가 우리 DB 에 다 있는지 대조하고, 없는 것을 **수확 형식 TSV** 로 내놓는다 (2026-10-07)
 *   사장님: "공구팡팡이 오늘 있는글들 우리 다 올린거 맞아? 공구모아 사이트에 있는것도 우리가 전부 다 미리 갖고 있어야해"
 *
 * 입력(둘 다 aggregator_fetch.mjs 가 만든다)
 *   scratchpad/_gonggumoa_latest.json  [{major,minor,open,end,name,seller,insta}]
 *   scratchpad/_pangpang_today.tsv     핸들\t상품\t날짜표기\t상태\t대분류\t소분류\t팔로워\t태그
 * 대조  같은 핸들(lower insta) · 오픈일 ±3 · 이름 nameMatch(verify_judge) ≥ 1 → 「있음」.
 *       🔴 2026-10-07 교훈: 한글명으로 짝을 지으면 DB 셀러명 표기가 달라(「째째홈 대표 공선영」) 있는 것도 「없음」으로 나온다.
 *          공구모아 원천엔 핸들이 있으니 **핸들로만** 본다. 핸들이 없는 행만 한글명 폴백.
 * 미리 거르는 것(등록 파이프라인에 넣지 않는다)
 *   · 마감 지난 것 · 제외 셀러(parsing_excluded.txt) · 사장님 상품(우랩·마이키즈·롤팬) · 상품이 아닌 것(라이브방송·쿠킹클래스) · 두 글자 이하
 * 출력
 *   scratchpad/aggregator_gap_<날짜>.md        사람이 보는 보고
 *   scratchpad/_agg_gm_clean.tsv / _agg_pp_clean.tsv   harvest_clean.mjs 가 받는 6열(핸들·슬러그·상품·오픈·마감·url)
 *   scratchpad/_agg_kr.json                    핸들→집계처 한글명 (DB 에 한글명이 없는 새 셀러에만 쓴다)
 * 실행  node tools/daily/aggregator_gap.mjs [--pangpang f] [--gonggumoa f]
 *   ⚠ 집계처 값은 틀릴 수 있다(메모리 cafe-lead-dates-are-wrong). source 에 출처가 남으니 틀리면 그 채널을 끊는다.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nameMatch, dayGap } from './verify_judge.mjs';
import { loadSlugResolver } from '../../scratchpad/_slug_resolver.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SP = (f) => path.join(ROOT, 'scratchpad', f);
const SB = 'C:/Users/FAMILY/supabase-cli/supabase.exe';
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const ppF = arg('--pangpang', SP('_pangpang_today.tsv')), gmF = arg('--gonggumoa', SP('_gonggumoa_latest.json'));
const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const addDays = (s, n) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
const nk = (s) => String(s || '').toLowerCase().replace(/[\s·.,_\-]/g, '');

const EXC = new Set(existsSync(SP('parsing_excluded.txt')) ? readFileSync(SP('parsing_excluded.txt'), 'utf8').split(/\r?\n/)
  .filter((l) => l.trim() && !l.trim().startsWith('#')).map((l) => l.split(/\t|\s{2,}/)[0].trim().toLowerCase()) : []);
const MINE = /우랩|마이키즈|롤팬/;
const NOTPROD = /라이브\s*방송|라방|쿠킹\s*클래스|클래스$|세미나|강의|이벤트$|응모|추첨/;

// DB — 최근 3주 전부터 앞으로 전부(승인 여부 무관: 내려둔 것도 「이미 알고 있는 것」이다)
const qf = SP('_agg_db.sql');
writeFileSync(qf, `select id, name, lower(coalesce(insta,'')) insta, coalesce(influencer,'') infl, open_date, end_date, approved from public.gonggu where open_date >= '${addDays(today, -21)}';`);
let db = [];
for (let t = 1; t <= 3; t++) {
  try {
    const raw = execFileSync(SB, ['db', 'query', '--linked', '--file', qf, '--output-format', 'json'], { encoding: 'utf8', timeout: 300000, maxBuffer: 64 * 1024 * 1024 });
    const m = raw.match(/\{[\s\S]*\}|\[[\s\S]*\]/); const j = JSON.parse(m[0]); db = Array.isArray(j) ? j : (j.rows || []); break;
  } catch (e) { if (t === 3) { console.log('🔴 DB 를 못 읽었다 — 대조 불가: ' + String(e.message).slice(0, 120)); process.exit(1); } Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20000); }
}
const byHandle = new Map(), byName = new Map();
for (const r of db) { if (r.insta) (byHandle.get(r.insta) || byHandle.set(r.insta, []).get(r.insta)).push(r); const k = nk(r.infl); if (k && /[가-힣]/.test(k)) (byName.get(k) || byName.set(k, []).get(k)).push(r); }
console.log(`DB ${db.length}행 · 핸들 ${byHandle.size} · 한글명 ${byName.size}`);
// 🔴 집계처 핸들 칸엔 **인포크 슬러그**가 섞여 있다(deelisa→de_elisa_shop · 2026-10-07 dry 회차: 슬러그 그대로 대조해 DB 에 있는 것을 「없음」으로 냈다).
//    대조 **전에** 슬러그를 핸들로 바꾼다 — 게이트의 --fix 는 대조 뒤라서 늦다.
const slugRes = loadSlugResolver(); console.log(`슬러그 표 ${slugRes.size}쌍 (${slugRes.source})`);
const canon = (h) => { const x = String(h || '').toLowerCase().replace(/^@/, ''); return (slugRes.resolve && slugRes.resolve(x)) || x; };
const CNT = existsSync(SP('_gonggumoa_handle_counts.json')) ? JSON.parse(readFileSync(SP('_gonggumoa_handle_counts.json'), 'utf8')) : {};
const NEW = {};   // DB 에 없는 새 셀러 핸들 → 집계처 등장 횟수 (1회뿐이면 오타일 수 있어 등록기가 검토로 뺀다)

const found = (cands, name, open) => { let best = null; for (const r of cands) { if (open && dayGap(open, r.open_date) > 3) continue; const s = nameMatch(name, r.name); if (s >= 1 && (!best || s > best.s)) best = { s, r }; } return best; };
const parseDates = (s) => { const d = [...String(s).matchAll(/(\d{1,2})\/(\d{1,2})/g)].map((x) => `2026-${String(x[1]).padStart(2, '0')}-${String(x[2]).padStart(2, '0')}`); return { open: d[0] || '', end: d[1] || '' }; };
const skipWhy = (h, name, end) => {
  if (end && end < today) return '마감지남';
  if (EXC.has(h)) return '제외셀러';
  if (MINE.test(name)) return '사장님상품';
  if (NOTPROD.test(name)) return '상품아님';
  if (name.replace(/[^가-힣a-z0-9]/gi, '').length <= 2) return '이름짧음';
  return '';
};
const KR = {}; const out = []; const sum = {};

// ── 공구팡팡 ──
if (existsSync(ppF)) {
  const rows = readFileSync(ppF, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => l.split('\t'));
  let ok = 0, miss = [], skip = {}; const clean = [];
  for (const [h0, name, dates, status] of rows) {
    const h = canon(h0); let { open, end } = parseDates(dates); if (!open) continue; if (!end) end = addDays(open, 3);
    const why = skipWhy(h, name, end) || (/종료/.test(status) ? '마감지남' : ''); if (why) { skip[why] = (skip[why] || 0) + 1; continue; }
    const cands = byHandle.get(h) || [];
    if (found(cands, name, open)) { ok++; continue; }
    miss.push([h, name, open, end, status, cands.length ? '' : '새 셀러']);
    clean.push([h, '', name, open, end, ''].join('\t'));
  }
  writeFileSync(SP('_agg_pp_clean.tsv'), clean.join('\n') + (clean.length ? '\n' : ''));
  sum.pangpang = { total: rows.length, ok, miss: miss.length, skip };
  out.push(`## 공구팡팡 ${today} — ${rows.length}건: 있음 ${ok} · 없음 ${miss.length} · 뺀 것 ${JSON.stringify(skip)}`, '', '| 핸들 | 상품 | 오픈 | 마감 | 상태 | 비고 |', '|---|---|---|---|---|---|');
  for (const r of miss) out.push(`| ${r.join(' | ')} |`);
}

// ── 공구모아 ──
if (existsSync(gmF)) {
  const rows = JSON.parse(readFileSync(gmF, 'utf8'));
  let ok = 0, miss = [], unknown = [], skip = {}; const clean = []; const seen = new Set();
  for (const r of rows) {
    const h = canon(r.insta);
    const why = skipWhy(h, r.name, r.end) || skipWhy((r.insta || '').toLowerCase(), r.name, r.end); if (why) { skip[why] = (skip[why] || 0) + 1; continue; }
    let cands = h ? (byHandle.get(h) || []) : [];
    if (!h) { cands = byName.get(nk(r.seller)) || []; if (!cands.length) { unknown.push(r); continue; } }
    if (found(cands, r.name, r.open)) { ok++; continue; }
    const hh = h || cands[0].insta; if (!hh) { unknown.push(r); continue; }
    const key = `${hh}|${nk(r.name)}|${r.open}`; if (seen.has(key)) continue; seen.add(key);
    if (r.seller && /[가-힣]/.test(r.seller)) KR[hh] = KR[hh] || r.seller;
    if (!cands.length) NEW[hh] = Math.max(NEW[hh] || 0, CNT[(r.insta || '').toLowerCase()] || 1);
    miss.push([hh, r.seller, r.name, r.open, r.end, `${r.major}/${r.minor}`, cands.length ? '' : '새 셀러']);
    clean.push([hh, '', r.name, r.open, r.end, ''].join('\t'));
  }
  writeFileSync(SP('_agg_gm_clean.tsv'), clean.join('\n') + (clean.length ? '\n' : ''));
  sum.gonggumoa = { total: rows.length, ok, miss: miss.length, unknown: unknown.length, newSellers: miss.filter((m) => m[6]).length, skip };
  out.push('', `## 공구모아 ${today} — 마감 안 지난 ${rows.length}건: 있음 ${ok} · 없음 ${miss.length}(새 셀러 ${sum.gonggumoa.newSellers}) · 핸들도 한글명도 모름 ${unknown.length} · 뺀 것 ${JSON.stringify(skip)}`, '', '| 핸들 | 셀러 | 상품 | 오픈 | 마감 | 집계처 분류 | 비고 |', '|---|---|---|---|---|---|---|');
  for (const r of miss) out.push(`| ${r.join(' | ')} |`);
  if (unknown.length) { out.push('', '### 핸들 없음(한글명도 DB 에 없음)', ''); for (const r of unknown) out.push(`- ${r.seller} | ${r.name} | ${r.open}`); }
}
writeFileSync(SP('_agg_kr.json'), JSON.stringify(KR));
writeFileSync(SP('_agg_newseller.json'), JSON.stringify(NEW));
writeFileSync(SP(`aggregator_gap_${today}.md`), out.join('\n') + '\n');
console.log(JSON.stringify(sum));
console.log('→ ' + SP(`aggregator_gap_${today}.md`));
