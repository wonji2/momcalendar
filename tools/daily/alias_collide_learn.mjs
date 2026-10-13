/**
 * 🧠 검색 겹침 학습기 — 「헤라」를 쳤는데 「헤라스」 김이 나오는 것을 **누적 데이터로** 찾아 막는다
 *   (사장님 2026-10-13 "헤라 치는데 헤라스가 나와" → "보일때마다 어케해 니가 전수조사해서 오류고쳐"
 *    → 2026-10-14 "글자수같이 단순한거 말고 누적 데이터로 규칙을 만들어야지 똑똑하게 학습해서")
 *
 * 왜: 챗봇·사이트 검색은 포함검색이라, 손님 말 A 가 다른 낱말 B 안에 들어 있으면 B 상품이 딸려 나온다.
 *     처음엔 "2~3글자 브랜드"라는 글자수 규칙으로 뽑아 손으로 판정했다 — 4글자·영문·새 브랜드는 안 봤고 매번 사람이 봐야 했다.
 *
 * 무엇으로 배우나 (전부 우리 DB 에 쌓인 것 — 외부 호출·AI·비용 0)
 *   ① 분류 이력   A 가 낱말로 쓰인 상품들의 대분류·소분류 분포  vs  B 가 쓰인 상품들의 분포
 *                  헤라 = 뷰티/메이크업 · 헤라스 = 식품/간식 → 겹침 0 → **다른 것**
 *                  주니 = 육아/육아용품 · 주니컵 = 육아/육아용품 → 겹침 큼 → **같은 브랜드**
 *   ② 함께 쓰임   B 상품명 안에 A 가 **따로도** 적혀 있으면 같은 브랜드(「주니 … 주니컵」)
 *   ③ 합성어      B = A + (DB 에서 품목으로 쓰이는 낱말)이면 같은 브랜드(주니+컵, 아넬라+퓨레)
 *   ④ 셀러 겹침   같은 셀러들이 A·B 를 같이 팔면 같은 브랜드일 가능성
 *   ⑤ 일반어 판정 A 가 여러 대분류에 고르게 퍼져 있거나(아기·미니) 대부분 이름 뒤쪽에 오면(스텐·오일) 브랜드가 아니라 꾸밈말·품목 → 건드리지 않는다
 *   ⑥ 손님 수요   site_search_stats(사이트 검색어 30일)에 실제로 찍힌 말을 먼저 본다
 *   ⑧ 낱말 쪼개기 B 에서 A 를 뺀 나머지가 **우리 DB 에 낱말로 쓰이는 말들로 쪼개지면** B 는 A 가 들어간 합성어다(추석+선물+로 · 하루+한알 · 오슬로+슬라이딩+선반).
 *                  안 쪼개지면 글자가 우연히 겹친 다른 말이다(헤라+스 · 주니+어 · 아미+노산 · 멀+티비+타민).
 *   🔴 글자수 기준은 어디에도 쓰지 않는다(사장님 2026-10-14 "누가 단순 글자수 기준 같은걸로 짤라 절대 그러지마"). 낱말인지·브랜드인지는 전부 쓰인 횟수·자리·분류로 판정한다.
 *
 * 판정
 *   AUTO    A·B 근거 행이 충분하고 대분류·소분류 겹침 0, 함께 쓰임 0, 합성어 아님 → --apply 면 bot_alias_deny 에 넣는다
 *   REVIEW  대분류는 같은데 소분류가 다르거나 근거 행이 적다 → 보고서에만(세션이 본다). 자동으로 넣지 않는다
 *   SAME    같은 브랜드로 본다 → 아무것도 안 한다
 *
 * 실행   node tools/daily/alias_collide_learn.mjs            보고서만
 *        node tools/daily/alias_collide_learn.mjs --apply    AUTO 를 bot_alias_deny 에 넣는다(note 에 근거 수치)
 *        node tools/daily/alias_collide_learn.mjs --eval     사람이 판정한 91쌍(2026-10-13)과 견줘 정밀도·재현율을 찍는다
 * 보고서 scratchpad/alias_collide_report.txt (최신이 맨 위)   상태파일 없음(매번 전체를 다시 잰다 — 3초)
 * 주기   예약작업 momcal-alias-collide 매일 05:10 (--apply). 새 브랜드가 들어오면 다음 날 새 겹침이 잡힌다
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { sbArgs, parseRows } from './sb_query.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
process.chdir(ROOT);
const CLI = 'C:/Users/FAMILY/supabase-cli/supabase.exe';
const APPLY = process.argv.includes('--apply'), EVAL = process.argv.includes('--eval');
const REPORT = path.join(ROOT, 'scratchpad', 'alias_collide_report.txt');
const TMP = path.join(ROOT, 'scratchpad', '_alias_collide_q.sql');

function q(sql) {
  fs.writeFileSync(TMP, sql);
  let last;
  for (let i = 0; i < 3; i++) {
    try {
      const r = parseRows(execFileSync(CLI, sbArgs(TMP), { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }));
      if (r.ok) return r.rows; last = r.why;
    } catch (e) { last = String(e.message || e).slice(0, 200); }
  }
  console.error('🔴 DB 조회 실패:', last); process.exit(1);
}

// ── 누적 데이터
const rows = q(`select name as n, coalesce(major,'') as mj, coalesce(minor,'') as mn, coalesce(insta,'') as s from gonggu where name is not null
union all select title, coalesce(major,''), coalesce(minor,''), '' from hotdeals where title is not null;`);
const demand = new Map(q(`select term, c30 from site_search_stats;`).map((r) => [String(r.term).trim().toLowerCase(), +r.c30 || 0]));
const have = new Set(q(`select term, expand from bot_alias_deny;`).map((r) => r.term + '\u0001' + r.expand));

const norm = (s) => String(s || '').toLowerCase();
const toks = (n) => norm(n).split(/[\s·,&/+()\[\]<>"'“”‘’:|_~!?.\-–—*#]+/).filter((t) => /[가-힣a-z]/.test(t));

// 낱말 → 통계
const T = new Map();
const stat = (t) => { let o = T.get(t); if (!o) T.set(t, o = { n: 0, first: 0, mj: new Map(), mn: new Map(), sel: new Set(), rows: [] }); return o; };
rows.forEach((r, i) => {
  const tk = [...new Set(toks(r.n))], f = toks(r.n)[0];
  for (const t of tk) {
    const o = stat(t); o.n++; if (t === f) o.first++;
    if (r.mj) o.mj.set(r.mj, (o.mj.get(r.mj) || 0) + 1);
    if (r.mn) o.mn.set(r.mj + '/' + r.mn, (o.mn.get(r.mj + '/' + r.mn) || 0) + 1);
    if (r.s) o.sel.add(r.s); o.rows.push(i);
  }
  r._t = new Set(tk);
});
const dist = (m) => { const s = [...m.values()].reduce((a, b) => a + b, 0) || 1; return new Map([...m].map(([k, v]) => [k, v / s])); };
const overlap = (a, b) => { const A = dist(a), B = dist(b); let s = 0; for (const [k, v] of A) s += Math.min(v, B.get(k) || 0); return s; };
const jacc = (a, b) => { if (!a.size || !b.size) return 0; let i = 0; for (const x of a) if (b.has(x)) i++; return i / (a.size + b.size - i); };

// ⑤ 일반어: 대분류 3개 이상에 각 12%↑ 로 퍼져 있거나, 8회 이상 쓰였는데 첫 낱말 비율이 25% 미만(품목·꾸밈말 자리)
const generic = (o) => {
  const d = [...dist(o.mj).values()].filter((v) => v >= 0.12).length;
  const dm = [...dist(o.mn).values()].filter((v) => v >= 0.1).length;   // 소분류 3개 이상에 10%↑ 씩 = 주제어·꾸밈말(추석·하루·마이·리틀)
  return d >= 3 || dm >= 3 || (o.n >= 8 && o.first / o.n < 0.25);
};
// ③ 품목 낱말: 5회 이상 쓰이고 첫 낱말 비율이 40% 미만 (컵·퓨레·캐리어·크레용 …)
const itemLike = (w) => { const o = T.get(w); return !!o && o.n >= 5 && o.first / o.n < 0.4; };

// ⑦ 문맥 낱말: 그 낱말과 한 상품명에 같이 적힌 다른 낱말들(어그 → 부츠·슬리퍼 / 바스 → 탈취제 / 바스켓 → 수납·욕실). 코사인 유사도로 견준다
const ctxOf = (o, skip) => { const m = new Map(); for (const i of o.rows) for (const t of rows[i]._t) if (!skip.has(t)) m.set(t, (m.get(t) || 0) + 1); return m; };
const cos = (x, y) => { let d = 0, nx = 0, ny = 0; for (const [k, v] of x) { nx += v * v; if (y.has(k)) d += v * y.get(k); } for (const v of y.values()) ny += v * v; return nx && ny ? d / Math.sqrt(nx * ny) : 0; };
const JOSA = new Set(['의', '은', '는', '이', '가', '을', '를', '에', '로', '와', '과', '도', '만', '랑', '판', 's', '엔', '에서', '으로']);
// ⑧ 붙여 쓴 합성어: B = A + (우리 DB 에 낱말로 있는 말)이면 같은 주제다(봄달+블랭킷 · 추석+선물로 · 스텐+진공쌀통 · 미니+두두).
//    반대로 나머지가 낱말이 아니면(헤라+스 · 주니+어 · 바스+켓 · 감+바스) 우연히 글자가 겹친 다른 말이다.
const isWord = (w) => { const o = T.get(w); return !!o && o.n >= 3; };          // DB 에 낱말로 3번 이상 쓰인 말
const memo = new Map();
const breakable = (str, tail) => {                                              // str 이 낱말들로(끝은 조사 허용) 빈틈없이 쪼개지는가
  if (!str) return true; const k = str + '|' + tail; if (memo.has(k)) return memo.get(k);
  let ok = false;
  for (let i = 1; i <= str.length && !ok; i++) { const h = str.slice(0, i), r = str.slice(i); ok = (isWord(h) && breakable(r, tail)) || (tail && !r && JOSA.has(h)); }
  memo.set(k, ok); return ok;
};
const glued = (b, a) => { const p = b.indexOf(a), L = b.slice(0, p), R = b.slice(p + a.length); return (L || R) && breakable(L, false) && breakable(R, true); };
const out = [];
for (const [a, A] of T) {
  if (A.n < 3 || A.first < 2) continue;                 // 브랜드 자리(첫 낱말)에 2번 이상 온 말만
  if (generic(A)) continue;
  for (const [b, B] of T) {
    if (b === a || !b.includes(a)) continue;
    const together = B.rows.filter((i) => rows[i]._t.has(a)).length / B.n;          // ②
    const rest = b.startsWith(a) ? b.slice(a.length) : b.endsWith(a) ? b.slice(0, -a.length) : '';
    const compound = !!rest && itemLike(rest);                                       // ③
    const oMj = overlap(A.mj, B.mj), oMn = overlap(A.mn, B.mn), js = jacc(A.sel, B.sel);
    const skip = new Set([a, b]), ctx = cos(ctxOf(A, skip), ctxOf(B, skip));
    let verdict, why;
    if (together >= 0.3) { verdict = 'SAME'; why = '함께 쓰임'; }
    else if (b.startsWith(a) && JOSA.has(rest)) { verdict = 'SAME'; why = '조사·꼬리(' + rest + ')'; }
    else if (b.startsWith(a) && compound && oMn > 0) { verdict = 'SAME'; why = '합성어(' + rest + ')'; }
    else if (ctx >= 0.15) { verdict = 'SAME'; why = '문맥 낱말 겹침'; }
    else if (glued(b, a)) { verdict = 'REVIEW'; why = '붙여 쓴 합성어'; }
    // ⑨ 브랜드 자리: 사람이 판정한 브랜드(주니 0.98·클라 0.88·터블 0.97·아미 0.92)는 상품명 맨 앞에 오고, 보통말(추석 0.27·한우 0.23·자동 0.27·하루 0.54)은 가운데에 온다.
    //    맨 앞 비율이 낮으면 브랜드가 아닐 수 있으니 자동으로 빼지 않는다(2026-10-14 실측으로 정한 경계 0.65).
    else if (A.first / A.n < 0.65) { verdict = 'REVIEW'; why = '브랜드 자리 아님'; }
    else if (oMj === 0 && oMn === 0 && B.mj.size) { verdict = 'AUTO'; why = '분류 겹침 0'; }
    // ⚠ A 로 시작하고 대분류가 겹치면 같은 브랜드의 라인일 수 있다(누비→누비타보, 어썸→어썸cm). 자동으로 빼지 않고 REVIEW 로 넘긴다.
    else if (ctx === 0 && oMn < 0.3 && together === 0 && !(b.startsWith(a) && oMj > 0)) { verdict = 'AUTO'; why = '문맥·소분류 겹침 0'; }
    else { verdict = 'REVIEW'; why = '같은 소분류·문맥 약함'; }
    out.push({ a, b, verdict, why, an: A.n, bn: B.n, oMj: +oMj.toFixed(2), oMn: +oMn.toFixed(2), js: +js.toFixed(2), ctx: +ctx.toFixed(2),
      acat: [...A.mn].sort((x, y) => y[1] - x[1])[0]?.[0] || '', bcat: [...B.mn].sort((x, y) => y[1] - x[1])[0]?.[0] || '',
      dem: demand.get(a) || 0, ex: rows[B.rows[0]].n });
  }
}
const by = (v) => out.filter((x) => x.verdict === v).sort((x, y) => y.dem - x.dem || y.an - x.an);
const auto = by('AUTO'), review = by('REVIEW'), same = by('SAME');
const fresh = auto.filter((x) => !have.has(x.a + '\u0001' + x.b));

if (EVAL) {
  // 사람이 2026-10-13 에 판정한 쌍(scratchpad/_alias_deny_1013.mjs 의 M)과 견준다 — expand 는 부분문자열이라 b.includes(expand) 로 맞춘다
  const src = fs.readFileSync(path.join(ROOT, 'scratchpad', '_alias_deny_1013.mjs'), 'utf8');
  const M = eval('(' + src.slice(src.indexOf('const M=') + 8, src.indexOf('};', src.indexOf('const M=')) + 1) + ')'); M['헤라'] = ['헤라스'];
  const isPos = (x) => (M[x.a] || []).some((e) => x.b.includes(e));
  const dom = out.filter((x) => M[x.a]);                // 사람이 본 낱말만
  const tp = dom.filter((x) => x.verdict === 'AUTO' && isPos(x)).length, fp = dom.filter((x) => x.verdict === 'AUTO' && !isPos(x));
  const fn = dom.filter((x) => x.verdict !== 'AUTO' && isPos(x));
  console.log(`사람 판정 낱말 ${Object.keys(M).length}개 범위: AUTO 적중 ${tp} · 사람은 안 뺐는데 AUTO ${fp.length} · 사람은 뺐는데 AUTO 아님 ${fn.length}`);
  console.log('\n[사람은 안 뺐는데 AUTO] ' + fp.map((x) => `${x.a}⊄${x.b}(${x.acat}|${x.bcat})`).join(' · '));
  console.log('\n[사람은 뺐는데 AUTO 아님] ' + fn.map((x) => `${x.a}⊄${x.b}→${x.verdict}:${x.why}(소${x.oMn},문맥${x.ctx})`).join(' · '));
}

const line = (x) => `${x.a}(${x.an}·${x.acat}) ⊄ ${x.b}(${x.bn}·${x.bcat})  검색${x.dem} 대${x.oMj} 소${x.oMn} 문맥${x.ctx} [${x.why}]  예:${x.ex}`;
const stamp = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');
let applied = 0;
if (APPLY && fresh.length) {
  const esc = (s) => "'" + String(s).replace(/'/g, "''") + "'";
  const r = q(`with i as (insert into bot_alias_deny(term,expand,note) values\n` + fresh.map((x) => `(${esc(x.a)},${esc(x.b)},${esc(`자동학습 ${stamp.slice(0, 10)} — ${x.why} (${x.acat} ↔ ${x.bcat}, 근거 ${x.an}/${x.bn}행)`)})`).join(',\n') + `\non conflict do nothing returning term) select count(*) as n from i;`);
  applied = +(r[0]?.n || 0);
}
const rep = `=== ${stamp} — 낱말 ${T.size} · 겹침쌍 ${out.length} · AUTO ${auto.length}(새것 ${fresh.length}${APPLY ? ', 넣음 ' + applied : ', 미적용'}) · REVIEW ${review.length} · SAME ${same.length}
[AUTO 새것]\n${fresh.map(line).join('\n') || '-'}
[REVIEW — 세션이 본다. 검색 많은 순 60]\n${review.slice(0, 60).map(line).join('\n') || '-'}\n\n`;
fs.writeFileSync(REPORT, rep + (fs.existsSync(REPORT) ? fs.readFileSync(REPORT, 'utf8').slice(0, 200000) : ''));
console.log(rep.split('\n')[0]);
