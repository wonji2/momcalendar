/**
 * 🛡 카카오톡 챗봇 24시간 무인 감시 (사장님 지시 2026-09-01
 *    "니가 스스로 계속 처리해 내가 자는동안에도 굴러가게 24시간 문의는 들어오니까")
 *
 * 하는 일 — 30분마다 스스로 돌며 **이상하면 경보를 남긴다**
 *   ① 생존   : 대표 발화 3개를 실제로 물어본다. 하나라도 응답 없으면 🔴 챗봇장애
 *   ② 회귀   : bot_probe 105건을 돌려 어제까지 되던 것이 깨졌는지 본다 (30분마다는 무거우니 정시에만)
 *   ③ 실패율 : 최근 30분 손님 발화 중 카드를 못 받은 비율. 50% 넘으면 🔴
 *   ④ 못찾음 : 손님이 찾았는데 DB 에 없는 브랜드를 모아 파싱 우선순위로 남긴다
 *
 * 경보는 두 곳에 남는다 — 사람이 자고 있어도 아침에 보인다
 *   · DB `health_alerts`  (세션이 시작할 때 무조건 보는 곳)
 *   · scratchpad/bot_guard_log.txt (최신이 맨 위)
 *
 * 실행      node tools/daily/bot_guard.mjs [--full]
 * 예약작업  momcal-bot-guard — 30분마다 (Claude 앱 무관)
 * ⚠ 이 도구는 챗봇을 고치지 않는다. 고치는 것은 사람 몫이고, 이건 **놓치지 않게** 하는 장치다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { checkSpec } from './kakao_spec.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
process.chdir(ROOT);                 // ⚠ 예약작업 cwd 는 System32 — supabase --linked 가 프로젝트를 못 찾는다
const CLI = 'C:/Users/FAMILY/supabase-cli/supabase.exe';
const SB = 'https://hycaqsqeogjtbscmzrtm.supabase.co';
const LOG = path.join(ROOT, 'scratchpad', 'bot_guard_log.txt');
const FULL = process.argv.includes('--full') || new Date(Date.now() + 9 * 3600e3).getMinutes() < 30;

const MISS_MSG = /진행 중이거나 예정인 게 없|다룬 적이 없/;   // ⚠ '지난번에는' 안내와 겹치지 않게 좁힌 것
//   🔑 실패 판정은 "카드가 없다" 가 아니라 "못 찾음 안내를 냈다" 로 한다 (사장님 지적 2026-09-02).
//      "맘방사랑해" 는 이스터에그가 정상 응답하는데 카드가 아니라는 이유로 매 회차 구멍으로 올라왔다.
const out = [];
const say = (s) => { console.log(s); out.push(s); };
const sql = (text) => {
  const f = path.join(ROOT, 'scratchpad', '_guard_tmp.sql');
  fs.writeFileSync(f, text);
  try {
    const o = execFileSync(CLI, ['db', 'query', '--linked', '-f', f], { encoding: 'utf8', maxBuffer: 1 << 24 });
    const m = o.match(/"rows":\s*(\[[\s\S]*?\])\s*,?\s*\n\s*"warning"/) || o.match(/"rows":\s*(\[[\s\S]*\])/);
    return m ? JSON.parse(m[1]) : [];
  } finally { try { fs.unlinkSync(f); } catch (_) {} }
};
const alert = (kind, detail) => {
  const q = (t) => "'" + String(t).replace(/'/g, "''") + "'";
  try { sql(`insert into health_alerts(kind, detail) values (${q(kind)}, ${q(detail.slice(0, 400))});`); } catch (_) {}
};
let slowest = 0, slowestSay = '';
const ask = async (utterance) => {
  const _t0 = Date.now();
  const j = await fetch(`${SB}/functions/v1/kakao-skill`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userRequest: { utterance, user: { id: 'BOTGUARD' } } }),
  }).then((r) => r.json());
  const _ms = Date.now() - _t0;
  if (_ms > slowest) { slowest = _ms; slowestSay = utterance; }
  const o = j?.template?.outputs?.[0] || {};
  return { card: !!(o.carousel || o.listCard || o.basicCard), text: o.textCard?.text || '', raw: o, ms: _ms, spec: checkSpec(o) };
};

const now = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');
say(`===== ${now} 챗봇 감시 =====`);
let bad = 0;

// ① 생존
const PING = ['오늘 공구', '물티슈', '안녕', '뽀사카', '네뷸라이저zzz없는거'];   // 뽀사카=basicCard(핫딜 폴백) 경로, 2026-09-02 규격 사고가 여기서 났다   // 마지막은 가장 느린 경로(별칭 많고 결과 없음)
for (const p of PING) {
  try {
    const r = await ask(p);
    if (!r.card && !r.text) { bad++; say(`🔴 생존 실패 "${p}" — 응답이 비었습니다`); }
    else if (/일시적으로 조회/.test(r.text)) { bad++; say(`🔴 조회 장애 "${p}"`); }
    // 📏 우리 서버가 200 을 보내도 규격을 어기면 카카오가 말풍선을 버린다 (2026-09-02 실사고)
    else if (r.spec && r.spec.length) { bad++; say(`📏 규격 위반 "${p}" — ${r.spec.join(' / ')}`);
      alert('챗봇규격위반', `"${p}" — ${r.spec.join(' / ')} · 카카오가 말풍선을 버려 손님에겐 무응답이 된다`); }
  } catch (e) { bad++; say(`🔴 생존 실패 "${p}" — ${String(e.message || e).slice(0, 60)}`); }
}
if (!bad) say(`① 생존 정상 (가장 느린 응답 ${slowest}ms)`);
// ⏱ 카카오는 늦으면 "폴백 스킬 오류" 를 낸다(권장 3초·최대 5초). 느려지는 순간을 기록해 둔다.
if (slowest > 3000) { bad++; say(`🔴 응답 지연 ${slowest}ms — "${slowestSay}" (카카오 폴백 오류 위험)`);
  alert('챗봇응답지연', `${slowest}ms — "${slowestSay}" · 카카오는 늦으면 폴백 스킬 오류로 처리한다`); }
else if (slowest > 2000) say(`⚠ 응답이 조금 느립니다 (${slowest}ms · "${slowestSay}")`);
if (bad) alert('챗봇장애', `대표 발화 ${bad}건 실패 — 손님이 지금 답을 못 받고 있습니다`);

// ② 회귀 (정시에만 — 105건은 무겁다)
if (FULL) {
  try {
    const o = execFileSync(process.execPath, [path.join(ROOT, 'tools', 'daily', 'bot_probe.mjs')],
      { encoding: 'utf8', maxBuffer: 1 << 24 });
    const head = o.split('\n').find((l) => l.startsWith('총 ')) || '';
    const m = head.match(/장애 (\d+).*다름 (\d+).*엉뚱한답 (\d+)/);
    const n = m ? Number(m[1]) + Number(m[2]) + Number(m[3]) : 0;
    say(`② 회귀 점검 — ${head.trim()}`);
    if (n > 0) {
      const lines = o.split('\n').filter((l) => /^[🔴⚠🟠]/.test(l)).slice(0, 8);
      lines.forEach((l) => say('   ' + l.trim()));
      alert('챗봇회귀', `${head.trim()} | ${lines.join(' / ').slice(0, 300)}`);
    }
  } catch (e) { say('② 회귀 점검 실패: ' + String(e.message || e).slice(0, 80)); }
}

// ③ 최근 30분 손님 실패율
try {
  const r = sql(`
    select count(*)::int total,
           count(*) filter (where split_part(event_data,' | ',3) = 'textCard')::int miss
      from events where event_type='kakao_bot' and event_data like '%AHC%'
       and visited_at > now() - interval '30 minutes';`);
  const t = Number(r[0]?.total || 0), ms = Number(r[0]?.miss || 0);
  if (t >= 6) {
    const pct = Math.round(ms / t * 100);
    say(`③ 최근 30분 손님 ${t}건 중 카드 못 받음 ${ms}건 (${pct}%)`);
    if (pct >= 50) alert('챗봇실패율', `최근 30분 실패율 ${pct}% (${ms}/${t}) — 말귀를 못 알아듣고 있을 수 있습니다`);
  } else say(`③ 최근 30분 손님 ${t}건 (표본 부족)`);
} catch (e) { say('③ 실패율 조회 실패'); }

// ④ 손님이 찾는데 우리에게 없는 것 → 파싱 우선순위
//   🔴 raw 집계만 하면 **이미 고친 것을 며칠씩 계속 보고**한다 (사장님 지적 2026-09-02)
//      "이치비" 는 우리가 말끝 야 를 깎아 만든 유령이었고(그날 고침),
//      "네뷸라이저" 는 별칭으로 묶여 지금은 정상 응답한다. 둘 다 파싱할 것이 아니다.
//   → 목록을 **지금 다시 물어보고**, 여전히 못 찾는 것만 남긴다. ⑤ 와 같은 사상이다.
try {
  const gap = sql(`
    select split_part(event_data,' <= ',1) kw,
           (array_agg(split_part(event_data,' <= ',2) order by visited_at desc))[1] u,   -- 손님이 실제로 친 말
           count(*)::int c
      from events where event_type='kakao_bot_miss'
       and visited_at > now() - interval '24 hours'
       and split_part(event_data,' <= ',1) ~ '^[가-힣A-Za-z0-9 ]{2,20}$'
       and split_part(event_data,' <= ',1) !~ '(존재|테스트|zzz|ㅁㄴㅇㄹ)'
     group by 1 order by 3 desc limit 15;`);
  const real = [];   // 지금도 못 찾는 것
  const fixed = [];  // 그 사이 해결된 것 (별칭·오타 시정·새로 등록)
  for (const g of gap) {
    try {
      // 🔑 추출된 키워드가 아니라 **손님이 친 말 그대로** 물어본다.
      //    "맘방사랑해"(정상 응답)를 "맘방사랑"(0건)으로 물어 유령을 만들던 것을 막는다.
      const r = await ask(g.u || g.kw);
      // 카드가 나오거나 "지난번에는" 안내가 나오면 우리가 다루는 브랜드다 → 파싱 대상이 아니다
      if (r.card || !MISS_MSG.test(r.text || "")) fixed.push(g); else real.push(g);
    } catch (_) { real.push(g); }   // 물어보다 실패하면 보수적으로 남긴다
  }
  if (fixed.length) say(`④ 이미 해결됨 ${fixed.length}건 (보고에서 뺀다) — ` + fixed.map((g) => g.kw).join(" · "));
  if (real.length) {
    say('④ 손님이 찾는데 DB 에 없는 것 (파싱 우선순위)');
    say('   ' + real.map((g) => `${g.kw}(${g.c})`).join(' · '));
    const f = path.join(ROOT, 'scratchpad', 'bot_gap_report.md');
    const body = `# ${now} 손님이 찾았는데 없는 브랜드\n\n`
      + '> 목록은 **지금 다시 물어봐서 여전히 못 찾는 것만** 남긴 것입니다.\n'
      + '> 별칭·오타로 이미 해결된 말은 여기 없습니다.\n\n'
      + '| 브랜드·품목 | 물어본 횟수 |\n|---|---|\n'
      + real.map((g) => `| ${g.kw} | ${g.c} |`).join('\n')
      + '\n\n> 손님이 돈 쓰려고 물어본 것입니다. 이 브랜드부터 파싱하면 바로 매출로 이어집니다.\n';
    fs.writeFileSync(f, body);
  } else if (gap.length) {
    say('④ 손님이 못 찾은 말은 전부 지금은 해결됐다 (파싱할 것 없음)');
  }
} catch (e) { say('④ 갭 조회 실패'); }


// ⑤ 손님이 말을 바꿔 다시 친 쌍 (앞 실패 → 3분 내 성공) — 우리 구멍이다
//    2026-09-02 에 '노리터보드 공궤' → 16초 뒤 '노리터보드' 성공을 이걸로 찾았다.
//    손님이 우리 대신 고쳐 쓰고 있다는 뜻이라, 회귀 109건으로는 절대 안 잡힌다.
try {
  const flip = sql(`
    with t as (
      select visited_at, split_part(event_data,' | ',1) utt,
             split_part(split_part(event_data,' | ',2),':',1) uid,
             split_part(event_data,' | ',3) shape
        from events
       where event_type='kakao_bot' and visited_at > now() - interval '24 hours'
         and event_data like '%AHC%'
    ), p as (
      select t.utt a, lead(t.utt) over (partition by t.uid order by t.visited_at) b,
             t.shape sa, lead(t.shape) over (partition by t.uid order by t.visited_at) sb,
             extract(epoch from (lead(t.visited_at) over (partition by t.uid order by t.visited_at) - t.visited_at)) gap
        from t
    )
    select a, b from p
     where b is not null and gap <= 180
       and sa like '%textCard%' and sb not like '%textCard%'
       and a !~ '(핫딜|특가|할인|세일)'          -- 핫딜 안내는 설계상 textCard 다
     limit 12;`);
  // 🔑 지금도 그런지 다시 물어본다 — 이미 고친 옛 로그가 매 회차 뜨면 진짜 문제가 묻힌다
  const still = [];
  for (const r of flip) {
    try {
      const res = await ask(r.a);
      if (MISS_MSG.test(res.text || "")) still.push(r);   // 못 찾음 안내를 냈을 때만 진짜 구멍이다
    } catch (_) { /* 물어보지 못하면 판단 보류 */ }
  }
  if (still.length) {
    say('⑤ 손님이 말을 바꿔 다시 침 ' + still.length + '건 (지금도 실패) — 앞 표현이 우리 구멍이다');
    still.forEach((r) => say('   🔸 "' + r.a + '" 실패 → "' + r.b + '" 성공'));
  } else say('⑤ 말 바꿔 다시 친 것 ' + flip.length + '건 — 전부 지금은 정상 ✅');
} catch (e) { say('⑤ 조회 실패'); }

