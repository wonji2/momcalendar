// 새 PC·앱 재설치 후 작업 환경 자가복구 (사장님 지시 2026-09-01)
//   "채팅 날아가도 항상 새로 앱 받아서 새 채팅 켜도 이어서 작업 가능하게"
//
//   node tools/daily/restore_env.mjs --check   ← 진단만 (아무것도 안 고침)
//   node tools/daily/restore_env.mjs           ← 없는 것만 채운다
//
// ⚠ 절대 덮어쓰지 않는다. **없는 파일만** 채운다.
//   (2026-08-14 /MIR 되감기 사고 — 백업이 최신본을 덮어 되돌린 적이 있다)
import { existsSync, mkdirSync, readdirSync, copyFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const HOME = process.env.USERPROFILE || process.env.HOME;
const REPO = process.cwd();
const CHECK = process.argv.includes('--check');
const OPS  = join(HOME, 'momcal-ops');
const WBK  = join(HOME, 'work-backup');
const PROJ = join(HOME, '.claude', 'projects', 'C--Users-FAMILY-Desktop-MOMCALENDAR');
const MEM  = join(PROJ, 'memory');

const log = [];
const say = (icon, what, detail) => { log.push({ icon, what, detail }); };

// 백업 저장소가 아예 없으면 클론부터 (PC 교체 상황)
function ensureRepo(dir, url, name, sparse) {
  if (existsSync(join(dir, '.git'))) return true;
  if (CHECK) { say('🔴', name, '없음 — 복구 실행 시 clone 한다'); return false; }
  try {
    // work-backup 은 레포 전체+채팅기록이라 통째로 받으면 수 분 걸린다 → 필요한 폴더만 sparse 로.
    const args = ['clone', '--depth', '1', '--filter=blob:none'];
    if (sparse) args.push('--sparse');
    execFileSync('git', [...args, url, dir], { stdio: 'pipe', timeout: 600000 });
    if (sparse) execFileSync('git', ['-C', dir, 'sparse-checkout', 'set', ...sparse], { stdio: 'pipe', timeout: 300000 });
    say('🟢', name, 'clone 완료' + (sparse ? ' (필요한 폴더만)' : '')); return true;
  } catch (e) { say('🟡', name, 'clone 실패(핵심 아님): ' + String(e).slice(0, 80)); return false; }
}

// 없는 파일만 복사 (기존 파일은 절대 안 건드림)
function fillMissing(srcDir, dstDir, label) {
  if (!existsSync(srcDir)) { say('🔴', label, '백업 원본 없음: ' + srcDir); return; }
  if (!existsSync(dstDir)) { if (CHECK) { say('🔴', label, '대상 폴더 없음 → 통째 복구 대상'); } else mkdirSync(dstDir, { recursive: true }); }
  const src = readdirSync(srcDir).filter(f => statSync(join(srcDir, f)).isFile());
  const missing = src.filter(f => !existsSync(join(dstDir, f)));
  if (!missing.length) { say('✅', label, `${src.length}개 모두 정상`); return; }
  if (CHECK) { say('🔴', label, `${missing.length}개 없음: ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? ' …' : ''}`); return; }
  for (const f of missing) copyFileSync(join(srcDir, f), join(dstDir, f));
  say('🟢', label, `${missing.length}개 복구 (기존 ${src.length - missing.length}개는 그대로)`);
}

function fillFile(src, dst, label) {
  if (!existsSync(src)) { say('🔴', label, '백업 원본 없음'); return; }
  if (existsSync(dst)) { say('✅', label, '정상'); return; }
  if (CHECK) { say('🔴', label, '없음 → 복구 대상'); return; }
  mkdirSync(join(dst, '..'), { recursive: true });
  copyFileSync(src, dst);
  say('🟢', label, '복구 완료');
}

// 디스크 여유 확인 — 2026-09-01 에 C 여유 0GB 라 git clone 이 "No space left on device" 로 죽었다.
// 복구가 안 되는 이유가 스크립트 탓인지 디스크 탓인지 헷갈리지 않게 먼저 알려준다.
function diskFree() {
  try {
    const out = execFileSync('powershell', ['-NoProfile', '-Command',
      "(Get-PSDrive -Name C).Free"], { encoding: 'utf8', timeout: 30000 }).trim();
    const gb = Number(out) / 1024 ** 3;
    if (!isFinite(gb)) return;
    if (gb < 1)      say('🔴', 'C드라이브 여유', `${gb.toFixed(2)}GB — clone·백업이 실패한다. 공간부터 확보할 것`);
    else if (gb < 5) say('🟡', 'C드라이브 여유', `${gb.toFixed(1)}GB — 곧 부족해진다`);
    else             say('✅', 'C드라이브 여유', `${gb.toFixed(1)}GB`);
  } catch { /* 확인 실패는 무시 */ }
}
diskFree();

const okOps = ensureRepo(OPS, 'https://github.com/wonji2/momcal-ops.git', 'momcal-ops(운영자산 백업)');
const okWbk = ensureRepo(WBK, 'https://github.com/wonji2/work-backup.git', 'work-backup(설정 백업)', ['claude-config']);

if (okOps) {
  fillMissing(join(OPS, 'memory'), MEM, '메모리');
  fillMissing(join(OPS, 'claude-commands'), join(REPO, '.claude', 'commands'), '슬래시 커맨드');
  fillFile(join(OPS, 'HANDOFF.md'), join(REPO, 'HANDOFF.md'), 'HANDOFF.md');
  fillFile(join(OPS, 'CLAUDE-MOMCALENDAR.md'), join(REPO, 'CLAUDE.md'), 'CLAUDE.md');
  fillFile(join(OPS, 'CLAUDE-desktop.md'), join(HOME, 'Desktop', 'CLAUDE.md'), '상위 CLAUDE.md');
}
if (okWbk) fillFile(join(WBK, 'claude-config', 'settings.json'), join(HOME, '.claude', 'settings.json'), 'Claude 설정(세션종료 훅)');

// ── 파일 복구로는 절대 되살릴 수 없는 것들 (사람 손이 필요) ────────────────────
// 로그인 쿠키·앱이 관리하는 예약작업은 백업 대상이 아니다. 있는 척하면 그게 더 위험하므로 따로 알린다.
const manual = [];
{
  const cookies = join(REPO, 'sns-automation', 'browser-profile', 'Default', 'Network', 'Cookies');
  if (!existsSync(cookies)) manual.push('네이버 블로그 로그인 — `cd sns-automation && npm run naver-login` (창에서 "로그인 상태 유지" 켜고 로그인)');
  else {
    const days = (Date.now() - statSync(cookies).mtimeMs) / 86400e3;
    if (days > 25) manual.push(`네이버 로그인 쿠키가 ${Math.floor(days)}일 됨 (30일 만료) — npm run naver-login 으로 갱신 권장`);
  }
  try {
    const out = execFileSync('schtasks', ['/query', '/fo', 'csv'], { encoding: 'latin1' });
    const n = (out.match(/momcal-|work-backup/g) || []).length;
    if (n < 5) manual.push(`윈도우 예약작업이 ${n}개뿐 — 백업·크롤러가 죽었을 수 있다 (schtasks /query 로 확인)`);
  } catch { manual.push('schtasks 조회 실패 — 예약작업 생존 여부를 직접 확인할 것'); }
  // 윈도우 예약작업은 앱 재설치에는 살아남지만 PC 를 바꾸면 사라진다 → 레포에 저장해둔 정의(XML)로 자동 복구
  try {
    const ps = join(REPO, 'tools', 'daily', 'tasks_backup.ps1');
    if (existsSync(ps)) {
      const out = execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps, '-Restore'], { encoding: 'latin1', timeout: 120e3 });
      const made = (out.match(/새로 등록 (\d+)/) || [])[1];
      if (made && made !== '0') say('🟢', '예약작업', `${made}개 복구 (레포의 tasks/*.xml 에서)`);
      else say('✅', '예약작업', '전부 살아있음');
    }
  } catch (e) { manual.push('예약작업 복구 실패 — `powershell tools\\daily\\tasks_backup.ps1 -Restore` 를 직접 돌려볼 것'); }
  manual.push('인스타 파싱은 크롬 확장(claude-in-chrome) + 가계정 로그인이 필요 — 파싱 작업을 할 때만');
  // 🔴 browser-profile* 은 네이버 로그인 쿠키라 백업에서 제외된다(공개·비공개 모두). 새 PC 면 반드시 다시 로그인.
  const snsRoot = join(REPO, 'sns-automation');
  if (existsSync(snsRoot)) {
    if (!existsSync(join(snsRoot, 'browser-profile')))
      manual.push('네이버 블로그 로그인 필요 — sns-automation 에서 `npm run login` (주간 예약 발행용)');
    if (!existsSync(join(snsRoot, 'browser-profile-cafe')))
      manual.push('네이버 카페 로그인 필요 — `node src/cafe-browser.js login` (핫딜 카페 자동 발행용)');
  }
}

