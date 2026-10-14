// 사장님께 보일 알림 한 줄씩 — 오늘 카드 페이지(daily/today.html) 맨 위에 뜬다
//
// 왜 공용으로 뺐나 (2026-09-22)
//   처음엔 threads_learn_guard.mjs 가 daily/_alert.txt 를 통째로 덮어썼다.
//   알림을 내는 도구가 둘이 되는 순간 **서로 지운다** — 스레드 경고가 뜨면 당첨자 알림이 사라진다.
//   그래서 파일을 「키|문구」 줄 목록으로 바꾸고, 도구는 **자기 키 줄만** 건드린다.
//
//   import { setAlert, clearAlert, readAlerts } from './alert.mjs';
//   setAlert('winner', '8월 출석 당첨자 3명 — 아직 안 보냈어요');   // 있으면 갱신, 없으면 추가
//   clearAlert('winner');                                          // 그 줄만 지운다
//
// 파일  daily/_alert.txt   (한 줄 = 키|문구). 비면 파일을 지운다.
// 읽는 쪽  tools/daily/make-today-card.mjs 가 매일 아침 읽어 페이지 맨 위에 그린다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FILE = path.join(REPO, 'daily', '_alert.txt');

export function readAlerts() {
  try {
    return fs.readFileSync(FILE, 'utf8').split(/\r?\n/)
      .map((l) => l.trim()).filter(Boolean)
      .map((l) => { const i = l.indexOf('|'); return i < 0 ? { key: '', text: l } : { key: l.slice(0, i), text: l.slice(i + 1) }; });
  } catch { return []; }
}

function write(list) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  if (!list.length) { try { fs.unlinkSync(FILE); } catch {} return; }
  fs.writeFileSync(FILE, list.map((a) => `${a.key}|${a.text}`).join('\n') + '\n', 'utf8');
}

export function setAlert(key, text) {
  const list = readAlerts().filter((a) => a.key !== key);
  list.push({ key, text: String(text).replace(/[\r\n|]+/g, ' ').trim() });
  write(list);
}

export function clearAlert(key) {
  write(readAlerts().filter((a) => a.key !== key));
}

// 🔴 알림을 레포에 올린다 — 안 올리면 **사장님 화면에 영영 안 뜬다** (2026-09-22 실측)
//   오늘 카드 페이지(daily/today.html)는 **GitHub Actions** 가 매일 07:40 에 만든다.
//   Actions 러너는 이 PC 파일을 못 본다 → daily/_alert.txt 가 레포에 있어야 읽힌다.
//   daily/ 는 원래 봇이 매일 커밋하는 폴더라 여기에 한 줄 더 얹는 것뿐이다.
//   ⚠ 커밋 경로를 daily/_alert.txt 하나로 못박는다 — 이 레포는 공개 사이트라 add -A 를 쓰지 않는다.
// 🔴🔴 알림은 **자기 파일 하나만** 올린다 — main 에 얹혀 가지 않는다 (사장님 지시 2026-10-14, 2번안)
//
//   사고: 전에는 `add daily/_alert.txt` → `commit` → **`push origin main`** 이었다.
//   add 는 알림 파일 하나지만 **push 는 main 전체**라, main 에 검토 중인 커밋이 있으면
//   다음 알림 회차(수시로 돈다)가 **지시 없이 그걸 라이브로 내보낸다.**
//   2026-10-14 실측: 08:54 커밋이 09:05 알림 회차에 실려 **검증 전에 배포됐다.**
//   규칙 0-A("배포해 라고 하실 때만")가 구조적으로 안 지켜지고 있었다.
//
//   그래서 git 배관(plumbing)으로 **origin/main 위에 알림 커밋을 따로 빚어 그것만** 민다.
//     ① origin/main 의 트리를 임시 인덱스로 읽고  ② 알림 파일 한 칸만 바꿔  ③ write-tree
//     ④ commit-tree 로 origin/main 을 부모로 커밋  ⑤ push <그 커밋>:main
//   → **작업트리·로컬 main 을 건드리지 않는다.** 검토 중인 커밋은 절대 안 나간다.
//     checkout·stash·rebase 가 없어 다른 세션이 파일을 고치고 있어도 안전하다
//     (2026-09-27 에 pull --rebase 가 거부돼 알림이 3일간 26회 전부 실패한 사고도 같이 사라진다).
//   ⚠ 로컬 main 은 이 커밋만큼 뒤처진다. 다음 pull --rebase 가 알아서 따라붙는다(파일 내용은 이미 같다).
export function pushAlerts(note = '알림 갱신') {
  const run = (args, env) => execFileSync('git', args, {
    cwd: REPO, encoding: 'utf8', timeout: 120000, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...(env || {}) },
  }).trim();
  const IDX = path.join(REPO, '.git', 'alert_index.tmp');
  try {
    run(['fetch', '-q', 'origin', 'main']);
    const base = run(['rev-parse', 'origin/main']);
    // origin/main 에 들어 있는 알림 파일과 지금 파일이 같으면 할 일이 없다
    let remote = null;
    try { remote = run(['show', `${base}:daily/_alert.txt`]); } catch { remote = null; }
    let local = null;
    try { local = fs.readFileSync(FILE, 'utf8').trim(); } catch { local = null; }
    if ((remote === null ? '' : remote.trim()) === (local === null ? '' : local)) return { ok: true, skipped: '바뀐 것 없음' };

    try { fs.unlinkSync(IDX); } catch {}
    const env = { GIT_INDEX_FILE: IDX };
    run(['read-tree', base], env);
    if (local === null) {
      run(['update-index', '--force-remove', 'daily/_alert.txt'], env);   // 알림이 다 지워져 파일이 없다
    } else {
      const blob = run(['hash-object', '-w', '--', FILE]);
      run(['update-index', '--add', '--cacheinfo', `100644,${blob},daily/_alert.txt`], env);
    }
    const tree = run(['write-tree'], env);
    const commit = run(['commit-tree', tree, '-p', base, '-m', `사장님 알림: ${note}`]);
    run(['push', '-q', 'origin', `${commit}:main`]);
    return { ok: true, commit: commit.slice(0, 10) };
  } catch (e) {
    return { ok: false, error: String(e.stderr || e.message).slice(0, 160) };
  } finally {
    try { fs.unlinkSync(IDX); } catch {}
  }
}
