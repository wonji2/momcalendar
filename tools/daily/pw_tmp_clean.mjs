// playwright 임시 프로필 청소기 — C드라이브가 조용히 꽉 차는 것을 막는다 (2026-10-02)
//
// 왜 필요한가 (2026-10-02 사고)
//   C드라이브(233GB)가 여유 0바이트가 되어 파일 쓰기가 ENOSPC 로 죽었다.
//   %LOCALAPPDATA%\Temp 에 playwright_chromiumdev_profile-XXXXXX 가 **3,912개(6.5GB)** 쌓여 있었다.
//
// 🔑 왜 「폴더만 지우는 청소기」로는 안 되는가 (2026-10-02 실측 — 추측 아님)
//   ① 남아 있던 17개는 **전부 크롬 프로세스가 아직 살아서 폴더를 쥐고 있었다.**
//      손으로 2일 경과분을 지웠을 때 이것들이 안 지워진 이유다(파일 잠금). 먼저 **끄지 않으면 못 지운다.**
//   ② 그 크롬들의 부모를 하나하나 찍어보니 **부모 node 도 멀쩡히 살아 있었다**:
//         node src/yt-capture.mjs …      1시간 30분째 그대로 (9회차)
//         node tools/video_frames.mjs …  **이틀째** 그대로
//      bash → node → chrome 이 다 살아 있다. 아무도 안 죽였고, **스크립트가 영원히 안 끝난다.**
//      클로드 Bash 호출이 90초에 기다리기를 포기하고 돌아갔을 뿐이다(그래서 마지막쓰기가 다 90초).
//      ⇒ 「부모가 죽었나」만 보면 **매달려 있는 회차는 영원히 못 치운다** → 규칙 ③ 이 필요하다.
//   ③ 반대로 「try/finally 가 없어 예외로 죽으면 남는다」는 **그것만으로는 안 샜다.**
//      close() 없이 예외를 내 봤더니 프로필 수가 18 → 19 → 18 로 제자리였다(playwright 가 걸어둔
//      process.on('exit') 훅이 taskkill + rmSync 를 해준다). **단, 출력 파이프가 먼저 닫히면**
//      (`| head` 처럼) 그 훅이 EPIPE 로 엎어져 **치우기가 중간에 멈춘다** — 17 → 18 로 남았다.
//      ⇒ 그래서 만드는 쪽도 고쳤다: try/finally 로 직접 닫고, 제한시간을 둔다 (tools/daily/pw_guard.mjs)
//
// 판정 규칙 (여기가 안전장치의 핵심 — 돌고 있는 회차를 죽이지 않는 것이 제일 중요하다)
//   ① 쓰는 프로세스가 없는 폴더      → 만들어진 지 --days(기본 2일) 지났으면 지운다
//   ② 부모가 사라진 크롬(고아)        → --orphan-hours(기본 2시간) 지났으면 끄고 지운다
//        playwright 는 크롬을 `--remote-debugging-pipe` 로 띄운다 — **부모 node 의 파이프로만**
//        말을 걸 수 있다. 부모가 없으면 그 크롬은 누구도 영원히 조종할 수 없는 쓰레기다.
//        · 부모 PID 가 살아 있는데 node.exe 가 아니면 → PID 재사용이다(=고아로 본다)
//   ③ 부모까지 살아 있는데 너무 오래된 크롬 → --stuck-hours(기본 6시간) 지났으면 끄고 지운다
//        **왜 안전한가**: 이 규칙은 *임시* 프로필만 본다. 임시 프로필은 `chromium.launch()` 가
//        만드는 것이고, 그렇게 띄우는 도구는 전부 몇 분 안에 끝나는 한 회차다. 오래 사는 브라우저는
//        **영구 프로필**(sns-automation/browser-profile-*)을 쓰는데 그건 애초에 이 규칙에 안 걸린다.
//        gijil-lab 은 브라우저를 아예 띄우지 않는다(2026-10-02 확인) — 55분 연속 회차와 무관하다.
//        ⚠ 다만 **살아 있는 node 밑의 크롬을 끄는 것**이라 그 node 는 연결 끊김 오류를 내며 죽는다.
//        매달린 회차엔 그게 바라는 바지만, 느린 회차였다면 그 도구 로그에 낯선 오류가 남는다.
//        부모 node 는 **끄지 않는다** — 로그에 PID·명령줄만 남겨 세션이 보고 판단한다
//        (디스크는 폴더만 지워도 풀린다. 남의 회차를 끄는 건 사람이 결정할 일이다)
//
// 안 건드리는 것
//   · 사장님이 쓰는 진짜 크롬(User Data\Profile 1) — 임시프로필 이름에 안 맞으니 애초에 안 걸린다
//   · sns-automation/browser-profile-* (로그인 세션이 든 영구 프로필) — **끄지 않고 로그에만 적는다.**
//     메모리 dont-touch-cafe-publisher·cafe-profile-no-manual-run: 카페 발행기는 손대지 않는다.
//
//   node tools/daily/pw_tmp_clean.mjs                 예약작업 momcal-pw-tmp-clean (하루 1회 04:20)
//   node tools/daily/pw_tmp_clean.mjs --dry           지우지 않고 판정만 (--days 0 과 같이 쓰면 전수 분류를 본다)
//   node tools/daily/pw_tmp_clean.mjs --days 2        며칠 지난 폴더만 지울지 (기본 2 — 돌고 있는 회차를 죽이지 않기 위해)
//   node tools/daily/pw_tmp_clean.mjs --orphan-hours 2  부모 없는 크롬을 몇 시간 뒤에 끌지
//   node tools/daily/pw_tmp_clean.mjs --stuck-hours 6  부모까지 살아 있는 크롬을 몇 시간 뒤에 끌지
//   node tools/daily/pw_tmp_clean.mjs --min-free-gb 10  이보다 여유가 적으면 로그에 🔴 (알림줄은 ops_status_push.mjs 가 올린다)
//
// 로그 scratchpad/pw_tmp_clean_log.txt (회차마다 한 줄 + 판정 내역)
//   ⚠ 예약작업은 stderr 를 버린다(메모리 scheduled-task-swallows-stderr) → 실패도 이 파일에 남긴다.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TMP = os.tmpdir();
const LOGF = path.join(REPO, 'scratchpad', 'pw_tmp_clean_log.txt');

