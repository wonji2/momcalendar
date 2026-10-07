/**
 * 🤖 집계 사이트(공구모아·공구팡팡) 누락분을 **무인으로 등록까지** 돌리는 회차 (2026-10-07)
 *   사장님: "공구팡팡이 오늘 있는글들 우리 다 올린거 맞아? 공구모아 사이트에 있는것도 우리가 전부 다 미리 갖고 있어야해"
 *   (파싱은 무인으로 등록까지 — 메모리 parsing-runs-unattended · 하루 1,000건 목표 + 검수 계속 — daily-1000-target-qa-first)
 *
 * 흐름 (parsing_nightly.mjs ⑤ 와 같은 게이트를 쓴다 — 다른 기준을 새로 만들지 않는다)
 *   ① aggregator_fetch.mjs   집계처 두 곳 받기
 *   ② aggregator_gap.mjs     핸들 기준 DB 대조 → 없는 것만 수확 형식 TSV (_agg_gm_clean / _agg_pp_clean)
 *   ③ harvest_clean → harvest_to_table(catvocab)   분류 못 찍은 건 _agg_uncls_<날짜>.tsv 로 빼서 **사람(세션)이 본다**
 *   ④ 새 셀러 한글명 채우기 — DB 에 한글명이 없는 핸들만 집계처 한글명(_agg_kr.json) 을 쓴다(있는 셀러는 DB 표기가 이긴다)
 *   ⑤ 게이트: drop_ended → pending_dedupe → _drop_excluded → _drop_rejected → _slug_as_handle_check --fix → pending_check.sh(DB 중복·제외·사장님상품·핸들갈림)
 *      걸린 핸들이 이름 지어지면 _drop_gate_blockers 로 그 행만 빼고 다시 검사
 *   ⑥ 규칙 0-M — 내 공구(momcal_) 창(오픈−14~마감) 안의 같은 상품(브랜드 첫 낱말·Dice≥0.55) 은 뺀다
 *   ⑦ CATS_LIST 밖 분류 뺌 · 회차 상한 RUN_CAP
 *   ⑧ gen_insert_gonggu.mjs --source gonggumoa|pangpang → _split_insert → CLI 실행(조각마다 2번) → 전후 count 로 등록 수
 * 실행  node tools/daily/aggregator_register.mjs [--dry]     (예약작업 momcal-aggregator, 07:05·19:05 — xx:40 무인 파싱과 겹치지 않게)
 * 로그  scratchpad/aggregator_log.txt (현황판 ops_status_push LOGS.aggregator)
 * 🔑 등록 0건이어도 "포화" 가 아니라 게이트 로그를 본다(메모리 dup-check-can-be-too-wide).
 */
import { readFileSync, writeFileSync, appendFileSync, existsSync, readdirSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sbArgs, parseRows } from './sb_query.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SP = (f) => path.join(ROOT, 'scratchpad', f);
const TD = (f) => path.join(ROOT, 'tools', 'daily', f);
const NODE = process.execPath;
const SB = 'C:/Users/FAMILY/supabase-cli/supabase.exe';
const BASH = 'C:/Program Files/Git/bin/bash.exe';
const DRY = process.argv.includes('--dry');
const RUN_CAP = 300;
const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const now = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');
const LOG = SP('aggregator_log.txt');
const log = (s) => { const l = `[${now()}] ${s}`; console.log(l); try { appendFileSync(LOG, l + '\n'); } catch (_) {} };
const addDays = (s, n) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
const wait = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";

