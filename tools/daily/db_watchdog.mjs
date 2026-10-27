// DB 먹통 감시 + 자동 재시작 — momcal-db-watchdog (윈도우 예약작업, 매 1분)
//
// 왜(2026-10-27 사고): Supabase 무료 Nano DB 가 09:44~10:33 **44분** 연결조차 안 됐다. 15분 감시(live_smoke)는 🔴 를 적었지만
//   「고치는 손」이 없어 Supabase 가 스스로 재시작할 때까지 손님 화면이 빈 채였다. 사장님: "거의 1시간을 사이트가 먹통되도 바로 고치는 기능이 없어?"
// 흐름(매분):
//   ① REST 1건(hotdeals limit=1, 8초) → 되면 끝. 내려가 있던 중이면 「복구」 알림 + health_alerts 에 사고 한 줄(걸린 시간)
//   ② 안 되면 실패 횟수를 상태 파일에 센다. **3회 연속(≈3분)** 부터 사고로 본다 — 1회 흔들림으로 재시작하지 않는다
//   ③ 사고면: 게이트웨이(/rest/v1/ 키 없이 → 401 즉답)를 본다. 게이트웨이도 죽었으면 Supabase·망 장애 → 재시작 안 함, 알림만
//   ④ DB 만 죽었으면 관리 API 로 health 를 보고 → `POST /v1/projects/{ref}/restart`. **20분에 1번만**(연속 재시작 금지)
//   ⑤ 알림 = 윈도우 토스트 + scratchpad/db_watchdog_log.txt (DB 가 죽어 있으니 알림줄(health_alerts)은 못 쓴다 → 복구 뒤에 적는다). 내려가 있는 동안 10분마다 다시 알린다
// 필요한 것: tools/daily/.env 의 SUPABASE_ACCESS_TOKEN (Supabase 개인 접근 토큰, 대시보드 → Account → Access Tokens, 권한 projects:write).
//   🔴 이 토큰이 없으면 감시·알림만 하고 재시작은 못 한다(로그에 「토큰 없음」). 백업 제외 값이라 잃으면 다시 만든다.
// 상태: scratchpad/db_watchdog_state.json · 로그: scratchpad/db_watchdog_log.txt
// 실행: node tools/daily/db_watchdog.mjs            (예약작업이 매분)
//       node tools/daily/db_watchdog.mjs --simulate-down --dry   (실패 경로 시험: 재시작 호출은 안 함)
//       node tools/daily/db_watchdog.mjs --reset                 (상태 파일 초기화)
// 등록: tasks_backup.ps1 의 XML(momcal-db-watchdog) — 규칙 0-Y, PC 바뀌면 -Restore
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url'; import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..');
const STATE = path.join(REPO, 'scratchpad', 'db_watchdog_state.json');
const LOGF = path.join(REPO, 'scratchpad', 'db_watchdog_log.txt');
const REF = 'hycaqsqeogjtbscmzrtm';
const SB = `https://${REF}.supabase.co`;
const ANON = 'sb_publishable_u4hR4mdNTSss3kdjFH6R5Q_iuJ2MuGE';
const MGMT = 'https://api.supabase.com';
const FAIL_STREAK = 3;            // 연속 실패 n회부터 사고
const RESTART_GAP_MS = 20 * 60e3;  // 재시작 사이 최소 간격
const REALERT_MS = 10 * 60e3;      // 내려가 있는 동안 다시 알리는 간격
const argv = process.argv.slice(2);
const SIM = argv.includes('--simulate-down'), DRY = argv.includes('--dry');

const env = {};
try { for (const l of fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/); if (m) env[m[1]] = m[2].replace(/^"|"$/g, ''); } } catch (_) {}
const TOKEN = env.SUPABASE_ACCESS_TOKEN || '', SERVICE = env.SB_SERVICE_KEY || '';

const kst = (d = new Date()) => new Date(d.getTime() + 9 * 3600e3).toISOString().slice(0, 19).replace('T', ' ');
function log(line) { const s = `[${kst()}] ${line}`; console.log(s); try { fs.appendFileSync(LOGF, s + '\n'); } catch (_) {} }
function loadState() { try { return JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch (_) { return { fails: 0, downSince: null, lastRestart: null, lastAlert: null, tokenWarned: false }; } }
function saveState(s) { fs.writeFileSync(STATE, JSON.stringify(s, null, 1)); }

async function get(url, headers = {}, ms = 8000, method = 'GET', body) {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), ms); const t0 = Date.now();
  try { const r = await fetch(url, { method, headers, body, signal: ac.signal, redirect: 'manual' }); const txt = await r.text().catch(() => ''); return { code: r.status, ms: Date.now() - t0, txt }; }
  catch (e) { return { code: 0, ms: Date.now() - t0, txt: String(e && e.name || e) }; }
  finally { clearTimeout(t); }
}
const probeDb = () => SIM ? Promise.resolve({ code: 0, ms: 8000, txt: 'simulated' }) : get(`${SB}/rest/v1/hotdeals?select=id&limit=1`, { apikey: ANON });
const probeGateway = () => get(`${SB}/rest/v1/`, {}, 8000);   // 키 없이 → 401 이 즉시 오면 게이트웨이 정상

