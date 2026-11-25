// ⏰ 깃허브 예약 「시계」 (2026-11-25 인프라부, 사장님 「깃허브예약은 왜늦는건지 알아내서 고쳐야지」 · 토큰 요구 없이)
//   원인: 깃허브가 이 저장소의 schedule 이벤트를 하루 3~5번으로 묶어 내보낸다(repo-guard 10분 → 약 8시간 간격 실측). workflow_dispatch 는 바로 돈다.
//   하는 일: .github/workflows/clock.yml 안에서 5시간 30분 동안 1분마다 깨어, 아래 JOBS 시간표(UTC cron = 옛 워크플로 schedule 과 글자까지 같음)에 맞는 작업을
//            `gh workflow run` 으로 부른다(저장소 GITHUB_TOKEN 의 workflow_dispatch 예외 — 시작할 때 자기 다음 회차도 대기열에 걸어 틈이 없다).
//   빈틈·중복: 부르기 전에 그 회차 시각 이후 이 작업의 실행이 이미 있는지 실행 목록으로 본다(시계가 바뀌는 순간·깃허브 예약이 겹쳐도 두 번 안 부른다).
//              20분 뒤에도 실행이 안 생겼으면 한 번 다시 부르고 health_alerts. 매분 심박 ops_status 'gh-clock' → 서버 pg_cron(gh_clock_watch_146.sql)이 20분 멈추면 경보.
//   환경: GH_TOKEN(=github.token, actions: write) · SB_SERVICE_KEY(없으면 기록·경보만 생략) · CLOCK_ONLY=이름,이름(시험) · CLOCK_MINUTES(총 시간, 기본 330) · CLOCK_SUCCESSOR=0(다음 회차 안 걸기) · CLOCK_DRY=1
//   PC 가 꺼져도 도는가: 예(깃허브 서버). 끄기: 저장소 Actions 에서 clock 비활성화.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const REPO = process.env.GITHUB_REPOSITORY || 'wonji2/momcalendar';
const SB = 'https://hycaqsqeogjtbscmzrtm.supabase.co';
const KEY = process.env.SB_SERVICE_KEY || '';
const DRY = process.env.CLOCK_DRY === '1';
const ONLY = (process.env.CLOCK_ONLY || '').split(',').map((s) => s.trim()).filter(Boolean);
const TOTAL_MIN = Number(process.env.CLOCK_MINUTES || 330);

// name = 사람이 보는 이름 · wf = 워크플로 파일 · cron = UTC · c = pc-jobs-cloud 입력 cron(그 줄 글자 그대로) · win = 놓쳤을 때 따라잡는 분(기본 20)
export const JOBS = [
  { name: 'repo-guard', wf: 'repo-guard', cron: '*/10 * * * *' },
  { name: 'inquiry-cloud', wf: 'inquiry-cloud', cron: '3,13,23,33,43,53 * * * *' },
  { name: 'red-autofix-cloud', wf: 'red-autofix-cloud', cron: '2,17,32,47 * * * *' },
  { name: 'bugfix-cloud', wf: 'bugfix-cloud', cron: '7,27,47 * * * *' },
  { name: 'hotdeal-cloud', wf: 'hotdeal-cloud', cron: '8 * * * *', win: 60 },
  { name: 'live-watch', wf: 'live-watch', cron: '25 * * * *', win: 60 },
  { name: 'ios-review-watch', wf: 'ios-review-watch', cron: '17 */3 * * *', win: 120 },
  { name: 'analytics-daily', wf: 'analytics-daily', cron: '40 23 * * *', win: 360 },
  { name: 'android-cap-build', wf: 'android-cap-build', cron: '40 18 * * *', win: 120 },
  { name: 'befe_sale_auto', wf: 'befe_sale_auto', cron: '0 21 * * *', win: 360 },
  { name: 'daily-card', wf: 'daily-card', cron: '40 22 * * *', win: 360 },
  { name: 'deploy-pages', wf: 'deploy-pages', cron: '35 20 * * *', win: 360 },
  { name: 'ios-sim-check', wf: 'ios-sim-check', cron: '10 19 * * *', win: 120 },
  { name: 'seo-daily', wf: 'seo-daily', cron: '10 20 * * *', win: 360 },
  { name: 'seo-index-sample', wf: 'seo-index-sample', cron: '30 22 * * *', win: 360 },
  { name: 'seo-rank-weekly', wf: 'seo-rank-weekly', cron: '10 22 * * 0', win: 720 },
  // pc-jobs-cloud: 옛 schedule 줄마다 한 항목. '12,42 22,23,0-13 * * *' 는 hotdeal_price_gate(2026-11-04 꺼짐, cron '-')라 뺐다
  { name: 'pc-jobs:10 20', wf: 'pc-jobs-cloud', cron: '10 20 * * *', c: '10 20 * * *', win: 360 },
  { name: 'pc-jobs:20 22', wf: 'pc-jobs-cloud', cron: '20 22 * * *', c: '20 22 * * *', win: 360 },
  { name: 'pc-jobs:20 0', wf: 'pc-jobs-cloud', cron: '20 0 * * *', c: '20 0 * * *', win: 360 },
  { name: 'pc-jobs:7,37', wf: 'pc-jobs-cloud', cron: '7,37 * * * *', c: '7,37 * * * *' },
  { name: 'pc-jobs:50 */3', wf: 'pc-jobs-cloud', cron: '50 */3 * * *', c: '50 */3 * * *', win: 120 },
  { name: 'pc-jobs:50 0', wf: 'pc-jobs-cloud', cron: '50 0 * * *', c: '50 0 * * *', win: 360 },
  { name: 'pc-jobs:50 6', wf: 'pc-jobs-cloud', cron: '50 6 * * *', c: '50 6 * * *', win: 360 },
  { name: 'pc-jobs:50 12', wf: 'pc-jobs-cloud', cron: '50 12 * * *', c: '50 12 * * *', win: 360 },
  { name: 'pc-jobs:40 5,19', wf: 'pc-jobs-cloud', cron: '40 5,19 * * *', c: '40 5,19 * * *', win: 360 },
  { name: 'pc-jobs:25 6,20', wf: 'pc-jobs-cloud', cron: '25 6,20 * * *', c: '25 6,20 * * *', win: 360 },
  { name: 'pc-jobs:17', wf: 'pc-jobs-cloud', cron: '17 * * * *', c: '17 * * * *', win: 40 },
];

