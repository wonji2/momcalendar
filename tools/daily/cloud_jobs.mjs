// ☁ PC 예약작업을 깃허브 Actions 에서 돌리는 공용 실행기 (2026-11-01, 사장님 「컴퓨터 꺼져도 24시간 무인」 · 무토큰 · Node 그대로)
//
// 왜: 로그인 브라우저·AI·PC 파일이 필요 없는 작업(DB 만 쓰는 것)은 PC 가 꺼지면 멈출 이유가 없다.
//     PC 쪽 예약작업은 끄고(tasks_backup.ps1 에 끈 상태로 백업), 여기 표의 시각(UTC)에 .github/workflows/pc-jobs-cloud.yml 이 부른다.
// 어떻게:
//   · 워크플로가 schedule 문자열(github.event.schedule)을 --cron 으로 넘긴다 → 그 문자열을 가진 작업만 순서대로 돈다
//   · 손으로는 --job <이름> (Actions 「Run workflow」 입력 job)
//   · 각 작업은 node <script> 로 따로 띄운다(env MOMCAL_CLOUD=1 · SUPABASE_CLI=supabase). 로그는 scratchpad/cloud_jobs/<작업>.log
//   · 알림: alert.mjs 가 클라우드 모드에선 scratchpad/_cloud_alert_ops.jsonl 에 set/clear 를 적는다 → 끝나고 health_alerts 로 옮긴다
//       set  → health_alerts 에서 kind='pc:<키>' 지우고 새로 넣음 · clear → 지움   (ops.html 「알림」·오류 레이더에 보인다)
//   · 실패(exit≠0·예외)면 health_alerts 'cloud:<작업>' 한 줄 + 로그를 Storage cloud-bundle/runs/<실행번호>/ 에 올린다
//   · 한 작업이 죽어도 다음 작업은 돈다. 하나라도 실패면 exit 1(Actions 에 빨간 표시)
// 표(JOBS): PC 예약작업 → 클라우드. cron 은 UTC(한국 시각 −9h). 같은 cron 문자열끼리 한 회차에 돈다.
//   pw:true 는 playwright 가 필요한 작업(워크플로가 그 회차에만 브라우저를 깐다)
// 옮기지 않은 것(PC 유지): 인스타·네이버 로그인 수집, AI(claude·codex) 회차, PC 자체 감시(디스크·재부팅), db_export↔db_retention 짝(내보낸 뒤 지움),
//   open_day_publish(open_tasks.json 상태 파일), 카페·스레드 발행기(규칙 0-T, 몰아 쓰기 금지). 목록은 scratchpad/designs/2026-11-01_PC작업_클라우드_이관.md
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const JOBS = {
  caption_daily:   { cron: '20 19 * * *', script: 'tools/daily/caption_daily.mjs',        pc: 'momcal-caption 04:30' },
  alias_collide:   { cron: '10 20 * * *', script: 'tools/daily/alias_collide_learn.mjs', args: ['--apply'], pc: 'momcal-alias-collide 05:10' },
  app_e2e_watch:   { cron: '10 20 * * *', script: 'tools/daily/app_e2e_watch.mjs',       pc: 'momcal-app-e2e-watch 05:30' },
  cat_guard:       { cron: '20 22 * * *', script: 'tools/daily/cat_guard.mjs',           pc: 'momcal-cat-guard 07:20' },
  my_gonggu_guard: { cron: '20 22 * * *', script: 'tools/daily/my_gonggu_guard.mjs',     pc: 'momcal-my-gonggu-guard 07:25' },
  search_gap:      { cron: '20 23 * * *', script: 'tools/daily/search_gap_daily.mjs',    pc: 'momcal-search-gap 08:20' },
  dup_guard:       { cron: '20 0 * * *',  script: 'tools/daily/dup_guard.mjs',           pc: 'momcal-dup-guard 09:20' },
  winner_notify:   { cron: '20 0 * * *',  script: 'tools/daily/winner_notify.mjs',       pc: 'momcal-winner-notify 09:20' },
  seller_banner:   { cron: '5 1 * * *',   script: 'tools/daily/seller_banner.mjs',       pc: 'momcal-seller-banner 10:05' },
  bot_learn:       { cron: '7,37 * * * *', script: 'tools/daily/bot_learn.mjs',          pc: 'momcal-bot-learn 30분' },
  store_review:    { cron: '7,37 * * * *', script: 'tools/daily/store_review_watch.mjs', pc: 'momcal-store-review-watch 30분' },
  naver_track:     { cron: '25 */6 * * *', script: 'tools/daily/naver_track.mjs',        pc: 'momcal-naver-track 6시간' },
  perf_probe:      { cron: '25 */6 * * *', script: 'tools/daily/perf_probe.mjs', args: ['--watch'], pw: true, pc: 'momcal-perf-watch 6시간' },
};

