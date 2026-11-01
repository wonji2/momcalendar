// DB 보관 정리 — 무료 플랜 500MB 를 넘지 않게 오래된 방문기록(events) 원본을 지운다 (2026-09-29)
//
// 순서를 지키는 게 전부다. 셋 중 하나라도 안 되면 **아무것도 안 지운다**:
//   ① 원본이 백업에 있나   — work-backup/db-export/_watermarks.json 의 events 물높이까지만 대상으로 삼는다
//   ② 건수가 남아 있나     — events_daily(날짜·종류별 건수)가 그 날짜를 덮고 있어야 한다(서버 함수가 검사)
//   ③ 사장님이 켰나       — 기본은 시험만. 실제 삭제는 --yes 를 줄 때만
// 대상: events(기본 90일) + visits·visitors(180일). 날짜별 요약(events_daily·visits_daily·visitors_daily)은 **영구 보관**한다.
// 실행: node tools/daily/db_retention.mjs            시험(몇 행이 대상인지만)
//       node tools/daily/db_retention.mjs --yes      실제 삭제 (예약작업 momcal-db-retention 이 이걸로 돈다)
//       node tools/daily/db_retention.mjs --days 60  보관 일수 바꾸기(기본 90일)
// 로그: scratchpad/db_retention_log.txt · 삭제 기록은 DB health_alerts('events_보관정리') 에도 남는다
// ⚠ 이 도구는 momcal-db-export(04:40) 가 끝난 뒤에 돌아야 한다. 물높이가 낡으면 지울 게 없다고 나오고 끝난다(안전).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { sbArgs, parseRows } from './sb_query.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = 'C:/Users/FAMILY/supabase-cli/supabase.exe';
const WM = path.join(process.env.USERPROFILE || 'C:/Users/FAMILY', 'work-backup', 'db-export', '_watermarks.json');
const LOG = path.join(REPO, 'scratchpad', 'db_retention_log.txt');
const APPLY = process.argv.includes('--yes');
const VDAYS = 180;   // visits·visitors 보관 — 유입경로·시간대 분석은 계절 비교가 필요하다. 하루 1,650행뿐이라 180일이어도 65MB
const _di = process.argv.indexOf('--days');   // ⚠ indexOf 가 -1 이면 argv[0](node 경로)을 읽는다 — 숫자만 남겨 24만일이 됐다(2026-09-29 실측)
const DAYS = Math.min(3650, Math.max(7, Number(_di > 0 ? String(process.argv[_di + 1] || '').replace(/\D/g, '') : '') || 90));
const stamp = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');
const log = (m) => { const l = `[${stamp()}] ${m}`; console.log(l); try { fs.appendFileSync(LOG, l + '\n'); } catch {} };

function q(sql) {
  const f = path.join(REPO, 'scratchpad', `_db_retention_q_${process.pid}.sql`); fs.writeFileSync(f, sql, 'utf8');   // 회차마다 다른 이름(겹쳐 돌면 서로 덮어쓴다)
  let raw = '';
  for (let a = 1; a <= 2; a++) { try { raw = execFileSync(CLI, sbArgs(f), { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 300e3 }); break; } catch (e) { if (a === 2) throw e; } }
  try { fs.unlinkSync(f); } catch {}
  const r = parseRows(raw); if (!r.ok) throw new Error('CLI 출력 못 읽음: ' + raw.slice(0, 200)); return r.rows;
}

try {
  if (!fs.existsSync(WM)) { log('🔴 물높이 파일 없음 — 내보내기(momcal-db-export)가 한 번도 안 돌았다. 아무것도 안 지운다'); process.exit(1); }
  const wm = JSON.parse(fs.readFileSync(WM, 'utf8'));
  const exported = Number(wm.events || 0);
  if (!exported) { log('🔴 events 물높이 0 — 내보내기 전이다. 아무것도 안 지운다'); process.exit(1); }

  const before = q(`select public.events_rollup() roll, (select max(id) from events) max_id, (select count(*) from events) rows, round(pg_database_size(current_database())/1048576.0,1) db_mb`)[0];
  const behind = Number(before.max_id) - exported;
  log(`내보냄 id ${exported} · DB 최대 id ${before.max_id}(${behind > 0 ? '아직 ' + behind + '행 안 내보냄' : '따라잡음'}) · events ${before.rows}행 · DB ${before.db_mb}MB · 롤업 ${before.roll}행`);

  const r = q(`select public.events_purge(${DAYS}, ${exported}, ${APPLY ? 'true' : 'false'}) msg`)[0].msg;
  log((APPLY ? '실행: ' : '시험: ') + r);

  // visits·visitors 도 같은 규칙으로 (내보낸 id 까지·요약이 있을 때만)
  const vi = Number(wm.visits || 0), vo = Number(wm.visitors || 0);
  if (!vi || !vo) log('⚠ visits/visitors 물높이 없음 — 이번엔 건너뛴다');
  else {
    q('select public.visits_rollup() n');
    const r2 = q(`select public.visits_purge(${VDAYS}, ${vi}, ${vo}, ${APPLY ? 'true' : 'false'}) msg`)[0].msg;
    log((APPLY ? '실행: ' : '시험: ') + r2);
  }
  if (APPLY) {
    const after = q(`select round(pg_database_size(current_database())/1048576.0,1) db_mb, (select count(*) from events) rows`)[0];
    log(`끝 — events ${after.rows}행 · DB ${after.db_mb}MB (지운 자리는 새 행이 채운다. 바로 줄지 않는 게 정상)`);
  }
} catch (e) { log('🔴 ' + String(e.stack || e.message).slice(0, 300)); process.exitCode = 1; }
