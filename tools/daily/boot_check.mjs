// 🔌 재부팅 뒤 자동 점검 — PC 가 켜질 때마다 「하던 일이 이어서 도는지」 스스로 확인하고 관리자 페이지에 남긴다 (2026-10-27)
//   사장님: 「잠깐 꺼졌다 켜져도 하던 업무는 끊기지 않고 이어서」 · 「다음에 그걸 어케기억해 지금 작업해놔 · 언제 컴끄고 킬지 모르는데」
//   → 사람이 기억하지 않아도 켜질 때마다 이 도구가 돈다(예약작업 momcal-boot-check: 로그인할 때 + 15분 뒤).
//
//   확인하는 것
//     ① 켜진 시각·로그인 시각 → 자동 로그인이 됐나(켜진 뒤 5분 안에 로그인)
//     ② 그 전에 어떻게 꺼졌나 — 정상 종료 / 정전·강제 꺼짐(이벤트 41·6008) → 정전 뒤 저절로 켜졌으면 바이오스 AC BACK 이 된 것
//     ③ 「놓친 회차 따라잡기(StartWhenAvailable)」가 켜진 작업이 하나도 없나 — 2026-11-01 사고(재부팅 뒤 70개 동시 실행 → 라이브 파일 지움) 뒤로는 전부 꺼 둔다.
//        켜진 것이 보이면 누가 옛 XML 로 복원했거나 새 작업을 기본값으로 만든 것 → tools/daily/tasks_safe_mode.ps1 -Apply
//     ④ 바이오스 AC BACK 설정을 아직 안 했으면 화면에 안내창(「예」를 누르면 다시 안 물음 → scratchpad/bios_acback_done.txt)
//   결과: 서버 ops_status 'pc-boot'(언제 켜졌고 무엇이 됐나) + 문제가 있으면 health_alerts 'PC재부팅:…'(관리자 ops.html 감시기 경보·admin 홈)
//   실행  node tools/daily/boot_check.mjs        (예약작업이 부름)
//         node tools/daily/boot_check.mjs --dry  (서버에 안 쓰고 결과만, 안내창 안 띄움)
//   로그  scratchpad/boot_check_log.txt
//   ⚠ PC 를 감시하는 도구라 PC 에 둔다(0-Y-PC 의 「PC 자체 감시」). 결과는 서버로 보내서 PC 가 다시 꺼져도 남는다
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DRY = process.argv.includes('--dry');
const LOG = path.join(ROOT, 'scratchpad', 'boot_check_log.txt');
const BIOS_DONE = path.join(ROOT, 'scratchpad', 'bios_acback_done.txt');
const env = fs.readFileSync(path.join(ROOT, 'tools/daily/.env'), 'utf8');
const KEY = (env.match(/^SB_SERVICE_KEY=(.+)$/m) || [])[1]?.trim();
const SB = 'https://hycaqsqeogjtbscmzrtm.supabase.co/rest/v1/';
const log = (m) => { const l = `${new Date().toISOString()} ${m}`; console.log(l); if (!DRY) fs.appendFileSync(LOG, l + '\n'); };
const ps = (cmd) => execFileSync('powershell', ['-NoProfile', '-Command', `[Console]::OutputEncoding=[Text.Encoding]::UTF8; ${cmd}`], { encoding: 'utf8', timeout: 120e3 }).trim();

// ① 켜진 시각 · 로그인 시각
const info = JSON.parse(ps(`
$os = Get-CimInstance Win32_OperatingSystem
$logon = (Get-WinEvent -FilterHashtable @{LogName='System'; ProviderName='Microsoft-Windows-Winlogon'; Id=7001; StartTime=$os.LastBootUpTime} -ErrorAction SilentlyContinue | Sort-Object TimeCreated | Select-Object -First 1).TimeCreated   # 켜진 뒤 첫 로그인(보안 로그는 관리자 권한이라 못 읽음)
$prev = Get-WinEvent -FilterHashtable @{LogName='System'; Id=41,6008,1074; StartTime=$os.LastBootUpTime.AddDays(-30); EndTime=$os.LastBootUpTime.AddMinutes(5)} -MaxEvents 5 -ErrorAction SilentlyContinue | Select-Object -First 1
@{ boot = $os.LastBootUpTime.ToString('o'); logon = $(if($logon){$logon.ToString('o')}else{$null}); prevId = $(if($prev){$prev.Id}else{$null}); prevAt = $(if($prev){$prev.TimeCreated.ToString('o')}else{$null}) } | ConvertTo-Json -Compress`));
const boot = new Date(info.boot), logon = info.logon ? new Date(info.logon) : null;
const autologon = logon ? (logon - boot) / 60e3 <= 5 : null;
const howOff = info.prevId === 1074 ? '정상 종료·재시작' : info.prevId === 41 || info.prevId === 6008 ? '정전 또는 강제 꺼짐' : '알 수 없음';