const argv = process.argv.slice(2);
const opt = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const cron = opt('--cron') || process.env.CLOUD_CRON || '';
const only = opt('--job') || process.env.CLOUD_JOB || '';
if (argv.includes('--list')) { for (const [k, j] of Object.entries(JOBS)) console.log(`${k}\t${j.cron}\t${j.script}\t${j.pw ? 'playwright' : ''}\t${j.pc}`); process.exit(0); }
if (argv.includes('--needs-pw')) { const sel = Object.values(JOBS).filter((j) => only ? JOBS[only] === j : j.cron === cron); console.log(sel.some((j) => j.pw) ? '1' : '0'); process.exit(0); }

const names = only ? [only] : Object.keys(JOBS).filter((k) => JOBS[k].cron === cron);
if (!names.length || names.some((n) => !JOBS[n])) { console.log(`돌릴 작업 없음 (cron='${cron}' job='${only}')`); process.exit(only ? 1 : 0); }

const LOGDIR = path.join(REPO, 'scratchpad', 'cloud_jobs');
fs.mkdirSync(LOGDIR, { recursive: true });
const OPS = path.join(REPO, 'scratchpad', '_cloud_alert_ops.jsonl');
try { fs.unlinkSync(OPS); } catch {}
const KEY = process.env.SB_SERVICE_KEY;
const SB = 'https://hycaqsqeogjtbscmzrtm.supabase.co';
const H = { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' };
const results = [];

for (const name of names) {
  const j = JOBS[name];
  const t0 = Date.now();
  console.log(`▶ ${name} — node ${j.script} ${(j.args || []).join(' ')}`);
  const r = spawnSync(process.execPath, [path.join(REPO, j.script), ...(j.args || [])], {
    cwd: REPO, encoding: 'utf8', timeout: 25 * 60e3, maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, MOMCAL_CLOUD: '1', SUPABASE_CLI: process.env.SUPABASE_CLI || 'supabase' },
  });
  const sec = Math.round((Date.now() - t0) / 1000);
  const log = `# ${name} · exit ${r.status} · ${sec}s · ${new Date().toISOString()}\n${r.stdout || ''}\n${r.stderr ? '--- stderr\n' + r.stderr : ''}${r.error ? '\n--- error ' + r.error.message : ''}`;
  fs.writeFileSync(path.join(LOGDIR, name + '.log'), log);
  const ok = r.status === 0 && !r.error;
  results.push({ name, ok, status: r.status, sec, tail: (r.stdout || '').trim().split('\n').slice(-3).join(' / ').slice(0, 200) });
  console.log(`${ok ? '✅' : '🔴'} ${name} exit ${r.status} ${sec}s · ${results.at(-1).tail}`);
}

// 알림 → health_alerts
if (KEY) {
  const ops = fs.existsSync(OPS) ? fs.readFileSync(OPS, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : [];
  const last = new Map(); for (const o of ops) last.set(o.key, o);   // 같은 키는 마지막 것만
  for (const o of last.values()) {
    const kind = 'pc:' + o.key;
    await fetch(`${SB}/rest/v1/health_alerts?kind=eq.${encodeURIComponent(kind)}`, { method: 'DELETE', headers: H }).catch(() => {});
    if (o.op === 'set') await fetch(`${SB}/rest/v1/health_alerts`, { method: 'POST', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify({ kind, detail: o.text }) }).catch(() => {});
    console.log(`알림 ${o.op} ${kind}${o.op === 'set' ? ' — ' + String(o.text).slice(0, 80) : ''}`);
  }
  const run = process.env.GITHUB_RUN_ID || 'local';
  for (const x of results) {
    const body = fs.readFileSync(path.join(LOGDIR, x.name + '.log'));
    await fetch(`${SB}/storage/v1/object/cloud-bundle/runs/${run}/${x.name}.log`, { method: 'POST', headers: { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'text/plain; charset=utf-8', 'x-upsert': 'true' }, body }).catch(() => {});
    const kind = 'cloud:' + x.name;
    await fetch(`${SB}/rest/v1/health_alerts?kind=eq.${encodeURIComponent(kind)}`, { method: 'DELETE', headers: H }).catch(() => {});
    if (!x.ok) await fetch(`${SB}/rest/v1/health_alerts`, { method: 'POST', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify({ kind, detail: `클라우드 회차 실패(exit ${x.status}) — 로그 cloud-bundle/runs/${run}/${x.name}.log · ${x.tail}` }) }).catch(() => {});
  }
}
console.log(`끝 — ${results.filter((x) => x.ok).length}/${results.length} 성공`);
process.exit(results.every((x) => x.ok) ? 0 : 1);
