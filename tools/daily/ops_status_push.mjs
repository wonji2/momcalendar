// 운영 현황판 — 이 PC 쪽 상태를 모아 서버(ops_status.id='pc')에 올린다 (2026-09-29, 사장님 "전 라인 다 잘 도는지 검증 가능한 뒷단 웹사이트")
//
// 모으는 것
//   tasks    윈도우 예약작업 momcal-*·work-backup-* 전부: 상태·마지막 실행·결과코드·다음 실행 (schtasks 가 진실)
//   blog     다음 7일 예약 마커(sns-automation/daily/<날>/published-blog.json)·주간 자동 로그 마지막 줄·주간 보고 최신 날짜
//   threads  오늘·어제 창별 발행 표식(daily/<날>/threads-*.json)·threads_log 마지막 발행 줄·토큰 유무
//   cafe     핫딜/공구/가입인사/답글 발행기 로그 마지막 줄
//   parsing  밤샘 파싱 로그 마지막 줄·승인 대기 표 수·월말 전수 다음 시각
//   guards   error_guard·inquiry 로그 마지막 줄·오늘 카드 알림줄(daily/_alert.txt)
//   backups  work-backup·momcal-ops 마지막 실행
// 실행: node tools/daily/ops_status_push.mjs        (예약작업 momcal-ops-status 30분마다)  · --print 는 서버에 안 올리고 화면에 찍는다(ops_status_last.json 은 갱신)
// 상태: scratchpad/ops_status_last.json (마지막으로 올린 것) · 로그 scratchpad/ops_status_log.txt
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setAlert, clearAlert, pushAlerts } from './alert.mjs';   // 디스크 여유 경보 ('disk' 키는 이 파일만 건드린다)
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SNS = path.join(REPO, 'sns-automation');
const CLI = 'C:/Users/FAMILY/supabase-cli/supabase.exe';
const kst = () => new Date(Date.now() + 9 * 3600e3);
const ymd = (d) => d.toISOString().slice(0, 10);
const addD = (s, n) => ymd(new Date(new Date(s + 'T00:00:00Z').getTime() + n * 864e5));
const today = ymd(kst());
const tailLines = (f, n = 1, head = false) => { try { const L = fs.readFileSync(f, 'utf8').split(/\r?\n/).filter(Boolean); return (head ? L.slice(0, n) : L.slice(-n)).map((l) => l.slice(0, 200)); } catch { return []; } };
const mtime = (f) => { try { return new Date(fs.statSync(f).mtimeMs + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' '); } catch { return null; } };
// 🔴 2026-10-02: HANDOFF.md 크기를 statSync 로 **감싸지 않고** 읽어서, 파일이 없으면 푸셔가 통째로 죽었다
//    (worktree 에선 HANDOFF.md 가 체크아웃되지 않아 실제로 ENOENT 로 터졌다).
//    푸셔가 죽으면 현황판이 조용히 낡는다 — 없는 파일은 null 로 넘긴다.
const sizeKb = (f) => { try { return Math.round(fs.statSync(f).size / 1024); } catch { return null; } };
const out = { at: kst().toISOString().slice(0, 19).replace('T', ' '), host: process.env.COMPUTERNAME || '' };

// ① 예약작업
try {
  const ps = `Get-ScheduledTask | Where-Object { $_.TaskName -like 'momcal*' -or $_.TaskName -like 'work-backup*' } | ForEach-Object { $t=$_; $i=$null; try { $i = Get-ScheduledTaskInfo -TaskName $t.TaskName -TaskPath $t.TaskPath -ErrorAction Stop } catch {}; [pscustomobject]@{ name=$t.TaskName; state=[string]$t.State; last=$(if ($i -and $i.LastRunTime) { $i.LastRunTime.ToString('yyyy-MM-dd HH:mm') } else { $null }); result=$(if ($i) { $i.LastTaskResult } else { $null }); next=$(if ($i -and $i.NextRunTime) { $i.NextRunTime.ToString('yyyy-MM-dd HH:mm') } else { $null }) } } | ConvertTo-Json -Compress`;
  const raw = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8', timeout: 120e3 });
  const arr = JSON.parse(raw.trim() || '[]');
  out.tasks = (Array.isArray(arr) ? arr : [arr]).map((t) => ({ ...t, ok: t.result === 0 || t.result === 267009 || t.result === 267011 })).sort((a, b) => a.name.localeCompare(b.name));
  // 267009 = 실행 중, 267011 = 아직 한 번도 안 돎 — 둘 다 오류 아님
} catch (e) { out.tasks_error = String(e.message).slice(0, 160); }