// ③ StartWhenAvailable 이 켜진 작업이 있나 — 2026-11-01 사고 뒤로는 0 이어야 한다(tasks_safe_mode.ps1). 켜진 게 있으면 그 이름을 경보에 싣는다
const lag = JSON.parse(ps(`
$pat = '^(momcal-|njob-|work-backup|gijil-|dad-|blogauto-|econ-|smartstore-track$|Tick$|Learn$|RefreshToken$)'
$all = Get-ScheduledTask | Where-Object { ($_.TaskPath -eq [string][char]92 -or $_.TaskPath -eq ([string][char]92 + 'ThreadsAutopilot' + [char]92)) -and $_.TaskName -match $pat }
$on = @($all | Where-Object { $_.Settings.StartWhenAvailable } | ForEach-Object { $_.TaskName })
@{ n = $all.Count; stuck = $on } | ConvertTo-Json -Compress`));
const stuck = [].concat(lag.stuck || []);

const problems = [];
if (autologon === false) problems.push(['자동로그인', `켜진 뒤 ${Math.round((logon - boot) / 60e3)}분 지나서야 로그인 — 자동 로그인이 안 됐다(그동안 예약작업이 전부 멈춰 있었다)`]);
if (stuck.length) problems.push(['따라잡기켜짐', `StartWhenAvailable 이 켜진 작업 ${stuck.length}개(재부팅 때 몰아서 돈다 — tasks_safe_mode.ps1 -Apply): ${stuck.slice(0, 8).join(', ')}`]);
const biosDone = fs.existsSync(BIOS_DONE);
const result = { boot: info.boot, logon: info.logon, autologon, howOff, prevAt: info.prevAt, tasks: lag.n, stuck, biosAcBack: biosDone ? 'done' : (howOff === '정전 또는 강제 꺼짐' && autologon ? 'worked' : 'unknown'), checkedAt: new Date().toISOString() };
log(`켜짐 ${info.boot} · 로그인 ${info.logon ?? '?'} · 자동 로그인 ${autologon} · 그 전 ${howOff} · 작업 ${lag.n} · 따라잡기 켜진 것 ${stuck.length}`);

// 서버로 — PC 가 다시 꺼져도 남게
if (!DRY && KEY) {
  const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };
  const put = (id, payload) => fetch(SB + 'ops_status?on_conflict=id', { method: 'POST', headers: { ...H, Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ id, payload, updated_at: new Date().toISOString() }), signal: AbortSignal.timeout(20000) });
  try { const r = await put('pc-boot', result); log('서버 기록 ' + r.status); } catch (e) { log('⚠ 서버 기록 실패 ' + e.message); }
  for (const [k, t] of problems) {
    try {
      await fetch(SB + 'health_alerts', { method: 'POST', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify({ kind: 'PC재부팅:' + k, detail: '🔴 ' + t }), signal: AbortSignal.timeout(20000) });
      log('🔴 ' + t);
    } catch (e) { log('⚠ 경보 실패 ' + e.message); }
  }
  // 정전 뒤 저절로 켜졌다 = 바이오스 AC BACK 이 된다는 증거 → 안내창을 더 안 띄운다
  if (!biosDone && result.biosAcBack === 'worked') fs.writeFileSync(BIOS_DONE, `정전·강제 꺼짐 뒤 저절로 켜짐 확인 ${info.boot}\n`);
}

// ④ 바이오스 안내창 — 「예」를 누를 때까지 켜질 때마다
if (!DRY && !fs.existsSync(BIOS_DONE)) {
  const vbs = path.join(ROOT, 'tools', 'daily', 'bios_acback_ask.vbs');
  spawn('wscript.exe', [vbs, BIOS_DONE], { detached: true, stdio: 'ignore' }).unref();
  log('바이오스 안내창 띄움');
}