/** 종료코드와 무관하게 stdout 을 돌려준다 — 게이트는 걸린 게 있으면 1 을 내는 게 정상이다(2026-09-29 교훈) */
function run(args, timeout = 600e3, exe = NODE) {
  try { return execFileSync(exe, args, { encoding: 'utf8', timeout, cwd: ROOT, maxBuffer: 64 * 1024 * 1024 }); }
  catch (e) { return String(e.stdout || '') + String(e.stderr || ''); }
}
function cli(sqlFile, timeout = 300e3) {
  let last = '';
  for (let t = 1; t <= 3; t++) {
    try { const out = execFileSync(SB, sbArgs(sqlFile), { encoding: 'utf8', timeout, cwd: ROOT, maxBuffer: 32 * 1024 * 1024 }); const got = parseRows(out); if (got.ok) return got.rows; last = out.slice(0, 200); }
    catch (e) { last = String(e.stdout || e.message || '').slice(0, 200); }
    wait(20000);
  }
  throw new Error('CLI 실패: ' + last);
}
const CATS = {
  '육아': ['장난감/놀이','교구/교육','책','이유아식','의류잡화','방꾸미기','스킨로션','유모차카시트','육아용품','외출용품','목욕/세정'],
  '리빙': ['생활용품','주방용품','침구/패브릭','청소/세제','욕실용품','테이블웨어','헬스케어'],
  '식품': ['음료/차/즙','간식/구황작물','수산물/건해산','과일/야채','정육/계란','간편식/밀키트','유제품','장류/오일/소스','반찬','떡/베이커리','견과류','선물세트'],
  '건강': ['유산균','비타민','오메가','철분제','키즈영양제','홍삼/면역','다이어트','건강기능성'],
  '인테리어': ['가구','패브릭','조명','데코소품','수납정리','홈오피스'],
  '가전': ['생활가전','주방가전','청소가전','계절가전','영상가전','취미/디지털기기','컴퓨터용품','헬스케어'],
  '뷰티': ['스킨케어','메이크업','헤어케어','바디케어','구강케어','향수','뷰티디바이스'],
  '패션': ['이너웨어','신발','가방','스포츠웨어','액세서리','의류','키즈'],
  '여행': ['호텔/숙소','항공권','패키지/투어','체험/티켓','여행용품'],
  '반려동물': ['강아지','고양이','사료','간식'],
};
const norm2 = (s) => String(s || '').toLowerCase().replace(/[^가-힣a-z0-9]/g, '');
const big2 = (s) => { const o = new Set(); for (let i = 0; i < s.length - 1; i++) o.add(s.slice(i, i + 2)); return o; };
const dice2 = (a, b) => { if (!a || !b) return 0; if (a === b) return 1; const A = big2(a), B = big2(b); if (!A.size || !B.size) return 0; let h = 0; for (const x of A) if (B.has(x)) h++; return (2 * h) / (A.size + B.size); };

/** 승인표(md) 행 읽기/쓰기 — 누적 헤더 형식 | # | 셀러 | 상품명 | 오픈 | 마감 | 대분류 | 소분류 | 핸들 | */
const HEAD = ['| # | 셀러 | 상품명 | 오픈 | 마감 | 대분류 | 소분류 | 핸들 |', '|---|---|---|---|---|---|---|---|'];
const readTable = (f) => readFileSync(f, 'utf8').split(/\r?\n/).filter((l) => /^\|\s*\d+\s*\|/.test(l)).map((l) => { const c = l.split('|').map((s) => s.trim()); return { kr: c[2], name: c[3], open: c[4], end: c[5], mj: c[6], mi: c[7], h: c[8] }; });
const writeTable = (f, rows) => writeFileSync(f, [...HEAD, ...rows.map((r, i) => `| ${i + 1} | ${r.kr || ''} | ${r.name} | ${r.open} | ${r.end} | ${r.mj} | ${r.mi} | ${r.h} |`)].join('\n') + '\n');

log(`── 집계 회차 시작${DRY ? ' (dry)' : ''} ──`);
// ① ② 받기 · 대조
const f1 = run([TD('aggregator_fetch.mjs')], 600e3); log('① ' + f1.trim().split('\n').pop());
if (/error/.test(f1)) { log('🔴 집계처를 못 받았다 — 회차 종료'); process.exit(1); }
const g1 = run([TD('aggregator_gap.mjs')], 600e3); log('② ' + (g1.match(/\{.*\}/) || [''])[0]);
if (/🔴/.test(g1)) { log('🔴 대조 실패 — 회차 종료'); process.exit(1); }

