// ⏰ 공구 오픈 시각 정확도·채움률 장부 (사장님 2026-10-27 「정확도가 80%이상일때 올리든말든 결정할거니까 지켜보고 수집하는거 디벨롭해봐」)
//
// 재는 것 (오픈 오늘~+14일, 승인된 행)
//   ① 공구팡팡 일치율(참고) = 우리 시각과 공구팡팡 시각(0시 아닌 것)이 둘 다 있는 행 중 같은 비율 — **정확도가 아니다**(공구팡팡이 쉽게 읽은 행만 겹친다. 검증자가 찾은 틀린 꼴을 하나도 못 잡았다)
//      진짜 정확도 = 표본을 원본 캡션·인포크와 사람이 대조한 값(scratchpad/open_time_sample_<날짜>.json → verifier) — 사장님 보고엔 이것을 쓴다
//                공구팡팡은 원본이 아니지만(규칙 0-J) 우리와 따로 캡션을 읽은 눈이라 대조 기준으로 쓴다. 다르면 셀러 원문으로 누가 맞는지 본다
//   ② 공구팡팡이 시각을 아는 공구 중 우리도 아는 비율(채움률)
//   ③ 전체 채움률 = 시각 있는 행 / 전체 행 (시각을 안 밝힌 공구도 많아 100% 가 될 수 없다 — 공구팡팡도 799건 중 341건만 시각이 있다)
// 기준 자료: scratchpad/agg_cache/last_pangpang.json(agg_sites_c 6시간) · scratchpad/open_time_collect/pp_leads.jsonl · scratchpad/_pangpang_today.tsv
// 쓰기: scratchpad/open_time_accuracy.md(최신) · scratchpad/open_time_accuracy.tsv(회차마다 한 줄 — 하루 8줄, 1년 ~200KB)
// 실행  node tools/daily/open_time_report.mjs        (open_time_collect 가 회차 끝에 부른다)
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { sbArgs, parseRows } from './sb_query.mjs';
import { nameMatch } from './verify_judge.mjs';

const MAIN = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SP = (...f) => path.join(ROOT, 'scratchpad', ...f);
const CLI = process.env.SUPABASE_CLI || 'C:/Users/FAMILY/supabase-cli/supabase.exe';
const KST = () => new Date(Date.now() + 9 * 3600e3).toISOString();
const TODAY = KST().slice(0, 10);
const addDays = (d, n) => { const [y, m, dd] = d.split('-').map(Number); return new Date(Date.UTC(y, m - 1, dd + n)).toISOString().slice(0, 10); };
const pad = (n) => String(n).padStart(2, '0');

function sql(text) {
  const rel = `scratchpad/_otr_${process.pid}_${Date.now()}.sql`;
  fs.writeFileSync(path.join(ROOT, rel), text, 'utf8');
  try {
    for (let i = 0; ; i++) {
      try { const r = parseRows(execFileSync(CLI, sbArgs(rel), { encoding: 'utf8', cwd: ROOT, timeout: 120000, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 26 })); if (!r.ok) throw new Error(r.why); return r.rows; }
      catch (e) { if (i >= 2) throw e; }
    }
  } finally { try { fs.unlinkSync(path.join(ROOT, rel)); } catch { } }
}

// 공구팡팡 시각 모음 [{h, name, open, t}] — 0시는 「시각 없음」 기본값이라 뺀다
export function loadPangpangTimes() {
  const out = [];
  try { for (const x of JSON.parse(fs.readFileSync(SP('agg_cache', 'last_pangpang.json'), 'utf8'))) if (x.open_time && x.open_time !== '00:00' && x.handle && x.open) out.push({ h: String(x.handle).toLowerCase(), name: x.name || '', open: x.open, t: x.open_time }); } catch { }
  try { for (const l of fs.readFileSync(SP('open_time_collect', 'pp_leads.jsonl'), 'utf8').split('\n')) { try { const o = JSON.parse(l); if (o.hm && o.open) out.push({ h: o.h, name: o.title || '', open: o.open, t: o.hm }); } catch { } } } catch { }
  try {
    for (const l of fs.readFileSync(SP('_pangpang_today.tsv'), 'utf8').split(/\r?\n/)) {
      const c = l.split('\t'); const md = (c[2] || '').match(/^(\d{1,2})\/(\d{1,2})/);
      if (c[8] && c[8] !== '00:00' && md) { const y = +md[1] < +TODAY.slice(5, 7) - 6 ? +TODAY.slice(0, 4) + 1 : +TODAY.slice(0, 4); out.push({ h: c[0].toLowerCase(), name: c[1], open: `${y}-${pad(md[1])}-${pad(md[2])}`, t: c[8] }); }
    }
  } catch { }
  return out;
}

