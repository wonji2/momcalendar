// 오류 레이더 감시기 — 서버의 error_radar() 를 매시간 읽어 🔴 줄을 사장님 오늘 카드 알림줄에 올린다 (2026-09-24)
//
// 왜 필요한가
//   사장님 2026-09-24: "니가 오류 바로 수정할 수 있는 방향으로 알아서 계속 디벨롭해야지 시키는 것만 하지 말고".
//   이번 주 사고 셋(회원 로그인 불가·서버 500·하루 4~11건 빈 화면)은 전부 **신호는 있었는데 읽는 사람이 없었다**.
//   health_alerts 는 admin 도 오늘 카드도 안 읽고 있었다(실측 2026-09-24 — 쓰는 도구 6개, 읽는 도구 0개).
//
// 하는 일 (매시간, 예약작업 momcal-error-guard)
//   ① supabase-cli 로 select * from error_radar()  — 오류 종류별 1h·24h 건수와 🔴/✅ (정의: supabase/sql/error_radar_63.sql)
//   ② 🔴 가 있으면 오늘 카드 알림줄(alert.mjs 키 'errors')에 한 줄로 — 사장님 폰에서 보인다. 없으면 줄을 지운다
//   ③ 로그 scratchpad/error_guard_log.txt (회차마다 표 전체) — 세션이 열리면 이 로그로 어젯밤 무슨 일이 있었는지 본다
//
//   node tools/daily/error_guard.mjs          매시간(예약작업)
//   node tools/daily/error_guard.mjs --dry    알림 안 쓰고 표만
//
// ⚠ 고치는 건 세션(사람+Claude)이 한다. 여기선 **보이게** 까지. 서버 쪽(크론·인덱스)은 세션이 바로 고치고, 사이트 코드는 test.html → 검증 → 사장님 "배포해".
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { sbArgs, parseRows } from './sb_query.mjs';
import { setAlert, clearAlert, pushAlerts } from './alert.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = process.env.SUPABASE_CLI || 'C:/Users/FAMILY/supabase-cli/supabase.exe';
const DRY = process.argv.includes('--dry');
const LOGF = path.join(REPO, 'scratchpad', 'error_guard_log.txt');
const kst = () => new Date(Date.now() + 9 * 3600e3);
const log = (s) => { const t = kst().toISOString().slice(0, 16).replace('T', ' '); try { fs.appendFileSync(LOGF, `[${t}] ${s}\n`); } catch {} console.log(s); };

let rows = [];
try {
  const rel = 'scratchpad/_error_guard.sql';
  fs.writeFileSync(path.join(REPO, rel), 'select kind, h1, h24, 임계, 상태 from public.error_radar();', 'utf8');
  const raw = execFileSync(CLI, sbArgs(rel), { encoding: 'utf8', cwd: REPO, timeout: 90000, stdio: ['ignore', 'pipe', 'pipe'] });
  const r = parseRows(raw);
  if (!r.ok) throw new Error('레이더를 못 읽었다');
  rows = r.rows;
} catch (e) {
  // 읽기 실패는 그 자체가 알림감 — 조용히 "이상 없음"으로 보이면 이 도구가 없던 때와 같다
  log(`🔴 error_radar 읽기 실패: ${String(e.message).slice(0, 160)}`);
  if (!DRY) { setAlert('errors', '오류 레이더를 못 읽었어요 — 서버(supabase) 연결 확인 필요'); pushAlerts('오류 레이더 읽기 실패'); }
  process.exit(1);
}

const red = rows.filter((r) => String(r['상태']) === '🔴');
log(`레이더 ${rows.length}줄 · 🔴 ${red.length}`);
for (const r of rows) log(`  ${r['상태']} ${String(r.kind).padEnd(22)} 1h ${r.h1} · 24h ${r.h24} (임계 ${r['임계']})`);

if (DRY) process.exit(0);
if (red.length) {
  const txt = red.map((r) => `${r.kind} 1h ${r.h1}·24h ${r.h24}`).join(' / ');
  setAlert('errors', `🔴 사이트 오류 레이더 ${red.length}건: ${txt} — 세션에서 select * from error_radar()`);
} else clearAlert('errors');
const pushed = pushAlerts(red.length ? `오류 레이더 🔴 ${red.length}` : '오류 레이더 이상 없음');
if (!pushed.ok) log(`⚠ 알림 푸시 실패: ${pushed.error}`);
