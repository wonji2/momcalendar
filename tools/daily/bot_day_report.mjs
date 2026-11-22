/**
 * 🤖 챗봇 하루 결산 — 실손님 발화·답변 형태·AI 호출·비용·사전 절감·오류를 한 번에 (2026-09-08 신설, 사장님 "오늘 하루 객관적으로")
 *
 * 실행  node tools/daily/bot_day_report.mjs            어제·오늘(KST) 두 날
 *       node tools/daily/bot_day_report.mjs 2026-09-07  그 날만
 * 읽는 것  events(kakao_bot · kakao_bot_ai · kakao_bot_ai_err · kakao_bot_miss) · bot_interp
 * 원칙  ⚠ 실손님 = event_data 에 'AHC'(카카오 서버 UA) 가 있는 것만. 감시·회귀 도구(bot_probe·bot_guard·VERIFY·F9TEST)는 뺀다.
 *       ⚠ 비용은 kakao_bot_ai 에 찍힌 토큰 수 × Haiku 4.5 단가($1/M 입력 · $5/M 출력) × 1,450원. 추정 아님.
 * 상태파일 없음(읽기 전용). supabase CLI 경로는 SUPABASE_CLI 또는 C:/Users/FAMILY/supabase-cli/supabase.exe
 */
import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const SB = process.env.SUPABASE_CLI || 'C:/Users/FAMILY/supabase-cli/supabase.exe';
const TMP = 'scratchpad/_bot_day.sql';
const run = (sql) => {
  writeFileSync(TMP, sql, 'utf8');
  const out = execFileSync(SB, ['db', 'query', '--linked', '-f', TMP], { encoding: 'utf8', timeout: 180000 });
  const i = out.indexOf('"rows"'); if (i < 0) return [];
  const j = out.lastIndexOf('{', i);
  try { return JSON.parse(out.slice(j)).rows || []; } catch (_) { return []; }
};
const KST = "(visited_at at time zone 'Asia/Seoul')";
const day = process.argv[2];
const days = day ? [day] : (() => { const d = new Date(Date.now() + 9 * 3600e3); const t = d.toISOString().slice(0, 10); d.setUTCDate(d.getUTCDate() - 1); return [d.toISOString().slice(0, 10), t]; })();
const BOT = ["'BOTPROBE'", "'VERIFY'", "'F9TEST'", "'GUARD'"];
const real = `event_type='kakao_bot' and event_data like '%AHC%'`;
const USD = 1450;