// ② 블로그
try {
  const days = Array.from({ length: 8 }, (_, i) => addD(today, i));
  out.blog = {
    markers: days.map((d) => { const f = path.join(SNS, 'daily', d, 'published-blog.json'); let m = null; try { m = JSON.parse(fs.readFileSync(f, 'utf8')); } catch {} return { day: d, scheduled: !!m, logNo: m ? (String(m.url || '').match(/logNo=(\d+)/) || [])[1] || null : null, at: m ? String(m.scheduledAt || m.at || '').slice(0, 16) : null }; }),
    weekly_log: tailLines(path.join(REPO, 'scratchpad', 'blog_week_auto.log'), 3, true),
    report_at: mtime(path.join(REPO, 'scratchpad', 'blog_weekly_report.md')),
    report_head: tailLines(path.join(REPO, 'scratchpad', 'blog_weekly_report.md'), 1, true),
    develop_log: tailLines(path.join(SNS, 'state', 'blog-develop-log.md'), 1, true),
  };
} catch (e) { out.blog = { error: String(e.message).slice(0, 160) }; }

// ③ 스레드
try {
  const marks = (d) => { const dir = path.join(SNS, 'daily', d); let fs_ = []; try { fs_ = fs.readdirSync(dir).filter((f) => /^threads-.*\.json$/.test(f)); } catch {} return fs_.map((f) => { let j = {}; try { j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch {} return { win: f.replace(/^threads-|\.json$/g, ''), id: j.id || j.mainId || j.main || null, at: String(j.at || j.time || '').slice(0, 16) }; }); };
  const log = fs.existsSync(path.join(REPO, 'scratchpad', 'threads_log.txt')) ? fs.readFileSync(path.join(REPO, 'scratchpad', 'threads_log.txt'), 'utf8').split(/\r?\n/).filter((l) => /발행 ✅|🔴|실패|오류/.test(l) && !/dry/i.test(l)) : [];
  let env = ''; try { env = fs.readFileSync(path.join(SNS, '.env'), 'utf8'); } catch {}
  let pending = 0; try { const p = JSON.parse(fs.readFileSync(path.join(SNS, 'state', 'threads-pending.json'), 'utf8')); pending = Array.isArray(p) ? p.length : Object.keys(p || {}).length; } catch {}   // 답글 대기줄 실제 파일 (검증 지적 2026-09-29: 전엔 없는 파일명을 읽어 항상 0)
  out.threads = { today: marks(today), yesterday: marks(addD(today, -1)), last_lines: log.slice(-4).map((l) => l.slice(0, 160)), token: /THREADS_ACCESS_TOKEN=\S{10,}/.test(env), reply_pending: pending };
} catch (e) { out.threads = { error: String(e.message).slice(0, 160) }; }

// ④ 카페·핫딜·인스타 발행기 로그 (있는 것만)
const LOGS = {
  cafe_hotdeal: ['scratchpad/cafe_hotdeal_log.txt', 'sns-automation/state/cafe-hotdeal.log'],
  cafe_gonggu: ['scratchpad/cafe_gonggu_log.txt', 'sns-automation/state/cafe-gonggu.log'],
  cafe_greeting: ['scratchpad/cafe_greeting_log.txt'],
  cafe_answer: ['scratchpad/cafe_answer_log.txt'],
  cafe_crawl: ['scratchpad/cafe_crawl_log.txt'],
  soldout: ['scratchpad/hotdeal_soldout_log.txt', 'scratchpad/soldout_log.txt'],
  parsing_nightly: ['scratchpad/parsing_nightly_log.txt'],
  ig_feed: ['scratchpad/ig_feed_log.txt'],
  error_guard: ['scratchpad/error_guard_log.txt'],
  inquiry_guard: ['scratchpad/inquiry_guard_log.txt'],
  seller_banner: ['scratchpad/seller_banner_log.txt'],
  db_export: ['scratchpad/db_export_log.txt'],        // 무료 플랜엔 자동 백업이 없다 — 이게 멈추면 사본이 낡는다
  db_retention: ['scratchpad/db_retention_log.txt'],  // 이게 멈추면 DB 가 500MB 로 달린다
  momsholic: ['scratchpad/momsholic_log.txt'],
  kw_daily: ['scratchpad/kw_daily_report.txt'],
  // 🔴 2026-10-01 검증자 지적: 월말→월초 집중 회차(momcal-month-blitz)·파도타기·달력 회차가
  //    현황판에 **없어서, 조용히 죽어도 아무도 모르는 상태**였다. 파싱이 업무의 99% 인데(사장님)
  //    그 핵심 회차가 감시 밖에 있었다.
  month_blitz: ['scratchpad/month_start_log.txt'],    // 매일 01:10, 창 24일~다음달 7일
  calendar: ['scratchpad/calendar_round_log.txt'],    // 피드 달력글 (8시간마다)
  cal_gap: ['scratchpad/calendar_gap_log.txt'],       // 달력 빈 셀러 바이오 (매월 1~5일)
  surf: ['scratchpad/mention_surf_log.txt'],          // 파도타기 — 캡션 @태그 (하루 2회)
  pangpang: ['scratchpad/pangpang_leads_log.txt'],    // 집계 사이트 새 셀러 핸들 (하루 2회)
  ig_register: ['scratchpad/ig_feed_pipeline_log.txt'], // 그날 오픈 → 무인 등록 (매시간)
  live_audit: ['scratchpad/live_audit_log.txt'],       // 라이브 사후 감시 (매일 09:50) — 상한 대신 이걸로 거른다
  pw_tmp_clean: ['scratchpad/pw_tmp_clean_log.txt'],   // playwright 임시프로필 청소 (매일 04:20) — 이게 멈추면 C드라이브가 찬다
};
out.logs = {};
for (const [k, cands] of Object.entries(LOGS)) {
  const f = cands.map((c) => path.join(REPO, c)).find(fs.existsSync);
  out.logs[k] = f ? { file: path.relative(REPO, f).replace(/\\/g, '/'), at: mtime(f), last: tailLines(f, 2) } : { file: null };
}
// 로그 파일 이름을 모르는 발행기는 scratchpad 의 *_log.txt 전부를 훑어 최신순으로 보여준다 (빠진 채널이 있어도 표에 나오게)
try {
  const sp = path.join(REPO, 'scratchpad');
  out.all_logs = fs.readdirSync(sp).filter((f) => /_log\.txt$|log\.txt$/.test(f)).map((f) => ({ file: f, at: mtime(path.join(sp, f)), last: tailLines(path.join(sp, f), 1)[0] || '' })).sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 40);
} catch {}