const numArg = (k, d) => {
  const i = process.argv.indexOf(k);
  if (i < 0 || i + 1 >= process.argv.length) return d;
  const v = Number(process.argv[i + 1]);
  return Number.isFinite(v) ? v : d;
};
const DRY = process.argv.includes('--dry');
const DAYS = numArg('--days', 2);
const ORPHAN_H = numArg('--orphan-hours', 2);
const STUCK_H = numArg('--stuck-hours', 6);
const MIN_FREE = numArg('--min-free-gb', 10);

const kst = () => new Date(Date.now() + 9 * 3600e3);
const stamp = () => kst().toISOString().slice(0, 16).replace('T', ' ');
const lines = [];
const log = (s) => { lines.push(s); console.log(s); };
const flush = () => {
  try {
    fs.mkdirSync(path.dirname(LOGF), { recursive: true });
    fs.appendFileSync(LOGF, lines.map((l) => `[${stamp()}] ${l}`).join('\n') + '\n', 'utf8');
  } catch (e) { console.error('로그 쓰기 실패:', e.message); }
};

// ── 임시 프로필로 인정하는 이름 (폴더 이름만 본다 — Temp 의 다른 폴더는 절대 건드리지 않는다)
//   playwright_chromiumdev_profile-XXXXXX  chromium.launch() 가 userDataDir 없이 뜰 때 playwright 가 만든다
//                                          (playwright-core lib/coreBundle.js 의 mkdtemp — launchPersistentContext 는 안 만든다)
//   playwright-artifacts-XXXXXX            같은 함수가 바로 위 줄에서 같이 만든다. ⚠ 밑줄이 아니라 **하이픈**이라
//                                          `playwright_*` 로만 지우면 이 20개가 영원히 남는다 (2026-10-02 실측)
//   pw-listcard-/pw-hdshot-/pw-manual-/pw-voice-  우리 도구가 mkdtempSync 로 직접 만드는 것
const PATTERNS = [
  /^playwright_[a-z]+dev_profile-/i,
  /^playwright-artifacts-/i,
  /^pw-(?:listcard|hdshot|manual|voice)-/i,
];
const isTmpProfile = (name) => PATTERNS.some((re) => re.test(name));

// 동기 대기 — 크롬을 끈 직후 파일 핸들이 풀릴 때까지 기다린다 (await 를 쓸 수 없는 루프 안이다)
const sleepSync = (ms) => { try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch {} };

const freeGb = (p) => {
  try { const s = fs.statfsSync(p); return (Number(s.bavail) * Number(s.bsize)) / 1e9; } catch { return null; }
};
const dirSizeMb = (dir) => {
  let bytes = 0; let files = 0;
  const walk = (d) => {
    if (files > 50000) return;
    let ents = [];
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(f);
      else { files++; try { bytes += fs.statSync(f).size; } catch {} }
    }
  };
  walk(dir);
  return bytes / 1e6;
};

