// 손님 화면이 깨지면 바로 되돌린다 — PC 와 상관없이 깃허브 Actions(live-watch.yml) 안에서 (사장님 2026-10-27 「경보만 띄우지 말고 바로바로 시정」)
//
// 언제 되돌리나 (셋 다 맞을 때만)
//   ① site_watch 마지막 두 회차가 연달아 실패
//   ② 마지막으로 통과한 회차의 커밋과 지금 main 의 index.html 이 다르다(= 그 사이 올린 코드가 원인일 수 있다)
//   ③ 같은 자리에서 다시 재 보니 「지금 index.html 은 실패 · 통과했던 판은 통과」
//      (서버 장애·망 문제면 옛 판도 실패한다 → 되돌리지 않는다)
// 무엇을 하나
//   index.html 만 통과했던 판으로 바꿔 커밋·푸시 → GitHub Pages 다시 빌드 요청
//   site_watch 에 auto_action 줄 + health_alerts 'watch:autofix'(관리자 홈 「고장 난 것」에 뜬다 — 원인은 대화 세션이 고쳐 다시 올린다)
// 하지 않는 것: test.html·다른 파일은 안 건드린다. 하루 3번 넘게 되돌리지 않는다(되돌림이 되돌림을 부르는 고리 방지).
// 실행: live-watch.yml 이 부른다(env SITE_WATCH_KEY · GH_TOKEN · GITHUB_REPOSITORY · GITHUB_SHA). 손으로: --dry 는 판정만.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';