// ── 5칸 cron(UTC) 맞는지 ──
function field(f, lo, hi) {
  const out = new Set();
  for (const part of f.split(',')) {
    const [r, st] = part.split('/'); const step = st ? Number(st) : 1;
    let a = lo, b = hi;
    if (r !== '*') { const [x, y] = r.split('-'); a = Number(x); b = y === undefined ? (st ? hi : a) : Number(y); }
    for (let v = a; v <= b; v += step) out.add(v);
  }
  return out;
}
export function cronMatch(expr, d) {
  const [mi, ho, dom, mo, dow] = expr.split(/\s+/);
  return field(mi, 0, 59).has(d.getUTCMinutes()) && field(ho, 0, 23).has(d.getUTCHours()) && field(dom, 1, 31).has(d.getUTCDate()) &&
    field(mo, 1, 12).has(d.getUTCMonth() + 1) && field(dow, 0, 6).has(d.getUTCDay());
}
/** now 이전(포함) win 분 안에서 가장 최근에 맞는 시각(분 단위) 또는 null */
export function lastSlot(expr, now, win) {
  const t = Math.floor(now / 60e3) * 60e3;
  for (let i = 0; i <= win; i++) { const d = new Date(t - i * 60e3); if (cronMatch(expr, d)) return d; }
  return null;
}