if (MAIN) {
  const rows = sql(`select id, name, lower(coalesce(insta,'')) insta, open_date, open_time, coalesce(open_time_src,'') src from public.gonggu
    where approved and coalesce(insta,'') <> '' and open_date >= '${TODAY}' and open_date <= '${addDays(TODAY, 14)}';`);
  const pp = loadPangpangTimes();
  const by = new Map(); for (const x of pp) { const k = `${x.h}|${x.open}`; if (!by.has(k)) by.set(k, []); by.get(k).push(x); }
  let both = 0, same = 0, ppKnown = 0, weKnowToo = 0; const diff = [], miss = [];
  const bySrc = {};
  for (const r of rows) {
    const m = (by.get(`${r.insta}|${r.open_date}`) || []).filter((x) => nameMatch(r.name, x.name) >= 2);
    const ts = [...new Set(m.map((x) => x.t))];
    if (ts.length !== 1) continue;            // 공구팡팡 안에서도 여럿이면 기준으로 안 쓴다
    ppKnown++;
    if (r.open_time) {
      weKnowToo++; both++;
      const s = (bySrc[r.src] = bySrc[r.src] || { both: 0, same: 0 }); s.both++;
      if (r.open_time === ts[0]) { same++; s.same++; } else diff.push(`#${r.id} ${r.insta} 「${r.name}」 ${r.open_date} 우리 ${r.open_time}(${r.src}) 공구팡팡 ${ts[0]}`);
    } else miss.push(`#${r.id} ${r.insta} 「${r.name}」 ${r.open_date} 공구팡팡 ${ts[0]}`);
  }
  const withT = rows.filter((r) => r.open_time).length;
  const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);
  const acc = pct(same, both), cov = pct(weKnowToo, ppKnown), all = pct(withT, rows.length);
  const srcTxt = Object.entries(bySrc).map(([k, v]) => `${k} ${v.same}/${v.both}`).join(' · ');
  const stamp = KST().slice(0, 16).replace('T', ' ');
  const tsv = SP('open_time_accuracy.tsv');
  if (!fs.existsSync(tsv)) fs.writeFileSync(tsv, 'when\trows\twith_time\tall_pct\tpp_known\twe_too\tcov_pct\tboth\tsame\tacc_pct\n');
  fs.appendFileSync(tsv, [stamp, rows.length, withT, all, ppKnown, weKnowToo, cov, both, same, acc].join('\t') + '\n');
  const md = [`# 공구 오픈 시각 정확도 (${stamp}, 오픈 ${TODAY}~${addDays(TODAY, 14)})`, '',
    `- 공구팡팡 일치율(참고, 정확도 아님): **${acc}%** (${same}/${both})${srcTxt ? ` · 출처별 ${srcTxt}` : ''}`,
    `- 공구팡팡이 시각을 아는 공구 중 우리도 아는 비율: **${cov}%** (${weKnowToo}/${ppKnown})`,
    `- 전체 중 시각 있는 행: ${all}% (${withT}/${rows.length}) · 공구팡팡도 시각 있는 건 ${pp.length ? '절반 남짓' : '-'}`,
    '', `## 다른 것 ${diff.length}건 (셀러 원문으로 누가 맞는지 본다)`, ...diff.slice(0, 40).map((x) => `- ${x}`),
    '', `## 공구팡팡만 아는 것 ${miss.length}건 (수집할 몫)`, ...miss.slice(0, 60).map((x) => `- ${x}`)];
  fs.writeFileSync(SP('open_time_accuracy.md'), md.join('\n') + '\n');
  console.log(md.slice(0, 6).join('\n'));
}