// ⑤ 파싱·승인 대기
try {
  const pend = path.join(REPO, 'scratchpad', '승인대기_누적.md');
  const rows = fs.existsSync(pend) ? fs.readFileSync(pend, 'utf8').split(/\r?\n/).filter((l) => /^\|\s*\d+\s*\|/.test(l)).length : 0;
  const targets = tailLines(path.join(REPO, 'scratchpad', 'parsing_targets_kw.txt'), 100).filter((l) => !l.startsWith('#')).length;
  out.parsing = { pending_rows: rows, pending_at: mtime(pend), kw_targets: targets, seen_at: mtime(path.join(REPO, 'scratchpad', '_inpock_seen_auto.txt')) };
} catch (e) { out.parsing = { error: String(e.message).slice(0, 160) }; }

// ⑥ 디스크 여유 — 🔴 2026-10-02 사고: 아무도 모르는 사이에 C드라이브(233GB)가 여유 0바이트가 되어
//    파일 쓰기가 ENOSPC 로 죽고 작업이 멈췄다. **신호를 내는 곳이 한 군데도 없었다.**
//    서버쪽 error_radar() 는 이 PC 디스크를 볼 수 없다 → 30분마다 도는 이 푸셔가 제일 빠른 경보다.
//    기준 아래로 떨어지면 오늘 카드 알림줄('disk' 키)에 올려 사장님 폰에 뜨게 한다.
const DISK_MIN_GB = Number(process.env.DISK_MIN_GB || 10);
try {
  const st = fs.statfsSync('C:\\');
  const free = (Number(st.bavail) * Number(st.bsize)) / 1e9;
  const total = (Number(st.blocks) * Number(st.bsize)) / 1e9;
  // playwright 임시 프로필 수도 같이 본다 — 2026-10-02 엔 3,912개(6.5GB)였다 (청소기 tools/daily/pw_tmp_clean.mjs)
  let pwTmp = 0;
  try { pwTmp = fs.readdirSync(os.tmpdir()).filter((n) => /^(?:playwright[_-]|pw-)/i.test(n)).length; } catch {}
  out.disk = { free_gb: +free.toFixed(1), total_gb: Math.round(total), min_gb: DISK_MIN_GB, pw_tmp: pwTmp, ok: free >= DISK_MIN_GB };
  if (free < DISK_MIN_GB) setAlert('disk', `🔴 C드라이브 여유 ${free.toFixed(1)}GB (기준 ${DISK_MIN_GB}GB) · playwright 임시폴더 ${pwTmp}개 — 세션에서 node tools/daily/pw_tmp_clean.mjs`);
  else clearAlert('disk');
  const pushed = pushAlerts(free < DISK_MIN_GB ? `C드라이브 여유 ${free.toFixed(1)}GB` : '디스크 이상 없음');
  if (!pushed.ok) out.disk.push_error = String(pushed.error).slice(0, 120);
} catch (e) { out.disk = { error: String(e.message).slice(0, 160) }; }