const KR = existsSync(SP('_agg_kr.json')) ? JSON.parse(readFileSync(SP('_agg_kr.json'), 'utf8')) : {};
// ⑥ 내 공구 창
let MINE = [];
try {
  writeFileSync(SP('_agg_mine.sql'), `select name, open_date, end_date from public.gonggu where insta = 'momcal_' and approved and end_date >= '${addDays(today, -1)}';`);
  MINE = cli(SP('_agg_mine.sql')).map((r) => ({ ...r, from: addDays(r.open_date, -14), brand: String(r.name).trim().split(/\s+/)[0] }));
} catch (e) { log('⚠ 내 공구를 못 읽었다 — 규칙 0-M 검사를 못 하므로 회차 종료: ' + e.message.slice(0, 100)); process.exit(1); }
/** 규칙 0-M 은 **품목 기준**이다(사장님 2026-10-06 "같은 품목이면 삭제" · 검증자 2026-10-07: 「룩트 그릭 요거트」가 「요거쪽쪽 요거트」 창을 비켜 갔다).
 *  브랜드 첫 낱말 · Dice 0.55 에 더해 **내 상품명의 마지막 낱말(품목: 요거트·자석블럭·우유·천연해면스펀지)** 이 상대 이름의 마지막 낱말과 포함관계면 같은 품목으로 본다. */
const lastTok = (s) => { const t = String(s || '').trim().toLowerCase().split(/\s+/); return t[t.length - 1] || ''; };
const myHit = (name, open) => {
  const n = norm2(name), lt = lastTok(name);
  for (const m of MINE) {
    if (open < m.from || open > m.end_date) continue;
    if (dice2(n, norm2(m.name)) >= 0.55) return m;
    if (m.brand.length >= 3 && name.toLowerCase().startsWith(m.brand.toLowerCase())) return m;
    const ml = lastTok(m.name); if (ml.length >= 2 && lt.length >= 2 && (ml.includes(lt) || lt.includes(ml))) return m;
  }
  return null;
};
/** 🔴 자체 안전망 — 게이트가 못 잡은 것(검증자 2026-10-07: 11쌍이 라이브로 나갔다)
 *   · 같은 핸들 ±3일: 정규화 이름이 같거나 포함관계면 **중복(뺌)**, Dice ≥ 0.45 거나 (오픈·마감이 같고 2글자 이상 낱말이 겹치면) **의심(검토 파일)**
 *   · 괄호가 안 닫힌 이름 · 막연한 이름(브랜드 없는 흔한 품목 한 낱말) → 검토 파일 (등록 안 함) */
const STOPW = new Set(['모음전', '기획전', '특집', '신상', '세트', '2차', '3차', '4차', '5차', '정기', '할인', '모음', '신제품', '리뉴얼', '성인', '키즈', '아기', '유아', '어린이', '국산', '전제품']);
const VAGUE = /^(계란|초유|키티|해물\s*모음|애착\s*인형|패밀리\s*잠옷|아기\s*목도리|생일\s*키트.*|집게|휴대용\s*루크|수면조끼\s*신상|바스\s*탈취제|클라\s*전제품|홈스쿨링\s*교구특집|곡물도자기\s*식판|도자기\s*식판|보풀제거기|진공쌀보관함|맥세이프\s*거치대|애착\s*원피스.*|라이브.*|.*라방.*)$/;
const tokset = (s) => new Set(String(s || '').toLowerCase().replace(/[()\[\]&/,+·]/g, ' ').split(/\s+/).filter((w) => w.length >= 2 && !STOPW.has(w) && !/^\d+차$/.test(w)));
function nearDupKind(existing, r) {
  const n = norm2(r.name); const tk = tokset(r.name);
  for (const g of existing) {
    const gap = Math.abs((Date.parse(g.open_date + 'T00:00:00Z') - Date.parse(r.open + 'T00:00:00Z')) / 864e5);
    if (!(gap <= 3)) continue;
    const gn = norm2(g.name); if (!gn) continue;
    if (gn === n || (n.length >= 4 && gn.includes(n)) || (gn.length >= 4 && n.includes(gn))) return { kind: 'dup', g };
    const d = dice2(n, gn); if (d >= 0.45) return { kind: 'suspect', g, why: `닮음 ${d.toFixed(2)}` };
    if (g.open_date === r.open && g.end_date === r.end) { const gt = tokset(g.name); for (const w of tk) if (gt.has(w)) return { kind: 'suspect', g, why: `같은 기간 + 「${w}」 겹침` }; }
  }
  return null;
}