const gh = (args) => execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19) + 'Z', ...a);
async function sbPost(p, body, prefer = 'return=minimal') {
  if (!KEY) return;
  try { await fetch(`${SB}/rest/v1/${p}`, { method: 'POST', headers: { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json', Prefer: prefer }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) }); } catch { /* 기록 실패는 시계를 멈추지 않는다 */ }
}
async function alert(kind, detail) {
  if (!KEY) return;
  try {
    const since = new Date(Date.now() - 12 * 3600e3).toISOString();
    const r = await fetch(`${SB}/rest/v1/health_alerts?kind=eq.${encodeURIComponent(kind)}&created_at=gt.${since}&select=id&limit=1`, { headers: { apikey: KEY, Authorization: 'Bearer ' + KEY }, signal: AbortSignal.timeout(15000) });
    if ((await r.json()).length) return;
  } catch { return; }
  await sbPost('health_alerts', { kind, detail: '🔴 ' + detail });
}

// 그 회차 시각 이후 이 작업의 실행이 있나(이벤트 불문). pc-jobs 는 실행 제목에 cron 글자가 들어 있다(run-name). 못 읽으면 null
function seen(job, slot) {
  try {
    const q = `repos/${REPO}/actions/workflows/${job.wf}.yml/runs?per_page=50&created=%3E%3D${new Date(slot - 90e3).toISOString().slice(0, 19)}Z`;
    const runs = JSON.parse(gh(['api', q])).workflow_runs || [];
    return runs.some((r) => !job.c || String(r.display_title || '').includes(job.c));
  } catch (e) { log('실행 목록 읽기 실패', job.name, String(e.message).slice(0, 80)); return null; }
}
function fire(job) {
  if (DRY) { log('[dry] 부름', job.name); return 204; }
  try {
    const a = ['workflow', 'run', job.wf + '.yml', '-R', REPO, '--ref', process.env.GITHUB_REF_NAME || 'main'];
    if (job.c) a.push('-f', 'cron=' + job.c);
    gh(a); return 204;
  } catch (e) { log('부르기 실패', job.name, String(e.message).slice(0, 120)); return 500; }
}

async function main() {
  const jobs = JOBS.filter((j) => !ONLY.length || ONLY.includes(j.name) || ONLY.includes(j.wf));
  const end = Date.now() + TOTAL_MIN * 60e3;
  const fired = new Map();   // key → { job, slot, at, ... }
  if (process.env.CLOCK_SUCCESSOR !== '0' && !DRY) {
    try { gh(['workflow', 'run', 'clock.yml', '-R', REPO, '--ref', process.env.GITHUB_REF_NAME || 'main']); log('다음 시계를 대기열에 걸었다(이 시계가 끝나면 바로 이어 시작)'); }
    catch (e) { log('다음 시계 걸기 실패', String(e.message).slice(0, 100)); await alert('GitHub예약:시계잇기실패', 'clock 이 다음 회차를 못 걸었다 — 이 회차가 끝나면 시계가 멈춘다(예비 schedule 이 되살린다)'); }
  }
  log(`시계 시작 · 작업 ${jobs.length}개 · ${TOTAL_MIN}분`);
  while (Date.now() < end) {
    const now = Date.now();
    for (const job of jobs) {
      const slot = lastSlot(job.cron, now, job.win || 20);
      if (!slot) continue;
      const key = job.name + '@' + slot.toISOString();
      if (fired.has(key)) continue;
      const already = seen(job, slot.getTime());
      if (already === null) continue;            // 목록을 못 읽었으면 다음 분에 다시(섣불리 두 번 부르지 않는다)
      if (already) { fired.set(key, { job, slot, at: now, skip: true }); log('이미 있음', key); continue; }
      const st = fire(job);
      fired.set(key, { job, slot, at: now });
      log(st === 204 ? '불렀다' : '실패', key);
      await sbPost('gh_dispatch_log', { wf: job.wf, cron: job.c || null, http: st, checked: true });
    }
    // 20분 뒤 검증 — 실행이 안 생겼으면 한 번 다시 + 경보
    for (const [key, f] of fired) {
      if (f.skip || f.verified || now - f.at < 20 * 60e3) continue;
      const ok = seen(f.job, f.slot.getTime());
      if (ok === null) continue;
      f.verified = true;
      if (ok) { log('시작 확인', key); continue; }
      log('20분 지나도 실행 없음 → 다시 부름', key);
      fire(f.job);
      await alert('GitHub예약:' + f.job.name, `${f.job.name} ${f.slot.toISOString().slice(0, 16)}Z 회차를 불렀는데 20분 안에 실행이 안 생겼다 — 한 번 다시 불렀다`);
    }
    for (const [k, f] of fired) if (now - f.at > 3 * 3600e3) fired.delete(k);   // 기억 정리
    await sbPost('ops_status?on_conflict=id', { id: 'gh-clock', payload: { jobs: jobs.length, fired: fired.size, upto: new Date(end).toISOString() }, updated_at: new Date().toISOString() }, 'resolution=merge-duplicates,return=minimal');
    await sleep(60e3 - (Date.now() % 60e3) + 3000);   // 다음 분 :03 초
  }
  log('시계 종료(다음 시계가 이어받는다)');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--selftest')) {
    const t = (c, iso, exp) => { const r = cronMatch(c, new Date(iso)); console.log(r === exp ? 'ok  ' : 'FAIL', c, iso, r); if (r !== exp) process.exitCode = 1; };
    t('*/10 * * * *', '2026-11-25T01:20:00Z', true); t('*/10 * * * *', '2026-11-25T01:25:00Z', false);
    t('3,13,23,33,43,53 * * * *', '2026-11-25T01:33:00Z', true); t('17 */3 * * *', '2026-11-25T03:17:00Z', true); t('17 */3 * * *', '2026-11-25T04:17:00Z', false);
    t('40 5,19 * * *', '2026-11-25T19:40:00Z', true); t('10 22 * * 0', '2026-11-29T22:10:00Z', true); t('10 22 * * 0', '2026-11-25T22:10:00Z', false);
    t('50 */3 * * *', '2026-11-25T09:50:00Z', true);
    const s = lastSlot('10 20 * * *', Date.parse('2026-11-25T23:00:00Z'), 360); console.log(s && s.toISOString() === '2026-11-25T20:10:00.000Z' ? 'ok   lastSlot' : 'FAIL lastSlot ' + s); if (!s) process.exitCode = 1;
    console.log('작업', JOBS.length, '개, wf', new Set(JOBS.map((j) => j.wf)).size, '종');
  } else await main();
}
