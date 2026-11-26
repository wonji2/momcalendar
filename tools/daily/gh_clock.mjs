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
// 읽기 호출: 러너에선 gh(토큰 있음), 이 PC 처럼 gh 가 없으면 공개 API 를 curl 로(시험·수동 점검용)
const ghApi = (q) => { try { return gh(['api', q]); } catch (e) { if (process.env.GH_TOKEN) throw e; return execFileSync('curl', ['-s', '--max-time', '30', 'https://api.github.com/' + q], { encoding: 'utf8' }); } };
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
    // 쪽을 넘겨 끝까지 본다(pc-jobs-cloud 는 하루 100번 넘게 돌아 한 쪽에 안 담긴다 — 넘겨받는 순간 하루 한 번짜리를 다시 부르는 사고 방지)
    for (let page = 1; page <= 5; page++) {
      const q = `repos/${REPO}/actions/workflows/${job.wf}.yml/runs?per_page=100&page=${page}&created=%3E%3D${new Date(slot - 90e3).toISOString().slice(0, 19)}Z`;
      const runs = JSON.parse(ghApi(q)).workflow_runs || [];
      if (runs.some((r) => !job.c || String(r.display_title || '').includes(job.c))) return true;
      if (runs.length < 100) return false;
    }
    return false;
  } catch (e) { log('실행 목록 읽기 실패', job.name, String(e.message).slice(0, 80)); return null; }
}

// ── 스스로 재기: 같은 작업 같은 회차 2번 이상(중복) · 정시 +20분 넘어 시작(지각)/안 시작(없음) → health_alerts, 하루 한 번 요약 → ops_status 'gh-clock-daily'
//    (시계가 부른 workflow_dispatch 실행만 센다 — seo-daily·seo-index-sample 의 자체 예약 재시도는 건너뛰기 안전망이라 세지 않는다)
function runsSince(wf, sinceMs) {
  const out = [];
  try {
    for (let page = 1; page <= 5; page++) {
      const q = `repos/${REPO}/actions/workflows/${wf}.yml/runs?per_page=100&page=${page}&event=workflow_dispatch&created=%3E%3D${new Date(sinceMs).toISOString().slice(0, 19)}Z`;
      const runs = JSON.parse(ghApi(q)).workflow_runs || [];
      out.push(...runs.map((r) => ({ t: Date.parse(r.created_at), title: String(r.display_title || '') })));
      if (runs.length < 100) break;
    }
    return out;
  } catch { return null; }
}
export function auditJobs(jobs, hours, now = Date.now()) {
  const res = { ok: 0, late: [], missing: [], dup: [], skipped: 0 };
  const from = now - hours * 3600e3;
  for (const wf of new Set(jobs.map((j) => j.wf))) {
    const runs = runsSince(wf, from - 5 * 60e3);
    if (!runs) { res.skipped++; continue; }
    for (const j of jobs.filter((x) => x.wf === wf)) {
      const slots = [];
      for (let t = Math.ceil(from / 60e3) * 60e3; t <= now; t += 60e3) if (cronMatch(j.cron, new Date(t))) slots.push(t);
      const mine = runs.filter((r) => !j.c || r.title.includes(j.c));
      for (const s of slots) {
        if (s > now - 20 * 60e3) continue;   // 20분 안 지난 회차는 아직 판정 안 함(다음 회차 경계 계산에는 쓴다)
        const next = slots.find((x) => x > s) || Infinity;
        const hit = mine.filter((m) => m.t >= s - 90e3 && m.t < Math.min(next - 90e3, s + 3 * 3600e3));
        const lag = hit.length ? (Math.min(...hit.map((h) => h.t)) - s) / 60e3 : null;
        const tag = j.name + ' ' + new Date(s).toISOString().slice(5, 16) + 'Z';
        // 2026-11-27: 중복은 「같은 회차 부름이 25분 안에 둘」일 때만 센다. 길게(3시간) 보면 자기 사슬을 잇는 workflow_dispatch(hotdeal-cloud 345분 사슬·live-watch 재시작)가 섞여 거짓 경보가 났다(11-25 23:08Z·11-26 14:25Z).
        const near = hit.filter((m) => m.t < s + 25 * 60e3);
        if (near.length > 1) res.dup.push(tag + ' ×' + near.length);
        else if (!hit.length) res.missing.push(tag);
        else if (lag > 20) res.late.push(tag + ' +' + Math.round(lag) + '분');
        else res.ok++;
      }
    }
  }
  return res;
}
async function auditAndAlert(jobs, hours) {
  const r = auditJobs(jobs, hours);
  log('점검', hours + 'h', 'ok', r.ok, '지각', r.late.length, '없음', r.missing.length, '중복', r.dup.length);
  if (r.dup.length) await alert('GitHub예약:중복', '같은 작업 같은 회차가 두 번 이상 불렸다: ' + r.dup.slice(0, 5).join(' · '));
  if (r.late.length) await alert('GitHub예약:지각', '정시 +20분 넘어 시작: ' + r.late.slice(0, 5).join(' · '));
  if (r.missing.length) await alert('GitHub예약:없음', '정시 +20분이 지나도 시작 안 함: ' + r.missing.slice(0, 5).join(' · '));
  return r;
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
  let lastAudit = 0;
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
    // 30분마다(분 10·40 부근) 최근 3시간 점검 · 한국 09시(UTC 00시) 한 번 지난 24시간 요약을 ops_status 에
    const d = new Date(now);
    if (!DRY && [10, 40].includes(d.getUTCMinutes()) && lastAudit !== now - (now % 60e3)) {
      lastAudit = now - (now % 60e3);
      await auditAndAlert(jobs, 3);
      if (d.getUTCHours() === 0 && d.getUTCMinutes() === 10 && !ONLY.length) {
        const r = await auditAndAlert(jobs, 24);
        await sbPost('ops_status?on_conflict=id', { id: 'gh-clock-daily', payload: { at: d.toISOString(), ok: r.ok, late: r.late, missing: r.missing, dup: r.dup }, updated_at: d.toISOString() }, 'resolution=merge-duplicates,return=minimal');
      }
    }
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
