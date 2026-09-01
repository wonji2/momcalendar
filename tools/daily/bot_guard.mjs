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

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
process.chdir(ROOT);                 // ⚠ 예약작업 cwd 는 System32 — supabase --linked 가 프로젝트를 못 찾는다
const CLI = 'C:/Users/FAMILY/supabase-cli/supabase.exe';
const SB = 'https://hycaqsqeogjtbscmzrtm.supabase.co';
const LOG = path.join(ROOT, 'scratchpad', 'bot_guard_log.txt');
const FULL = process.argv.includes('--full') || new Date(Date.now() + 9 * 3600e3).getMinutes() < 30;

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
  return { card: !!(o.carousel || o.listCard || o.basicCard), text: o.textCard?.text || '', raw: o, ms: _ms };
};

const now = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');
say(`===== ${now} 챗봇 감시 =====`);
let bad = 0;

// ① 생존
const PING = ['오늘 공구', '물티슈', '안녕', '네뷸라이저zzz없는거'];   // 마지막은 가장 느린 경로(별칭 많고 결과 없음)
for (const p of PING) {
  try {
    const r = await ask(p);
    if (!r.card && !r.text) { bad++; say(`🔴 생존 실패 "${p}" — 응답이 비었습니다`); }
    else if (/일시적으로 조회/.test(r.text)) { bad++; say(`🔴 조회 장애 "${p}"`); }
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
try {
  const gap = sql(`
    select split_part(event_data,' <= ',1) kw, count(*)::int c
      from events where event_type='kakao_bot_miss'
       and visited_at > now() - interval '24 hours'
       and split_part(event_data,' <= ',1) ~ '^[가-힣A-Za-z0-9 ]{2,20}$'
       and split_part(event_data,' <= ',1) !~ '(존재|테스트|zzz|ㅁㄴㅇㄹ)'
     group by 1 order by 2 desc limit 15;`);
  if (gap.length) {
    say('④ 손님이 찾는데 DB 에 없는 것 (파싱 우선순위)');
    say('   ' + gap.map((g) => `${g.kw}(${g.c})`).join(' · '));
    const top = gap.filter((g) => g.c >= 3);
    if (top.length) {
      const f = path.join(ROOT, 'scratchpad', 'bot_gap_report.md');
      const body = `# ${now} 손님이 찾았는데 없는 브랜드\n\n`
        + '| 브랜드·품목 | 물어본 횟수 |\n|---|---|\n'
        + gap.map((g) => `| ${g.kw} | ${g.c} |`).join('\n')
        + '\n\n> 손님이 돈 쓰려고 물어본 것입니다. 이 브랜드부터 파싱하면 바로 매출로 이어집니다.\n';
      fs.writeFileSync(f, body);
    }
  }
} catch (e) { say('④ 갭 조회 실패'); }

say(bad ? `🔴 이상 ${bad}건 — health_alerts 확인` : '이상 없음');
const prev = fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8') : '';
fs.writeFileSync(LOG, out.join('\n') + '\n\n' + prev.split('\n').slice(0, 600).join('\n'));