// ⑦ 알림줄·백업 (디스크 알림을 쓴 **뒤에** 읽는다 — 안 그러면 현황판이 한 회차 늦는다)
out.alerts = tailLines(path.join(REPO, 'daily', '_alert.txt'), 10);
out.backup = { work_backup_at: mtime(path.join('C:/Users/FAMILY/work-backup', '.git', 'FETCH_HEAD')) || mtime(path.join('C:/Users/FAMILY/work-backup', '.git', 'HEAD')), handoff_at: mtime(path.join(REPO, 'HANDOFF.md')), handoff_kb: sizeKb(path.join(REPO, 'HANDOFF.md')) };

fs.writeFileSync(path.join(REPO, 'scratchpad', 'ops_status_last.json'), JSON.stringify(out, null, 1), 'utf8');
if (process.argv.includes('--print')) { console.log(JSON.stringify(out, null, 1)); process.exit(0); }
// 올리기 — jsonb 는 달러 인용으로 감싸 따옴표 문제를 피한다
const sqlFile = path.join(REPO, 'scratchpad', '_ops_status_push.sql');
fs.writeFileSync(sqlFile, `insert into public.ops_status (id, payload, updated_at) values ('pc', $ops$${JSON.stringify(out).replace(/\$ops\$/g, '')}$ops$::jsonb, now())
on conflict (id) do update set payload = excluded.payload, updated_at = now();
select id, to_char(updated_at at time zone 'Asia/Seoul','MM-DD HH24:MI') at from public.ops_status where id='pc';`, 'utf8');
// CLI 는 'Initialising login role…' 에서 2분 넘게 걸릴 때가 있다(검증 실측 2026-09-29 10:25 회차 120s 초과) → 240s · 2번 시도
let msg = '';
for (let attempt = 1; attempt <= 2; attempt++) {
  try {
    const raw = execFileSync(CLI, ['db', 'query', '--linked', '--output-format', 'json', '-f', sqlFile], { encoding: 'utf8', timeout: 240e3, cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'] });
    msg = /"id"\s*:\s*"pc"/.test(raw) ? '✅ 올림' + (attempt > 1 ? `(${attempt}번째)` : '') : '🔴 응답 이상 ' + raw.replace(/\s+/g, ' ').slice(0, 120);
    if (msg.startsWith('✅')) break;
  } catch (e) { msg = '🔴 CLI 실패 ' + String(e.stderr || e.message).replace(/\s+/g, ' ').slice(0, 160); }
}
const line = `[${out.at}] ${msg} · 작업 ${(out.tasks || []).length}개 · 블로그 예약 ${(out.blog.markers || []).filter((m) => m.scheduled).length}/8 · 스레드 오늘 ${(out.threads.today || []).length}건`;
fs.appendFileSync(path.join(REPO, 'scratchpad', 'ops_status_log.txt'), line + '\n');
console.log(line);
if (msg.startsWith('🔴')) process.exit(1);
