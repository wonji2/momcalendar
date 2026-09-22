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
export function pushAlerts(note = '알림 갱신') {
  const run = (args) => execFileSync('git', args, { cwd: REPO, encoding: 'utf8', timeout: 120000, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    const changed = run(['status', '--porcelain', '--', 'daily/_alert.txt']).trim();
    if (!changed) return { ok: true, skipped: '바뀐 것 없음' };
    run(['add', 'daily/_alert.txt']);
    run(['commit', '-m', `사장님 알림: ${note}`]);
    try { run(['pull', '--rebase', '-q']); } catch { /* 충돌이면 그냥 push 를 시도한다 */ }
    run(['push', '-q', 'origin', 'main']);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e.stderr || e.message).slice(0, 160) };
  }
}