// 살아있는지 최종 확인
const memCount = existsSync(MEM) ? readdirSync(MEM).length : 0;
const cmdCount = existsSync(join(REPO, '.claude', 'commands')) ? readdirSync(join(REPO, '.claude', 'commands')).length : 0;

console.log(CHECK ? '=== 환경 진단 (고치지 않음) ===' : '=== 환경 자가복구 ===');
for (const l of log) console.log(`  ${l.icon} ${l.what.padEnd(24)} ${l.detail}`);
console.log(`\n  메모리 ${memCount}개 · 커맨드 ${cmdCount}개 · HANDOFF ${existsSync(join(REPO, 'HANDOFF.md')) ? 'O' : 'X'}`);
// 이어서 작업하려면 이 셋이 살아 있어야 한다. settings.json(훅)은 없어도 작업은 된다.
const core = memCount > 0 && cmdCount > 0 && existsSync(join(REPO, 'HANDOFF.md'));
const warn = log.filter(l => l.icon === '🟡').length;
if (manual.length) {
  console.log('\n  ⚠ 파일 복구로는 안 되는 것 (사람이 해야 함)');
  for (const m of manual) console.log(`    · ${m}`);
}
if (core) {
  console.log('\n✅ 이어서 작업 가능한 상태' + (warn ? ` (경고 ${warn}건 — 핵심 아님)` : ''));
} else {
  console.log(`\n🔴 이어서 작업 불가 — 메모리 ${memCount} · 커맨드 ${cmdCount} · HANDOFF ${existsSync(join(REPO, 'HANDOFF.md')) ? 'O' : 'X'}`);
  console.log('   레포 폴더까지 없다면: git clone https://github.com/wonji2/work-backup.git 후 그 안 MOMCALENDAR 를 Desktop 으로 복사');
}
process.exit(core ? 0 : 1);