const flushReview = (review) => { if (!review.length) return; appendFileSync(SP(`_agg_review_${today}.tsv`), review.map(([s, w, r]) => [s, w, r.h, r.name, r.open, r.end, r.mj, r.mi].join('\t')).join('\n') + '\n'); review.length = 0; };
const cntSql = SP('_agg_cnt.sql'); writeFileSync(cntSql, 'select count(*) as n from public.gonggu;\n');
const readCnt = () => { try { return Number(cli(cntSql)[0].n); } catch (_) { return -1; } };
let budget = RUN_CAP; const result = {};

for (const [src, tag] of [['gonggumoa', 'gm'], ['pangpang', 'pp']]) {
  const cleanF = SP(`_agg_${tag}_clean.tsv`);
  const n0 = existsSync(cleanF) ? readFileSync(cleanF, 'utf8').split(/\r?\n/).filter(Boolean).length : 0;
  if (!n0) { log(`${src}: 없는 것 0건`); result[src] = { miss: 0, reg: 0 }; continue; }
  // ③ 세척·분류
  const clean2 = SP(`_agg_${tag}_clean2.tsv`), tableF = SP(`승인대기_${src}_${today.replace(/-/g, '')}_${now().slice(11).replace(':', '')}.md`), unclsF = SP(`_agg_${tag}_uncls.tsv`);
  run([SP('harvest_clean.mjs'), cleanF, clean2]);
  const t3 = run([SP('harvest_to_table.mjs'), clean2, SP('catvocab.json'), tableF, unclsF]);
  const uncls = existsSync(unclsF) ? readFileSync(unclsF, 'utf8').split(/\r?\n/).filter(Boolean) : [];
  if (uncls.length) appendFileSync(SP(`_agg_uncls_${today}.tsv`), uncls.map((l) => src + '\t' + l).join('\n') + '\n');
  let rows = existsSync(tableF) ? readTable(tableF) : [];
  log(`③ ${src}: 없는 것 ${n0} → 세척 뒤 표 ${rows.length} · 미분류 ${uncls.length}(세션이 본다: _agg_uncls_${today}.tsv)`);
  if (!rows.length) { result[src] = { miss: n0, reg: 0, uncls: uncls.length }; continue; }
  // ④ 새 셀러 한글명 — DB 에 한글명이 있는 핸들은 건드리지 않는다
  const hs = [...new Set(rows.map((r) => r.h.toLowerCase()))];
  let named = new Set();
  try {
    writeFileSync(SP('_agg_named.sql'), `select lower(insta) insta from public.gonggu where lower(insta) in (${hs.map(q).join(',')}) and influencer ~ '[가-힣]' group by 1;`);
    named = new Set(cli(SP('_agg_named.sql')).map((r) => r.insta));
  } catch (e) { log('⚠ 셀러 한글명 조회 실패 — 집계처 한글명을 쓰지 않는다(등록기가 핸들로 채운다)'); named = new Set(hs); }
  let filled = 0; for (const r of rows) { if (!named.has(r.h.toLowerCase()) && KR[r.h.toLowerCase()]) { r.kr = KR[r.h.toLowerCase()]; filled++; } }
  // 14일 상한(DB등록규칙 1) — 검증자 2026-10-07: 「2026 호주 정품 UGG」 10/01~10/15 가 상한 없이 들어갔다
  let capped = 0; for (const r of rows) { const max = addDays(r.open, 13); if (!r.end || r.end > max) { r.end = max; capped++; } if (r.end < r.open) r.end = addDays(r.open, 3); }
  // 검토로 빼는 것(등록 안 함): 괄호 안 닫힘 · 막연한 이름 · 집계처에 1번만 나온 새 셀러 핸들(오타 가능: won_monny/won_moony)
  const review = []; const NEW = existsSync(SP('_agg_newseller.json')) ? JSON.parse(readFileSync(SP('_agg_newseller.json'), 'utf8')) : {};
  rows = rows.filter((r) => {
    const o = (r.name.match(/[(（\[]/g) || []).length, c = (r.name.match(/[)）\]]/g) || []).length;
    if (o !== c) { review.push([src, '괄호 안 닫힘', r]); return false; }
    if (VAGUE.test(r.name.trim())) { review.push([src, '막연한 이름', r]); return false; }
    const h = r.h.toLowerCase(); if (!named.has(h) && NEW[h] !== undefined && NEW[h] < 2) { review.push([src, '새 셀러 핸들 1회(오타?)', r]); return false; }
    return true;
  });
  // ⑥ ⑦ 규칙 0-M · CATS
  const dropped = { mine: 0, cats: 0 };
  rows = rows.filter((r) => { if (!CATS[r.mj] || !CATS[r.mj].includes(r.mi)) { dropped.cats++; return false; } const m = myHit(r.name, r.open); if (m) { dropped.mine++; log(`  🚫 규칙 0-M: @${r.h} 「${r.name}」(${r.open}) — 내 공구 「${m.name}」(${m.open_date}~${m.end_date}) 창 안`); return false; } return true; });
  writeTable(tableF, rows);
  log(`④⑥⑦ ${src}: 새 셀러 한글명 ${filled}건 채움 · 14일상한 ${capped} · 검토로 ${review.length} · 0-M ${dropped.mine} · 분류밖 ${dropped.cats} → ${rows.length}행 (${path.basename(tableF)})`);
  if (!rows.length) { flushReview(review); result[src] = { miss: n0, reg: 0, uncls: uncls.length, review: review.length }; continue; }
  // ⑤ 게이트
  for (const g of ['drop_ended.mjs', 'pending_dedupe.mjs', '_drop_excluded.mjs', '_drop_rejected.mjs']) if (existsSync(SP(g))) run([SP(g), tableF]);
  if (existsSync(SP('_slug_as_handle_check.mjs'))) run([SP('_slug_as_handle_check.mjs'), tableF, '--fix']);
  let gate = run([SP('pending_check.sh'), tableF], 900e3, BASH);
  const GATEOUT = SP(`_agg_gate_${tag}.txt`); writeFileSync(GATEOUT, gate);
  const num = (k) => { const m = gate.match(new RegExp(k + '"?:\\s*"?(\\d+)')); return m ? +m[1] : -1; };
  const blocked = () => ['excluded', 'own_product', 'slug_as_handle', 'handle_split'].filter((k) => num(k) > 0);
  const toolFail = /실행 실패|SyntaxError|at file:\/\/\//.test(gate);
  if (blocked().length && /승인표핸들|\s+→\s+/.test(gate) && existsSync(SP('_drop_gate_blockers.mjs'))) {
    run([SP('_drop_gate_blockers.mjs'), tableF, GATEOUT]);
    gate = run([SP('pending_check.sh'), tableF], 900e3, BASH); writeFileSync(GATEOUT, gate);
  }
  const bl = blocked();
  log(`⑤ ${src}: 게이트 already_in_db ${num('already_in_db')} · is_new ${num('is_new')} · 막힘 ${bl.join(',') || '없음'}${toolFail ? ' · ⚠ 게이트 도구 오류(전문 ' + path.basename(GATEOUT) + ')' : ''}`);
  if (bl.length || toolFail || num('is_new') < 0) { log(`  ⛔ ${src}: 게이트 미통과 — 등록하지 않는다. 표는 남겨둔다`); result[src] = { miss: n0, reg: 0, gate: bl, uncls: uncls.length }; continue; }
  rows = readTable(tableF);
  // ⑤-b 자체 중복 안전망 — 같은 핸들의 기존 행(승인 여부 무관, 40일)을 읽어 JS 로 한 번 더 본다
  const hs2 = [...new Set(rows.map((r) => r.h.toLowerCase()))]; let ex = [];
  if (hs2.length) {
    try { writeFileSync(SP('_agg_exist.sql'), `select id, lower(insta) insta, name, open_date, end_date from public.gonggu where lower(insta) in (${hs2.map(q).join(',')}) and open_date >= '${addDays(today, -40)}';`); ex = cli(SP('_agg_exist.sql')); }
    catch (e) { log(`  🔴 ${src}: 기존 행을 못 읽었다 — 중복 안전망 없이는 등록하지 않는다`); flushReview(review); result[src] = { miss: n0, reg: 0, fail: 'exist-query' }; continue; }
  }
  const byH = new Map(); for (const g of ex) (byH.get(g.insta) || byH.set(g.insta, []).get(g.insta)).push(g);
  let dupN = 0;
  rows = rows.filter((r) => { const k = nearDupKind(byH.get(r.h.toLowerCase()) || [], r); if (!k) return true; if (k.kind === 'dup') { dupN++; return false; } review.push([src, `의심 ${k.why} ↔ #${k.g.id} ${k.g.name}(${k.g.open_date})`, r]); return false; });
  writeTable(tableF, rows); flushReview(review);
  log(`⑤-b ${src}: 자체 중복 ${dupN} · 검토로 뺀 것 모두 ${review.length}(_agg_review_${today}.tsv) → ${rows.length}행`);
  if (rows.length > budget) { log(`  ⚠ 회차 상한 ${RUN_CAP} — ${rows.length}행 중 ${budget}행만`); rows = rows.slice(0, budget); writeTable(tableF, rows); }
  if (!rows.length) { result[src] = { miss: n0, reg: 0, uncls: uncls.length }; continue; }
  // ⑧ 등록
  const insF = SP(`_agg_ins_${tag}.sql`);
  for (const f of readdirSync(SP('.'))) if (new RegExp(`^_agg_ins_${tag}_\\d+\\.sql$`).test(f)) unlinkSync(SP(f));
  run([SP('gen_insert_gonggu.mjs'), tableF, insF, '--source', src]);
  run([SP('_split_insert.mjs'), insF, SP(`_agg_ins_${tag}_`), '120']);
  const parts = readdirSync(SP('.')).filter((f) => new RegExp(`^_agg_ins_${tag}_\\d+\\.sql$`).test(f) && !/_99\.sql$/.test(f)).sort();
  if (DRY) { log(`  (dry) ${src}: 조각 ${parts.length}개 — 실행 안 함`); result[src] = { miss: n0, table: rows.length, dry: true }; continue; }
  const b = readCnt(); let fail = 0;
  for (const p of parts) {
    let done = false;
    for (let t = 1; t <= 2 && !done; t++) { try { execFileSync(SB, ['db', 'query', '--linked', '--file', SP(p), '--output-format', 'json'], { encoding: 'utf8', timeout: 900e3 }); done = true; } catch (_) { wait(15000); } }
    if (!done) fail++;
  }
  const a = readCnt(); const reg = (a >= 0 && b >= 0) ? a - b : -1;
  budget -= Math.max(reg, 0);
  log(`⑧ ${src}: 표 ${rows.length}행 → 등록 +${reg}${fail ? ` · 조각 실패 ${fail}` : ''}`);
  result[src] = { miss: n0, table: rows.length, reg, uncls: uncls.length };
}
log(`── 끝 ${JSON.stringify(result)} ──`);
