/**
 * 🔒 파일 하나만 라이브로 올린다 — main 에 얹혀 나가지 않게 (사장님 지시 2026-10-14, 2번안)
 *
 *   import { pushOneFile } from './git_push_one.mjs';
 *   pushOneFile('daily/_alert.txt', '사장님 알림: 오류제보 3건');
 *   node tools/daily/git_push_one.mjs <레포상대경로> "<커밋 메시지>"      # 셸에서
 *
 * 🔴 왜 필요한가
 *   무인 작업들이 자기 파일 하나만 `git add` 해놓고 **`git push origin main`** 을 불렀다.
 *   add 는 하나지만 **push 는 main 전체**라, main 에 검토 중인 커밋이 있으면
 *   그 작업이 **지시 없이 그걸 라이브로 내보낸다.** 규칙 0-A("배포해 라고 하실 때만")가
 *   구조적으로 안 지켜지고 있었다.
 *   2026-10-14 실측: 08:54 커밋이 09:05 알림 회차에 실려 **검증 전에 배포됐다.**
 *
 * 🔑 어떻게 푸는가 — git 배관(plumbing)으로 **origin/main 위에 그 파일만 바꾼 커밋을 빚어** 민다.
 *     ① fetch → origin/main 의 트리를 임시 인덱스로 read-tree
 *     ② 그 파일 한 칸만 update-index  ③ write-tree  ④ commit-tree (부모 = origin/main)
 *     ⑤ push <그 커밋>:main
 *   → **작업트리도 로컬 main 도 건드리지 않는다.** 검토 중인 커밋은 절대 안 나간다.
 *     checkout·stash·rebase 가 없어 다른 세션이 파일을 고치는 중이어도 안전하다
 *     (2026-09-27 에 pull --rebase 가 거부돼 알림이 3일간 26회 전부 실패한 사고도 같이 사라진다).
 *
 * ⚠ 로컬 main 은 이 커밋만큼 뒤처진다 — 다음 pull --rebase 가 알아서 따라붙는다(파일 내용은 이미 같다).
 * ⚠ 남이 그 사이 main 을 밀면 push 가 거부된다(non-fast-forward). 한 번 다시 시도하고, 그래도 안 되면
 *    ok:false 로 돌려준다 — 호출부가 로그에 남겨야 한다. **조용히 성공했다고 하지 않는다.**
 * ⚠ 여러 파일을 한 번에 올려야 하면 files 에 배열로 준다. 그 밖의 것은 절대 안 나간다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export function pushOneFile(files, message, opts = {}) {
  const list = Array.isArray(files) ? files : [files];
  const repo = opts.repo || REPO;
  const branch = opts.branch || 'main';
  // 워크트리에선 .git 이 폴더가 아니라 파일이라 .git/ 밑에 못 쓴다(2026-10-15 실측: 'Unable to create .git/push_one_N.idx.lock') → 실제 git dir 을 묻는다
  const gitDir = execFileSync('git', ['rev-parse', '--absolute-git-dir'], { cwd: repo, encoding: 'utf8' }).trim();
  const idx = path.join(gitDir, `push_one_${process.pid}.idx`);
  const run = (args, env) => execFileSync('git', args, {
    cwd: repo, encoding: 'utf8', timeout: 120000, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...(env || {}) },
  }).trim();

  const attempt = () => {
    run(['fetch', '-q', 'origin', branch]);
    const base = run(['rev-parse', `origin/${branch}`]);

    // 올릴 게 정말 있는지 — origin 쪽 내용과 같으면 아무것도 안 한다
    let anyChange = false;
    for (const rel of list) {
      const abs = path.join(repo, rel);
      let remote = null;
      try { remote = run(['show', `${base}:${rel}`]); } catch { remote = null; }
      let local = null;
      try { local = fs.readFileSync(abs, 'utf8').replace(/\r\n/g, '\n').trim(); } catch { local = null; }
      const r = remote === null ? null : remote.replace(/\r\n/g, '\n').trim();
      if (r !== local) { anyChange = true; break; }
    }
    if (!anyChange) return { ok: true, skipped: '바뀐 것 없음' };

    try { fs.unlinkSync(idx); } catch {}
    const env = { GIT_INDEX_FILE: idx };
    run(['read-tree', base], env);
    for (const rel of list) {
      const abs = path.join(repo, rel);
      if (fs.existsSync(abs)) {
        const blob = run(['hash-object', '-w', '--', abs]);
        run(['update-index', '--add', '--cacheinfo', `100644,${blob},${rel}`], env);
      } else {
        try { run(['update-index', '--force-remove', rel], env); } catch {}   // 지워진 파일
      }
    }
    const tree = run(['write-tree'], env);
    const commit = run(['commit-tree', tree, '-p', base, '-m', message]);
    run(['push', '-q', 'origin', `${commit}:${branch}`]);
    return { ok: true, commit: commit.slice(0, 10) };
  };

  try {
    try {
      return attempt();
    } catch (e) {
      // 그 사이 남이 밀었으면 base 가 낡은 것이다 — 한 번만 다시 빚는다
      if (/non-fast-forward|fetch first|rejected/i.test(String(e.stderr || e.message))) return attempt();
      throw e;
    }
  } catch (e) {
    return { ok: false, error: String(e.stderr || e.message).slice(0, 200) };
  } finally {
    try { fs.unlinkSync(idx); } catch {}
  }
}

// 셸에서 직접:  node tools/daily/git_push_one.mjs <경로> "<메시지>" [<경로2> …]
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const args = process.argv.slice(2);
  const msg = args.find((a) => /\s/.test(a)) || '자동 갱신';
  const files = args.filter((a) => a !== msg);
  if (!files.length) { console.error('쓰는 법: node tools/daily/git_push_one.mjs <레포상대경로…> "<커밋 메시지>"'); process.exit(2); }
  const r = pushOneFile(files, msg);
  console.log(r.ok ? `✅ ${r.skipped || r.commit} — ${files.join(', ')}` : `🔴 올리기 실패: ${r.error}`);
  process.exit(r.ok ? 0 : 1);
}