// ── ① 지금 떠 있는 프로세스 중 --user-data-dir 을 쓰는 것 전부 (부모가 살아 있는지까지)
//   PowerShell 조각은 파일로 써서 -File 로 부른다 — -Command 로 넘기면 정규식의 역슬래시가 셸에서 죽는다
//   (메모리 backslash-dies-in-the-shell)
const PS = `$ErrorActionPreference = 'Stop'
# 한글 경로가 든 명령줄을 그대로 넘긴다 — 기본 CP949 로 내보내면 node 가 읽을 때 깨진다 (메모리 db-encoding-traps)
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$procs = @(Get-CimInstance Win32_Process)
$alive = @{}
foreach ($p in $procs) { $alive[[string]$p.ProcessId] = $p }
$rows = New-Object System.Collections.ArrayList
foreach ($p in $procs) {
  $c = $p.CommandLine
  if (-not $c) { continue }
  $m = [regex]::Match($c, '--user-data-dir=(?:"([^"]+)"|([^\\s"]+))')
  if (-not $m.Success) { continue }
  $dir = if ($m.Groups[1].Success) { $m.Groups[1].Value } else { $m.Groups[2].Value }
  $pp = [string]$p.ParentProcessId
  [void]$rows.Add([pscustomobject]@{
    pid     = [int]$p.ProcessId
    ppid    = [int]$p.ParentProcessId
    name    = [string]$p.Name
    dir     = $dir
    started = $(if ($p.CreationDate) { $p.CreationDate.ToString('yyyy-MM-ddTHH:mm:ss') } else { $null })
    parent  = $(if ($alive.ContainsKey($pp)) { [string]$alive[$pp].Name } else { $null })
    pcmd    = $(if ($alive.ContainsKey($pp) -and $alive[$pp].CommandLine) { ([string]$alive[$pp].CommandLine -replace '\\s+', ' ') } else { $null })
  })
}
ConvertTo-Json -Compress -Depth 3 -InputObject @($rows)
`;

let procs = [];
try {
  const psFile = path.join(REPO, 'scratchpad', '_pw_tmp_clean.ps1');
  fs.mkdirSync(path.dirname(psFile), { recursive: true });
  fs.writeFileSync(psFile, PS, 'utf8');
  const raw = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', psFile], { encoding: 'utf8', timeout: 180e3, stdio: ['ignore', 'pipe', 'pipe'] });
  const j = JSON.parse(raw.trim() || '[]');
  procs = Array.isArray(j) ? j : [j];   // PS 5.1 은 1개일 때 배열로 안 싸준다
} catch (e) {
  log(`🔴 프로세스 목록을 못 읽었다 — 아무것도 지우지 않는다: ${String(e.message).slice(0, 200)}`);
  flush();
  process.exit(1);
}

const key = (p) => path.resolve(p).toLowerCase();
const byDir = new Map();           // 임시프로필 폴더 → 그 폴더를 쓰는 프로세스들
const persistentOrphans = [];      // 영구 프로필(browser-profile-*)을 쥔 고아 — 끄지 않고 알리기만
for (const p of procs) {
  if (!p || !p.dir) continue;
  const base = path.basename(p.dir);
  if (isTmpProfile(base)) {
    const k = key(p.dir);
    if (!byDir.has(k)) byDir.set(k, []);
    byDir.get(k).push(p);
  } else if (/browser-profile/i.test(p.dir) && !p.parent && /chrome|msedge|firefox/i.test(p.name || '')) {
    persistentOrphans.push(p);
  }
}

// 그룹의 '으뜸' 프로세스 = 부모가 같은 그룹 안에 없는 것 (렌더러·GPU 는 으뜸 크롬의 자식이라 제외된다)
const groupState = (list) => {
  const pids = new Set(list.map((p) => p.pid));
  const mains = list.filter((p) => !pids.has(p.ppid));
  const orphan = mains.length > 0 && mains.every((m) => !m.parent);
  const oldestMs = Math.min(...mains.map((m) => (m.started ? new Date(m.started).getTime() : Date.now())));
  return { mains, orphan, ageH: (Date.now() - oldestMs) / 3600e3 };
};