const DRY = process.argv.includes('--dry');
const KEY = process.env.SITE_WATCH_KEY;
const REPO = process.env.GITHUB_REPOSITORY || 'wonji2/momcalendar';
const SB = 'https://hycaqsqeogjtbscmzrtm.supabase.co/rest/v1';
const H = { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' };
const log = (s) => console.log('[autofix] ' + s);

async function main() {
  if (!KEY) { log('키 없음 — 건너뜀'); return; }
  const rows = await fetch(`${SB}/site_watch?source=eq.ci&select=id,at,fail_n,live_hash,auto_action&order=at.desc&limit=40`, { headers: H }).then((r) => r.json());
  if (!Array.isArray(rows) || rows.length < 2) { log('기록 부족'); return; }
  if (!(rows[0].fail_n > 0 && rows[1].fail_n > 0)) { log('연속 실패 아님'); return; }
  const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  const doneToday = rows.filter((r) => r.auto_action && new Date(new Date(r.at).getTime() + 9 * 3600e3).toISOString().slice(0, 10) === today).length;
  if (doneToday >= 3) { log('오늘 이미 3번 되돌림 — 멈춤'); return; }
  // 통과했던 회차에 손님이 받은 index.html 의 지문(live_hash) → 최근 커밋 중 그 내용인 판을 찾는다
  //   (커밋 번호로 찾으면 Pages 가 아직 옛 판을 내주던 회차를 새 판으로 착각한다)
  const good = rows.find((r) => r.fail_n === 0 && r.live_hash);
  if (!good) { log('통과했던 회차 기록 없음'); return; }
  if (rows[0].live_hash === good.live_hash) { log('실패 회차도 통과했던 판과 같은 index.html — 코드 탓 아님(서버·데이터 쪽), 되돌리지 않음'); return; }
  const crypto = await import('node:crypto');
  const hashOf = (t) => crypto.createHash('sha1').update(t).digest('hex').slice(0, 12);
  const gh = { Accept: 'application/vnd.github+json', ...(process.env.GH_TOKEN ? { Authorization: 'token ' + process.env.GH_TOKEN } : {}) };
  const commits = await fetch(`https://api.github.com/repos/${REPO}/commits?path=index.html&per_page=30`, { headers: gh }).then((r) => r.json()).catch(() => []);
  let oldHtml = null, oldSha = null;
  for (const c of Array.isArray(commits) ? commits : []) {
    const t = await fetch(`https://raw.githubusercontent.com/${REPO}/${c.sha}/index.html`).then((r) => (r.ok ? r.text() : null)).catch(() => null);
    if (t && hashOf(t) === good.live_hash) { oldHtml = t; oldSha = c.sha; break; }
  }
  const curHtml = fs.readFileSync('index.html', 'utf8');
  if (!oldHtml || !oldHtml.startsWith('<!DOCTYPE html>')) { log('통과했던 판을 최근 30커밋에서 못 찾음'); return; }
  if (oldHtml === curHtml) { log('지금 index.html 이 통과했던 판과 같다 — 되돌릴 것 없음'); return; }
  good.commit_sha = oldSha;

  // ③ 같은 자리에서 두 판을 다시 잰다
  fs.mkdirSync('/tmp/oldsite', { recursive: true });
  fs.writeFileSync('/tmp/oldsite/index.html', oldHtml);
  fs.writeFileSync('/tmp/oldsite/test.html', fs.readFileSync('test.html', 'utf8'));
  const run = (args) => spawnSync(process.execPath, ['tools/daily/live_smoke.mjs', ...args], { encoding: 'utf8', timeout: 12 * 60e3 });
  const nowRun = run(process.env.AUTOFIX_TEST_NOW ? ['--local=' + process.env.AUTOFIX_TEST_NOW] : ['--dry']);   // 시험용: 깨진 판을 「지금」 으로 흉내
  const oldRun = run(['--local=/tmp/oldsite']);
  const fails = (r) => { const m = (r.stdout || '').match(/실패 (\d+)/g); return m ? +m[m.length - 1].replace(/\D/g, '') : 99; };
  const fNow = fails(nowRun), fOld = fails(oldRun);
  log(`다시 잼: 지금 실패 ${fNow} · 통과했던 판(${good.commit_sha.slice(0, 10)}) 실패 ${fOld}`);
  if (!(fNow > 0 && fOld === 0)) { log('옛 판도 실패하거나 지금 판이 통과 — 되돌리지 않음'); return; }
  if (DRY) { log('--dry: 되돌릴 판정만'); return; }

  fs.writeFileSync('index.html', oldHtml);
  const g = (...a) => execFileSync('git', a, { encoding: 'utf8' });
  g('config', 'user.name', 'momcal-autofix'); g('config', 'user.email', 'autofix@momcalendar.com');
  g('add', 'index.html');
  g('commit', '-m', `자동 되돌림: 손님 화면 검사 2회 연속 실패 · 통과했던 판(${good.commit_sha.slice(0, 10)})의 index.html 로 (live-watch)`);
  let pushed = false;
  for (let i = 0; i < 3 && !pushed; i++) {
    try { g('push', 'origin', 'HEAD:main'); pushed = true; } catch { try { g('pull', '--rebase', 'origin', 'main'); } catch { break; } }
  }
  if (!pushed) { log('푸시 실패'); return; }
  const sha = g('rev-parse', 'HEAD').trim();
  if (process.env.GH_TOKEN) await fetch(`https://api.github.com/repos/${REPO}/pages/builds`, { method: 'POST', headers: { Authorization: 'token ' + process.env.GH_TOKEN, Accept: 'application/vnd.github+json' } }).catch(() => {});
  const msg = `자동 되돌림 ${today}: 손님 화면 검사 2회 연속 실패(${fNow}건) → index.html 을 통과했던 판 ${good.commit_sha.slice(0, 10)} 로(커밋 ${sha.slice(0, 10)}). 원인 코드는 대화 세션이 고쳐 다시 올린다`;
  await fetch(`${SB}/site_watch?id=eq.${rows[0].id}`, { method: 'PATCH', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify({ auto_action: msg }) });
  await fetch(`${SB}/health_alerts`, { method: 'POST', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify({ kind: 'watch:autofix', detail: msg }) });
  log(msg);
}
await main();
