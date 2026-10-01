/**
 * 🗓️ **월말→월초 집중 회차** — 사람·채팅 없이 **매월 24일부터 다음달 7일까지 매일** 스스로 돈다
 *
 * 사장님 지시 2026-10-01:
 *   *"파싱이 그 무엇보다 우리 업무의 99%비중 중요한거야 매월 똑같은말 하게 하지 말고
 *    변하지 않는 규칙으로 (니가 임의로 만든거 말고 나랑 소통해서 확인된 내용만)
 *    매월초 자동 파싱되게 해"*
 * 사장님 지시 2026-09-01:
 *   *"인포크는 로그인이 필요 없어 병렬 무제한인데 그걸 놀리고 있었다 —
 *    그걸 놀리지 않게 규칙으로 박아라. 매월초 동시다발적으로 하라고."*
 *
 * 🔴 왜 이게 필요했나 (2026-10-01 실측):
 *   월초·월말 전수를 돌던 `momcal-month-sweep` 의 트리거가 **2026-09-27 일회성**이었다.
 *   반복 설정이 없어 9/27 에 한 번 돌고 끝. 메모리엔 "매월 24·27·30일" 로 적혀 있었다 —
 *   **적어놓은 것과 도는 것이 달라서** 사장님이 매월 같은 말씀을 하셔야 했다.
 *   이제 규칙은 `tools/daily/PARSING_RULES.md` 에, 도는 것은 이 파일 하나에 모았다.
 *
 * 규칙 원본: tools/daily/PARSING_RULES.md (A칸=사장님 확인 / B칸=내가 만든 것)
 *   이 파일이 하는 일은 그 문서 C표와 **같아야 한다.** 다르면 이 파일이 틀린 것이다.
 *
 * 흐름 (하나가 실패해도 다음으로 간다 — 한 채널이 0건이어도 멈추지 않는다, 규칙 0-N)
 *   0 그 달 일정이 DB에 없는 활동 셀러 명단  → scratchpad/month_gap_sellers.txt
 *   1 인포크 전수            parsing_nightly.mjs --n 1200 --reset
 *   2 피드 달력글            calendar_round.mjs
 *   3 달력 셀러 명단·빈 셀러 calendar_roster.mjs --gaps
 *   4 빈 셀러 바이오 수확     calendar_gap_hunt.mjs --n 80
 *   5 새 셀러 핸들 단서       pangpang_leads.mjs
 *   6 회차 보고 (채널별 건수·누적 승인표 행수·마지막 등록일)
 *
 *   node tools/daily/month_start_round.mjs [--skip inpock,calendar] [--n 1200]
 * 로그: scratchpad/month_start_log.txt
 * 주기: 윈도우 예약작업 momcal-month-blitz — **매일 01:10**. 창(24일~다음달 7일) 판단은 이 스크립트가 한다.
 *       (날짜 목록 트리거를 쓰면 2월에 30일이 없어 안 돈다 — 그래서 매일 돌고 안에서 가른다)
 *
 * ⚠ 이 회차는 **수확**을 한다. 등록은 각 채널 무인 등록기가 한다 —
 *    인포크는 parsing_nightly 가, 인스타는 ig_feed_pipeline.sh 가(2026-10-01 부터 무인 등록, 하루 상한 400).
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SP = (f) => path.join(ROOT, 'scratchpad', f);
const LOG_F = SP('month_start_log.txt');
const NODE = process.execPath;
// 예약작업 환경엔 PATH 가 없다 — 절대경로를 먼저 쓴다 (메모리 node-portable-path)
const SBX = fs.existsSync('C:/Users/FAMILY/supabase-cli/supabase.exe') ? 'C:/Users/FAMILY/supabase-cli/supabase.exe' : 'supabase';

const KST = () => new Date(Date.now() + 9 * 3600e3);
const log = (s) => {
  const l = `[${KST().toISOString().slice(0, 16).replace('T', ' ')}] ${s}`;
  console.log(l);
  try { fs.appendFileSync(LOG_F, l + '\n'); } catch { }
};
// 🔴 예약작업은 stderr 를 버린다 — 터지면 LastResult 1 만 남는다. 로그 파일에 남긴다
for (const ev of ['uncaughtException', 'unhandledRejection']) {
  process.on(ev, (e) => { log(`🔴🔴 ${ev} — ${String((e && e.stack) || e).split('\n').slice(0, 6).join(' | ')}`); process.exit(1); });
}

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const SKIP = new Set(String(arg('--skip', '')).split(',').filter(Boolean));
const N_INPOCK = +arg('--n', 1200);

// ── 🔴🔴 집중 창: **월말 24일 ~ 다음달 7일** (사장님 지시 2026-10-01)
//   *"월말이야 정확히는 월말에서 월초 2주에 걸쳐서 새로운 달 일정 올라오는거 전수조사 파싱 가능하게
//    모든 방안을 총동원해서 돌린다 자동으로!!"*
//
//   🔴 **날짜 목록 트리거(/D 24,27,30)를 쓰지 않는다** — 2026-10-01 에 내가 그렇게 만들었다가 고쳤다.
//      `30` 은 **2월에 아예 안 돈다.** 2·4·6·9·11월도 말일이 다르다.
//      → 예약작업은 **매일** 돌고, 창 판단은 여기서 한다. 달 길이와 무관해진다.
//
//   🔑 **겨냥하는 달이 날짜에 따라 다르다.** 10/28 에 비어 있는 건 11월 일정이다 —
//      이걸 틀리면 월말 2주 동안 엉뚱한 달을 들여다본다.
const now = KST();
const dayOfMonth = now.getUTCDate();
const IN_WINDOW = dayOfMonth >= 24 || dayOfMonth <= 7;
const FORCE = process.argv.includes('--force');
if (!IN_WINDOW && !FORCE) {
  log(`창 밖(${dayOfMonth}일) — 집중 창은 24일~다음달 7일이다. 끝. (강제: --force)`);
  process.exit(0);
}
// 24일 이후면 **다음 달**이 겨냥 대상, 7일 이전이면 **이번 달**
const target = new Date(now.getTime());
target.setUTCDate(1);
if (dayOfMonth >= 24) target.setUTCMonth(target.getUTCMonth() + 1);
const thisMonth = target.toISOString().slice(0, 7);
const mon1 = `${thisMonth}-01`;
const d = KST(); d.setUTCMonth(d.getUTCMonth() - 3);
const threeAgo = d.toISOString().slice(0, 10);

// 한 단계가 터져도 회차는 계속 간다 (규칙 0-N). 결과는 표로 모아 마지막에 보고한다
const results = [];
const step = (name, fn) => {
  if (SKIP.has(name)) { results.push([name, '건너뜀(--skip)']); log(`⏭  ${name} — --skip`); return null; }
  const t0 = Date.now();
  log(`▶ ${name}`);
  try {
    const r = fn();
    const sec = Math.round((Date.now() - t0) / 1000);
    results.push([name, `✅ ${r || '완료'} (${sec}초)`]);
    return r;
  } catch (e) {
    const msg = String((e && (e.stdout || e.message)) || e).replace(/\s+/g, ' ').slice(-200);
    results.push([name, `🔴 실패 — ${msg}`]);
    log(`🔴 ${name} 실패 (코드 ${e && e.status}) — ${msg}`);
    return null;
  }
};
const run = (script, args = []) =>
  execFileSync(NODE, [path.join(ROOT, 'tools', 'daily', script), ...args], { encoding: 'utf8', cwd: ROOT, timeout: 50 * 60e3 });
const tail = (out, n = 2) => String(out || '').trim().split('\n').slice(-n).join(' | ').slice(0, 220);

log(`════ 집중 회차 — 오늘 ${dayOfMonth}일 · 겨냥 ${thisMonth} ${dayOfMonth >= 24 ? '(월말: 다음 달 일정이 올라오는 때)' : '(월초)'} ════`);
log(`   규칙 원본: tools/daily/PARSING_RULES.md · 창 24일~다음달 7일`);

// ── 0. 그 달 일정이 DB에 없는 활동 셀러 — 물량이 여기 있다 (A3)
step('gap-sellers', () => {
  const sql = `select g.insta, count(*) as c
    from gonggu g
   where coalesce(g.insta,'') <> ''
     and g.open_date >= '${threeAgo}'
     and g.insta not in (select distinct insta from gonggu
                          where coalesce(insta,'') <> '' and open_date >= '${mon1}')
   group by g.insta order by c desc limit 2000`;
  const out = execFileSync(SBX, ['db', 'query', '--linked', sql], { encoding: 'utf8', cwd: ROOT, timeout: 5 * 60e3 });
  // 🔴 CLI 출력 형식이 환경에 따라 다르다(메모리 cli-rows-wrapper-is-the-terminal) → 양쪽을 다 받는다
  //   JSON 이 섞여 오든(세션) 표로 오든(예약작업) 핸들만 뽑는다 — 「"insta": "값"」 만 읽는다
  const handles = [...new Set([...out.matchAll(/"insta"\s*:\s*"([^"]+)"/g)].map((m) => m[1].replace(/^@+/, '').toLowerCase()))];
  // 🔑 수확 0건은 "없다"가 아니라 내 도구가 틀린 것이다 (규칙 0-P)
  if (!handles.length) throw new Error(`빈 명단 — CLI 출력을 읽지 못했다: ${out.replace(/\s+/g, ' ').slice(0, 160)}`);
  fs.writeFileSync(SP('month_gap_sellers.txt'), handles.join('\n') + '\n', 'utf8');
  return `${thisMonth} 일정이 없는 활동 셀러 ${handles.length}명 → month_gap_sellers.txt`;
});

// ── 1. 인포크 전수 (로그인 불필요 — 놀리지 않는다, A3)
step('inpock', () => tail(run('parsing_nightly.mjs', ['--n', String(N_INPOCK), '--reset'])));

// ── 2. 피드 달력글 (A5)
step('calendar', () => tail(run('calendar_round.mjs')));

// ── 3. 달력 셀러 명단 → 이번 달 빈 셀러 (A6)
step('roster-gaps', () => tail(run('calendar_roster.mjs', ['--gaps']), 3));

// ── 4. 빈 셀러 바이오 수확 (A6)
step('cal-gap-hunt', () => tail(run('calendar_gap_hunt.mjs', ['--n', '80'])));

// ── 5. 집계 사이트에서 새 셀러 핸들 단서 (A11)
step('pangpang', () => tail(run('pangpang_leads.mjs')));

// ── 6. 회차 보고 — 사장님이 하루 200건을 보신다 (A8)
let report = '';
try {
  const pend = SP('승인대기_누적.md');
  const rows = fs.existsSync(pend) ? fs.readFileSync(pend, 'utf8').split('\n').filter((l) => l.startsWith('|') && /\d/.test(l)).length : 0;
  const sql = `select count(*) as today, max(created_at) as last_at from gonggu
                where created_at >= (now() at time zone 'Asia/Seoul')::date`;
  let today = '?', lastAt = '?';
  try {
    const out = execFileSync(SBX, ['db', 'query', '--linked', sql], { encoding: 'utf8', cwd: ROOT, timeout: 3 * 60e3 });
    const m = out.match(/"today":\s*(\d+)/); if (m) today = m[1];
    const m2 = out.match(/"last_at":\s*"([^"]+)"/); if (m2) lastAt = m2[1].slice(0, 16);
  } catch { }
  report = `누적 승인표 ${rows}행 · 오늘 등록 ${today}건 (마지막 ${lastAt})`;
} catch (e) { report = `보고 실패 ${String(e.message).slice(0, 80)}`; }

log('──── 회차 결과 ────');
for (const [k, v] of results) log(`  ${k.padEnd(14)} ${v}`);
log(`  ${'보고'.padEnd(14)} ${report}`);
const bad = results.filter(([, v]) => v.startsWith('🔴'));
log(`════ 집중 회차 ${thisMonth} 끝 — 단계 ${results.length}개 중 실패 ${bad.length}개 ════`);
// 🔴 실패를 성공으로 보고하지 않는다. 예약작업 LastResult 에 남아 현황판에 뜬다
process.exit(bad.length ? 1 : 0);