// 윈도우 토스트 — 이 PC 앞에 계시면 바로 보인다. 실패해도 감시는 계속
function toast(title, body) {
  try {
    const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/'/g, '&#39;');
    const ps = `[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType=WindowsRuntime] | Out-Null; $x=[Windows.Data.Xml.Dom.XmlDocument]::new(); $x.LoadXml('<toast scenario="urgent"><visual><binding template="ToastGeneric"><text>${esc(title)}</text><text>${esc(body)}</text></binding></visual></toast>'); [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe').Show([Windows.UI.Notifications.ToastNotification]::new($x))`;
    spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { timeout: 15000, windowsHide: true });
  } catch (_) {}
}
// 복구 뒤 알림줄(health_alerts)에 사고 한 줄 — ops.html 알림줄·status_report 가 읽는다
async function healthAlert(kind, detail) {
  if (!SERVICE) return;
  const r = await get(`${SB}/rest/v1/health_alerts`, { apikey: SERVICE, Authorization: 'Bearer ' + SERVICE, 'Content-Type': 'application/json', Prefer: 'return=minimal' }, 8000, 'POST', JSON.stringify({ kind, detail }));
  if (r.code !== 201) log(`  ⚠ health_alerts 기록 실패 ${r.code} ${r.txt.slice(0, 80)}`);
}
async function restartProject(state) {
  if (!TOKEN) { if (!state.tokenWarned) { log('  🔴 SUPABASE_ACCESS_TOKEN 없음 — 재시작 못 한다. tools/daily/.env 에 넣을 것(대시보드 → Account → Access Tokens, projects:write)'); state.tokenWarned = true; } return false; }
  const h = { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' };
  const hc = await get(`${MGMT}/v1/projects/${REF}/health?services=db,rest&timeout_ms=5000`, h, 12000);
  log(`  관리 API health: ${hc.code} ${hc.txt.slice(0, 160).replace(/\s+/g, ' ')}`);
  let unhealthy = true;
  try { const j = JSON.parse(hc.txt); if (Array.isArray(j)) unhealthy = j.some((s) => s.healthy === false); } catch (_) {}
  if (!unhealthy) { log('  관리 API 는 healthy 라고 한다 — 그래도 손님 길(REST)이 막혀 있으니 재시작한다'); }
  if (DRY) { log('  (dry) POST /restart 생략'); return true; }
  const r = await get(`${MGMT}/v1/projects/${REF}/restart`, h, 20000, 'POST', '{}');
  log(`  🔁 POST /v1/projects/${REF}/restart → ${r.code} ${r.txt.slice(0, 120)}`);
  return r.code >= 200 && r.code < 300;
}

async function main() {
  if (argv.includes('--reset')) { try { fs.unlinkSync(STATE); } catch (_) {} log('상태 초기화'); return; }
  const state = loadState();
  const db = await probeDb();
  if (db.code === 200) {
    if (state.downSince) {
      const mins = Math.round((Date.now() - new Date(state.downSince).getTime()) / 60e3);
      log(`✅ DB 복구 — ${mins}분 만에 (실패 ${state.fails}회, 재시작 ${state.lastRestart ? kst(new Date(state.lastRestart)) : '안 함'})`);
      toast('맘캘린더 DB 복구', `${mins}분 만에 돌아왔습니다 (${kst()})`);
      await healthAlert('db_down', `DB 무응답 ${mins}분 (${kst(new Date(state.downSince))} ~ ${kst()}) · 재시작 ${state.lastRestart ? '함 ' + kst(new Date(state.lastRestart)) : '안 함(토큰 ' + (TOKEN ? '있음' : '없음') + ')'}`);
    }
    if (state.fails) log(`✅ 정상 (${db.ms}ms) — 앞선 실패 ${state.fails}회 해제`);
    saveState({ fails: 0, downSince: null, lastRestart: state.lastRestart, lastAlert: null, tokenWarned: false });
    return;
  }
  state.fails = (state.fails || 0) + 1;
  log(`🔴 DB 응답 없음 ${state.fails}회 (${db.code} ${db.ms}ms ${db.txt.slice(0, 40)})`);
  if (state.fails < FAIL_STREAK) { saveState(state); return; }
  if (!state.downSince) state.downSince = new Date(Date.now() - (state.fails - 1) * 60e3).toISOString();
  const gw = await probeGateway();
  const gwOk = gw.code === 401 || gw.code === 404;
  const since = Math.round((Date.now() - new Date(state.downSince).getTime()) / 60e3);
  const needAlert = !state.lastAlert || Date.now() - new Date(state.lastAlert).getTime() > REALERT_MS;
  if (needAlert) {
    toast('🔴 맘캘린더 DB 먹통', `${since}분째 응답 없음 · ${gwOk ? 'DB 만 죽음 → ' + (TOKEN ? '자동 재시작' : '토큰 없어 재시작 못 함') : '게이트웨이까지 죽음(Supabase·망 장애)'}`);
    state.lastAlert = new Date().toISOString();
  }
  if (!gwOk) { log(`  게이트웨이도 무응답(${gw.code}) — Supabase 전체·망 장애로 보고 재시작하지 않는다`); saveState(state); return; }
  const canRestart = !state.lastRestart || Date.now() - new Date(state.lastRestart).getTime() > RESTART_GAP_MS;
  if (!canRestart) { log(`  재시작은 ${kst(new Date(state.lastRestart))} 에 했다 — 20분 지나기 전엔 다시 안 한다`); saveState(state); return; }
  const ok = await restartProject(state);
  if (ok) state.lastRestart = new Date().toISOString();
  saveState(state);
}
main().catch((e) => { log('🔴 watchdog 오류 ' + (e && e.message || e)); process.exit(1); });
