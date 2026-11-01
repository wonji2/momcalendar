// 출석체크 당첨자가 뽑혔는데 **아직 안 보낸 게 있으면** 사장님께 알린다 (사장님 지시 2026-09-22)
//
// 왜 필요했나
//   8월 당첨자는 9/2 새벽에 자동으로 뽑히고 승인까지 됐는데, **알려주는 장치가 없어서**
//   관리자 화면에만 조용히 쌓여 있었다. 사장님이 9/22 에 "명단이 나한테 안 왔는데 어디서 보나" 하고 물으셨다.
//   → 매일 한 번 보고, 안 보낸 당첨자가 있으면 **매일 보시는 오늘 카드 페이지 맨 위**에 띄운다.
//
//   node tools/daily/winner_notify.mjs          예약작업 momcal-winner-notify 가 매일 09:20 부른다
//   node tools/daily/winner_notify.mjs --dry    알림 파일은 안 건드리고 상태만 본다
//
// 알림 키 'winner' — 다 보내면 그 줄만 지운다(다른 알림은 안 건드린다).
// 로그  scratchpad/winner_notify_log.txt
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseRows } from './sb_query.mjs';
import { setAlert, clearAlert, pushAlerts } from './alert.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = process.env.SUPABASE_CLI || 'C:/Users/FAMILY/supabase-cli/supabase.exe';
const DRY = process.argv.includes('--dry');
const LOGF = path.join(REPO, 'scratchpad', 'winner_notify_log.txt');
const kst = () => new Date(Date.now() + 9 * 3600e3);
const log = (s) => { const t = kst().toISOString().slice(0, 16).replace('T', ' '); try { fs.appendFileSync(LOGF, `[${t}] ${s}\n`); } catch {} console.log(s); };

const sqlRel = 'scratchpad/_winner_notify.sql';
fs.mkdirSync(path.join(REPO, 'scratchpad'), { recursive: true });
fs.writeFileSync(path.join(REPO, sqlRel), `
select to_char(month,'YYYY-MM') as m,
       count(*) filter (where sent_at is null) as todo,
       count(*) filter (where sent_at is null and coalesce(contact,'') <> '') as has_contact,
       count(*) filter (where sent_at is null and approved_at is null) as not_approved
from attendance_winners group by month having count(*) filter (where sent_at is null) > 0
order by month;`, 'utf8');

let rows = [];
try {
  const raw = execFileSync(CLI, ['db', 'query', '--linked', '--file', sqlRel],
    { cwd: REPO, encoding: 'utf8', timeout: 120000, stdio: ['ignore', 'pipe', 'pipe'] });
  const got = parseRows(raw);
  if (!got.ok) throw new Error('결과를 못 읽었다');
  rows = got.rows || [];
} catch (e) {
  // 🔴 조회가 안 됐다고 알림을 지우면 안 된다 — 있던 알림이 조용히 사라진다. 그냥 끝낸다.
  log(`⚠ 조회 실패: ${String(e.message).slice(0, 120)} — 알림은 그대로 둔다`);
  process.exit(0);
}

if (!rows.length) {
  log('안 보낸 당첨자 없음 — 알림 지움');
  if (!DRY) { clearAlert('winner'); const r = pushAlerts('당첨자 알림 해제'); if (!r.ok) log('⚠ 알림 올리기 실패: ' + r.error); }
  process.exit(0);
}

const parts = rows.map((r) => {
  const n = Number(r.todo || 0);
  const c = Number(r.has_contact || 0);
  const na = Number(r.not_approved || 0);
  const [, mm] = String(r.m).split('-');
  let s = `${Number(mm)}월 ${n}명`;
  if (na > 0) s += `(승인 전 ${na}명)`;
  else if (c > 0) s += `(연락처 받은 ${c}명)`;
  return s;
});
const text = `출석체크 당첨자 아직 안 보냈어요 — ${parts.join(' · ')} · 관리자 💜 출석·추첨 에서 확인`;
log(text);
if (!DRY) { setAlert('winner', text); const r = pushAlerts('당첨자 발송 안 된 건 있음'); if (!r.ok) log('⚠ 알림 올리기 실패: ' + r.error); }