// 크롬 그룹을 끄고 폴더를 지운다 (부모 node 는 끄지 않는다 — 로그에만 남긴다)
const killAndRemove = (dir, st, list, why) => {
  const mb = dirSizeMb(dir);
  const parents = st.mains.map((m) => `PID ${m.pid}${m.parent ? ` ← ${m.parent}(${m.ppid})` : ' ← 부모없음'}`).join(', ');
  log(`  ${why} ${path.basename(dir)} · ${st.ageH.toFixed(1)}시간 · ${mb.toFixed(1)}MB · 프로세스 ${list.length}개 · ${parents}`);
  if (DRY) return { killed: st.mains.length, removed: 1, mb, failed: 0, fail: null, zombie: 0 };
  let k = 0;
  for (const p of list) {
    try { execFileSync('taskkill', ['/PID', String(p.pid), '/T', '/F'], { stdio: 'ignore', timeout: 30e3 }); k++; }
    catch { /* 이미 죽었거나, 부모와 함께 /T 로 죽었다 */ }
  }
  // 크롬이 파일 핸들을 놓을 틈을 준다 (안 기다리면 EBUSY 로 지워지지 않는다)
  sleepSync(2000);
  try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); return { killed: k, removed: 1, mb, failed: 0, fail: null, zombie: 0 }; }
  catch (e) {
    // 🔴 2026-10-02 실측: **안 죽는 크롬이 있다.** 22~26시간 된 부모없는 크롬 4개가
    //   `taskkill /T /F` 에 "ERROR: … could not be terminated. Reason: There is no running
    //   instance of the task" 로 답하고, Stop-Process 는 성공했다는데도 Win32_Process 목록에 남았다.
    //   이미 끝난 프로세스인데 커널이 핸들을 못 놓은 좀비다 — first_party_sets.db 를 계속 쥐고 있어
    //   폴더가 EPERM 으로 안 지워진다. **재부팅 전까지는 누구도 못 지운다.**
    //   ⚠ `process.kill(pid, 0)` 으로는 못 가린다 — 이 좀비들에 대해 node 는 ESRCH(없다)를 돌려준다(실측).
    //      그래서 **잠긴 오류코드로 가른다.** 「무언가 아직 쥐고 있다」는 이 도구의 고장이 아니다.
    //   이걸 '실패' 로 세면 예약작업이 **매일 빨간불**이 되고, 그러면 진짜 고장이 묻힌다(17MB 때문에).
    const code = String(e.code || '');
    if (code === 'EPERM' || code === 'EBUSY' || code === 'ENOTEMPTY' || code === 'EACCES') {
      return { killed: k, removed: 0, mb: 0, failed: 0, fail: null, zombie: 1, zinfo: `${path.basename(dir)} · ${mb.toFixed(1)}MB · ${code} · 쥐고 있던 PID ${list.map((p) => p.pid).join(',')}` };
    }
    return { killed: k, removed: 0, mb: 0, failed: 1, fail: `${path.basename(dir)} — ${code || String(e.message).slice(0, 60)}`, zombie: 0 };
  }
};

// ── ② Temp 를 훑어 판정
let entries = [];
try { entries = fs.readdirSync(TMP, { withFileTypes: true }); }
catch (e) { log(`🔴 Temp 를 못 읽었다: ${e.message}`); flush(); process.exit(1); }

const targets = entries.filter((e) => e.isDirectory() && isTmpProfile(e.name)).map((e) => path.join(TMP, e.name));
const before = freeGb('C:\\');
log(`Temp ${TMP} · 임시프로필 ${targets.length}개 · 기준 ${DAYS}일 / 부모없음 ${ORPHAN_H}시간 / 매달림 ${STUCK_H}시간${DRY ? ' · (--dry 판정만)' : ''}`);

let removed = 0; let killed = 0; let skippedLive = 0; let skippedYoung = 0; let failed = 0; let freedMb = 0; let zombies = 0;
const fails = [];
const zinfos = [];
const stuckParents = [];
const take = (r) => {
  killed += r.killed; removed += r.removed; freedMb += r.mb; failed += r.failed; zombies += r.zombie || 0;
  if (r.fail) fails.push(r.fail);
  if (r.zinfo) zinfos.push(r.zinfo);
};