// ⑥ 브랜드가 어미·조사로 깎였는지 (추출어가 원문의 앞부분)
//    2026-09-02: '이치비야'→'이치비' · '닥터포이'→'닥터포' 를 이걸로 찾았다.
//    ⚠ 어미 목록에 글자를 더할 때마다 이 검사가 다음 사고를 잡는다.
try {
  const cut = sql(`
    select distinct split_part(event_data,' <= ',1) kw, split_part(event_data,' <= ',2) raw
      from events
     where event_type='kakao_bot_miss' and visited_at > now() - interval '24 hours'
       and event_data like '%<=%'
       and split_part(event_data,' <= ',2) !~ '[[:space:]]'        -- 한 낱말일 때만
       and split_part(event_data,' <= ',2) !~ '(존재|테스트|zzz|ㅁㄴㅇㄹ)'
       and length(split_part(event_data,' <= ',2)) > length(split_part(event_data,' <= ',1))
       and split_part(event_data,' <= ',2) like split_part(event_data,' <= ',1) || '%'
     limit 12;`);
  // 🔑 지금도 깎이는지 다시 물어본다 (머리말에 원문이 그대로 나오면 고쳐진 것이다)
  const now2 = [];
  for (const r of cut) {
    try {
      const res = await ask(r.raw);
      const o = res.raw || {};
      // 머리말에 원문이 그대로 있으면 고쳐진 것이다 (못 찾음 안내에도 원문이 그대로 들어간다)
      const head = String(o.carousel?.items?.[0]?.header?.title || o.listCard?.header?.title || o.textCard?.text || "");
      if (head && !head.includes(r.raw)) now2.push(r);
    } catch (_) { /* 판단 보류 */ }
  }
  if (now2.length) {
    bad++;
    say('⑥ 🔴 브랜드가 깎인다 ' + now2.length + '건 — 어미·조사 목록을 확인할 것');
    now2.forEach((r) => say('   🔴 "' + r.raw + '" → "' + r.kw + '"'));
    alert('챗봇브랜드깎임', now2.map((r) => r.raw + '→' + r.kw).join(', ').slice(0, 300));
  } else say('⑥ 브랜드 깎임 없음' + (cut.length ? ' (옛 로그 ' + cut.length + '건은 지금 정상 ✅)' : ''));
} catch (e) { say('⑥ 조회 실패'); }

say(bad ? `🔴 이상 ${bad}건 — health_alerts 확인` : '이상 없음');
const prev = fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8') : '';
fs.writeFileSync(LOG, out.join('\n') + '\n\n' + prev.split('\n').slice(0, 600).join('\n'));