for (const D of days) {
  const W = `${KST}::date = '${D}'`;
  console.log(`\n══════════ ${D} (KST) ══════════`);

  // ① 실손님 발화·답변 형태
  const shape = run(`
    select split_part(event_data,' | ',3) shape, count(*) n, count(distinct split_part(split_part(event_data,' | ',2),':',1)) users
      from events where ${real} and ${W} group by 1 order by 2 desc;`);
  const total = shape.reduce((a, r) => a + Number(r.n), 0);
  const users = run(`select count(distinct split_part(split_part(event_data,' | ',2),':',1)) u from events where ${real} and ${W};`)[0]?.u ?? 0;
  const card = shape.filter(r => /carousel|listCard/.test(r.shape)).reduce((a, r) => a + Number(r.n), 0);
  const basic = shape.filter(r => /basicCard/.test(r.shape)).reduce((a, r) => a + Number(r.n), 0);
  const txt = shape.filter(r => /textCard/.test(r.shape)).reduce((a, r) => a + Number(r.n), 0);
  console.log(`① 실손님 발화 ${total}건 · 손님 ${users}명 · 공구카드 ${card}(${pct(card, total)}) · 핫딜카드 ${basic}(${pct(basic, total)}) · 글 ${txt}(${pct(txt, total)})`);

  // ② AI 호출 (전체 vs 실손님 발화와 짝지어지는 것)
  const ai = run(`
    select event_data d, to_char(${KST},'HH24:MI:SS') t from events where event_type='kakao_bot_ai' and ${W} order by visited_at;`);
  const aiErr = run(`select event_data d, to_char(${KST},'HH24:MI:SS') t from events where event_type='kakao_bot_ai_err' and ${W} order by visited_at;`);
  const realUtts = new Set(run(`select distinct split_part(event_data,' | ',1) u from events where ${real} and ${W};`).map(r => r.u));
  let inTok = 0, outTok = 0, ms = [], realAi = 0;
  const parsed = ai.map(r => {
    const m = r.d.match(/^(.*) => ([a-z]+):(.*) \| (\d+)\/(\d+)tok \| (\d+)ms$/);
    if (!m) return null;
    inTok += +m[4]; outTok += +m[5]; ms.push(+m[6]);
    const isReal = realUtts.has(m[1]); if (isReal) realAi++;
    return { t: r.t, u: m[1], intent: m[2], q: m[3], ms: +m[6], real: isReal };
  }).filter(Boolean);
  const cost = (inTok / 1e6 * 1 + outTok / 1e6 * 5) * USD;
  ms.sort((a, b) => a - b);
  const p = (k) => ms.length ? ms[Math.min(ms.length - 1, Math.floor(ms.length * k))] : 0;
  console.log(`② AI 호출 ${parsed.length}건(실손님 발화 ${realAi}건 · 나머지는 도구/검증) · 오류 ${aiErr.length}건 · 토큰 입력 ${inTok} 출력 ${outTok} · 비용 ${cost.toFixed(1)}원 · 소요 중앙 ${p(0.5)}ms / 90% ${p(0.9)}ms / 최대 ${ms[ms.length - 1] ?? 0}ms`);
  console.log(`   실손님 발화 대비 AI 비율 ${pct(realAi, total)} · 실손님 1건당 비용 ${(total ? cost / total : 0).toFixed(2)}원`);
  for (const e of aiErr) console.log(`   🔴 AI 오류 ${e.t} ${e.d}`);

  // ③ AI 가 실손님 말을 어떻게 해석했나 (전건 — 사람이 눈으로 볼 것)
  console.log(`③ 실손님 발화의 AI 해석 (${realAi}건)`);
  for (const r of parsed.filter(x => x.real)) console.log(`   ${r.t} 「${r.u}」 → ${r.intent}${r.q ? ':' + r.q : ''} (${r.ms}ms)`);

  // ④ 실손님이 답 못 받은 말 (textCard) — 되풀이 포함
  const miss = run(`
    select split_part(event_data,' | ',1) u, count(*) n from events
     where ${real} and ${W} and split_part(event_data,' | ',3) like '%textCard%'
     group by 1 order by 2 desc, 1 limit 40;`);
  console.log(`④ 글로만 답한 실손님 발화 ${miss.length}종 (인사·핫딜안내 포함)`);
  for (const r of miss) console.log(`   ${r.n > 1 ? r.n + '× ' : ''}「${r.u}」`);

  // ⑤ 실패 → 3분 안 성공 쌍 (손님이 말 바꿔 다시 친 것 = 우리가 못 알아들은 증거)
  const pairs = run(`
    with t as (select visited_at, split_part(event_data,' | ',1) utt, split_part(split_part(event_data,' | ',2),':',1) uid, split_part(event_data,' | ',3) shape
                 from events where ${real} and ${W}),
    p as (select uid, to_char(visited_at at time zone 'Asia/Seoul','HH24:MI') t1, utt a, shape sa,
                 lead(utt) over (partition by uid order by visited_at) b, lead(shape) over (partition by uid order by visited_at) sb,
                 extract(epoch from (lead(visited_at) over (partition by uid order by visited_at) - visited_at)) gap from t)
    select t1, a, b from p where b is not null and gap <= 180 and sa like '%textCard%' and sb not like '%textCard%' order by t1;`);
  console.log(`⑤ 손님이 말 바꿔 성공한 쌍 ${pairs.length}건`);
  for (const r of pairs) console.log(`   ${r.t1} 「${r.a}」 ✗ → 「${r.b}」 ✓`);
}

// ⑥ 사전 상태 (누적)
const dict = run(`
  select count(*) rows_, coalesce(sum(hits),0) hits, count(*) filter (where ok_cards) ok, count(*) filter (where hits>0) reused,
         count(*) filter (where intent='search' and q='') emptyq, count(*) filter (where src<>'ai') human
    from bot_interp;`)[0] || {};
const savedWon = Number(dict.hits) * 0.0009 * USD; // 호출 1건 ≈ 800 입력 + 20 출력 토큰 ≈ $0.0009
console.log(`\n⑥ 해석 사전 누적: ${dict.rows_}행 · 재사용 ${dict.reused}행 · 아낀 호출 ${dict.hits}건(≈${savedWon.toFixed(1)}원) · 답 나간 적 있음 ${dict.ok} · 사람 확정 ${dict.human} · search인데 q 빈 것 ${dict.emptyq}`);
const susp = run(`
  select utt, intent, q, hits from bot_interp
   where (intent='search' and (q='' or length(q) > length(utt))) or (intent<>'search' and hits >= 3 and not ok_cards)
   order by hits desc limit 15;`);
if (susp.length) { console.log('   ⚠ 의심 항목(q 비었거나 원문보다 김 · 재사용 많은데 답 안 나감):'); for (const r of susp) console.log(`   「${r.utt}」 → ${r.intent}:${r.q} (hits ${r.hits})`); }

function pct(a, b) { return b ? Math.round(100 * a / b) + '%' : '-'; }