for (const dir of targets) {
  let ageD = 0;
  try { ageD = (Date.now() - fs.statSync(dir).birthtimeMs) / 864e5; } catch { continue; }
  const list = byDir.get(key(dir)) || [];
  const st = list.length ? groupState(list) : null;

  // ① 아무 프로세스도 안 쓰는 폴더 — 날짜 기준만 본다
  if (!st) {
    if (ageD < DAYS) { skippedYoung++; continue; }
    const mb = dirSizeMb(dir);
    log(`  빈폴더 ${path.basename(dir)} · ${ageD.toFixed(1)}일 · ${mb.toFixed(1)}MB`);
    if (DRY) { removed++; freedMb += mb; continue; }
    try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); removed++; freedMb += mb; }
    catch (e) {
      // 프로세스 목록에 없는데도 잠겨 있는 경우가 있다(목록에서 사라진 좀비) — 위와 같은 이유로 실패로 세지 않는다
      const code = String(e.code || '');
      if (code === 'EPERM' || code === 'EBUSY' || code === 'ENOTEMPTY' || code === 'EACCES') { zombies++; zinfos.push(`${path.basename(dir)} · ${mb.toFixed(1)}MB · ${code} · 쥐고 있는 프로세스는 목록에 없다`); }
      else { failed++; fails.push(`${path.basename(dir)} — ${code || String(e.message).slice(0, 60)}`); }
    }
    continue;
  }

  // ② 부모가 사라진 크롬 — 아무도 조종할 수 없다
  if (st.orphan) {
    if (st.ageH < ORPHAN_H) { skippedYoung++; continue; }
    take(killAndRemove(dir, st, list, '부모없음'));
    continue;
  }

  // ③ 부모까지 살아 있는데 너무 오래된 크롬 = 매달린 회차
  if (st.ageH >= STUCK_H) {
    take(killAndRemove(dir, st, list, '매달림'));
    for (const m of st.mains) if (m.parent) stuckParents.push(`PID ${m.ppid} ${m.parent} ${String(m.pcmd || '').slice(0, 150)}`);
    continue;
  }

  // 그 밖에는 돌고 있는 회차다 — 절대 건드리지 않는다
  skippedLive++;
}

const after = DRY ? before : freeGb('C:\\');
log(`${DRY ? '[판정]' : '[실행]'} 지움 ${removed}개 · 끈 크롬 ${killed}개 · 확보 ${freedMb.toFixed(0)}MB · 남김(돌고있음) ${skippedLive} · 남김(유예) ${skippedYoung} · 안죽는크롬 ${zombies} · 실패 ${failed}`);
if (fails.length) { log(`⚠ 못 지운 것 ${fails.length}개 (다음 회차에 다시 시도):`); for (const f of fails.slice(0, 10)) log(`   ${f}`); }
if (zinfos.length) {
  // 실패가 아니다 — 우리가 할 수 있는 게 없다. 재부팅하면 사라진다
  log(`ℹ 안 죽는 크롬이 쥐고 있어 못 지운 것 ${zinfos.length}개 — **재부팅하면 사라진다**(실패 아님):`);
  for (const z of zinfos.slice(0, 8)) log(`   ${z}`);
}
if (stuckParents.length) {
  // 폴더는 치웠다. 매달린 node 는 끄지 않았으니 **왜 안 끝나는지**는 세션이 봐야 한다
  log(`⚠ ${STUCK_H}시간 넘게 안 끝난 회차 ${stuckParents.length}개 — node 는 끄지 않았다(세션에서 원인 볼 것):`);
  for (const s of stuckParents.slice(0, 8)) log(`   ${s}`);
}
if (persistentOrphans.length) {
  // 끄지 않는다 — 카페·인포크 발행기 세션이 든 프로필이다. 다만 **보이게** 한다.
  log(`⚠ 부모 없는 영구프로필 크롬 ${persistentOrphans.length}개 (끄지 않음 — 세션에서 판단할 것):`);
  for (const p of persistentOrphans.slice(0, 8)) log(`   PID ${p.pid} ${path.basename(p.dir)} (시작 ${String(p.started).replace('T', ' ')})`);
}
if (before != null) log(`C드라이브 여유 ${before.toFixed(1)}GB → ${after != null ? after.toFixed(1) : '?'}GB (기준 ${MIN_FREE}GB)`);
if (after != null && after < MIN_FREE) log(`🔴 C드라이브 여유 ${after.toFixed(1)}GB — 기준 ${MIN_FREE}GB 미만. 알림줄은 ops_status_push.mjs 가 올린다`);

flush();
// 지울 게 있었는데 하나도 못 지웠다면 그 자체가 고장이다 — 예약작업에 빨간불로 보여야 한다.
// ⚠ 「안 죽는 크롬(zombies)」 은 여기서 세지 않는다 — 재부팅 전까지 아무도 못 지우는 것이라
//   실패로 세면 예약작업이 **매일 빨간불**이 되고, 그러면 진짜 고장이 묻힌다 (2026-10-02 실측 4개/17MB).
if (!DRY && failed > 0 && removed === 0) process.exit(1);
