// 손님 화면이 깨지면 바로 되돌린다 — PC 와 상관없이 깃허브 Actions(live-watch.yml) 안에서 (사장님 2026-10-27 「경보만 띄우지 말고 바로바로 시정」)
//
// 되돌리는 조건 (전부 맞을 때만 — 2026-10-27 독립 검증 불통과 4건 반영판)
//   ① site_watch 마지막 두 회차가 같은 index.html(live_hash 같음)로 연달아 실패
//   ② 지금 받아 온 checkout 의 index.html 이 그 실패한 판과 같다(Pages 반영 지연 중에 새 판을 덮지 않게)
//   ③ 마지막으로 통과한 회차의 판을 최근 커밋에서 찾는다(받은 HTML 지문 live_hash 로 — 커밋 번호는 Pages 지연 때 어긋난다)
//   ④ 두 판을 **같은 조건**(둘 다 --local, 같은 시각대)에서 번갈아 두 번씩 잰다: 지금·옛·지금·옛
//      지금 판은 두 번 다 「심각한 고장」 ≥1, 옛 판은 두 번 다 결과 줄이 있고 심각한 고장 0
//      심각한 고장 = 손님이 못 쓰는 것: 공구 목록·페이지 오류·검색·핫딜/세일 탭·검색창·옆 메뉴
//      (카카오 로그인 이동·찜 서버·서버 4xx 등은 기대값이 바뀌거나 서버 쪽 문제일 수 있어 되돌림 이유로 쓰지 않는다)
//   ⑤ 오늘(한국 시간) 자동 되돌림이 3번 미만 — DB 에서 날짜로 센다
// 하는 것: 기록을 먼저 남기고(실패하면 멈춤) → index.html 만 통과 판으로 커밋 → **rebase 없이** 푸시
//          (그 사이 누가 올렸으면 푸시가 거절된다 → 섞인 판을 만들지 않고 멈추고 기록만)
// 결과: site_watch.auto_action + health_alerts 'watch:autofix'(관리자 홈 「고장 난 것」)
// 실행: live-watch.yml 이 부른다(env SITE_WATCH_KEY · GITHUB_REPOSITORY). --dry 는 판정만. AUTOFIX_TEST_NOW=<폴더> 는 「지금」 판을 그 폴더 것으로(시험용)
import fs from 'node:fs';
import crypto from 'node:crypto';
import { spawnSync, execFileSync } from 'node:child_process';

const DRY = process.argv.includes('--dry');
const KEY = process.env.SITE_WATCH_KEY;
const REPO = process.env.GITHUB_REPOSITORY || 'wonji2/momcalendar';
const SB = 'https://hycaqsqeogjtbscmzrtm.supabase.co/rest/v1';
const H = { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' };
const CRIT = ['공구 목록', '페이지 오류 없음', '검색 「파스퇴르」', '핫딜 탭', '세일 탭', '검색창', '옆 메뉴'];
const log = (s) => console.log('[autofix] ' + s);
const hashOf = (t) => crypto.createHash('sha1').update(t).digest('hex').slice(0, 12);
const alert = (detail) => fetch(`${SB}/health_alerts`, { method: 'POST', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify({ kind: 'watch:autofix', detail }) }).catch(() => {});

async function main() {
  if (!KEY) { log('키 없음 — 건너뜀'); return; }
  const rows = await fetch(`${SB}/site_watch?source=eq.ci&select=id,at,fail_n,live_hash&order=at.desc&limit=200`, { headers: H }).then((r) => r.json());
  if (!Array.isArray(rows) || rows.length < 2) { log('기록 부족'); return; }
  const [r0, r1] = rows;
  if (!(r0.fail_n > 0 && r1.fail_n > 0)) { log('연속 실패 아님'); return; }
  if (!r0.live_hash || r0.live_hash !== r1.live_hash) { log('두 실패 회차의 index.html 이 다르거나 모름 — 되돌리지 않음'); return; }

  // ⑤ 오늘 되돌림 횟수(한국 시간 0시부터, DB 에서)
  const kstMidnightUtc = new Date(new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10) + 'T00:00:00+09:00').toISOString();
  const done = await fetch(`${SB}/site_watch?select=id&auto_action=not.is.null&at=gte.${encodeURIComponent(kstMidnightUtc)}`, { headers: H }).then((r) => r.json()).catch(() => null);
  if (!Array.isArray(done)) { log('오늘 되돌림 횟수를 못 셈 — 멈춤'); return; }
  if (done.length >= 3) { log('오늘 이미 3번 되돌림 — 멈춤'); return; }

  // ② checkout 이 실패한 그 판인가
  const curHtml = fs.readFileSync('index.html', 'utf8');
  if (hashOf(curHtml) !== r0.live_hash) { log('지금 받은 index.html 이 실패한 판과 다름(새 판이 반영 중일 수 있음) — 되돌리지 않음'); return; }

  // ③ 통과했던 판 찾기
  const good = rows.find((r) => r.fail_n === 0 && r.live_hash && r.live_hash !== r0.live_hash);
  if (!good) { log('통과했던 다른 판 기록 없음'); return; }
  const gh = { Accept: 'application/vnd.github+json', ...(process.env.GH_TOKEN ? { Authorization: 'token ' + process.env.GH_TOKEN } : {}) };
  const commits = await fetch(`https://api.github.com/repos/${REPO}/commits?path=index.html&per_page=30`, { headers: gh }).then((r) => r.json()).catch(() => []);
  let oldHtml = null, oldSha = null;
  for (const c of Array.isArray(commits) ? commits : []) {
    const t = await fetch(`https://raw.githubusercontent.com/${REPO}/${c.sha}/index.html`).then((r) => (r.ok ? r.text() : null)).catch(() => null);
    if (t && hashOf(t) === good.live_hash) { oldHtml = t; oldSha = c.sha; break; }
  }
  if (!oldHtml || !oldHtml.startsWith('<!DOCTYPE html>')) { log('통과했던 판을 최근 30커밋에서 못 찾음'); return; }

  // ④ 같은 조건으로 번갈아 두 번씩
  const testCur = process.env.AUTOFIX_TEST_NOW;
  fs.mkdirSync('/tmp/cursite', { recursive: true }); fs.mkdirSync('/tmp/oldsite', { recursive: true });
  if (!testCur) fs.writeFileSync('/tmp/cursite/index.html', curHtml);
  fs.writeFileSync('/tmp/oldsite/index.html', oldHtml);
  for (const d of ['/tmp/cursite', '/tmp/oldsite']) if (!fs.existsSync(d + '/test.html')) fs.copyFileSync('test.html', d + '/test.html');
  const measure = (dir) => {
    const r = spawnSync(process.execPath, ['tools/daily/live_smoke.mjs', '--local=' + dir], { encoding: 'utf8', timeout: 12 * 60e3 });
    const out = r.stdout || '';
    if (!/결과: 통과 \d+ · 실패 \d+/.test(out)) return null;   // 결과 줄이 없으면 모름
    return out.split('\n').filter((l) => l.includes('🔴') && CRIT.some((c) => l.includes('] ' + c))).length;
  };
  const cur = testCur || '/tmp/cursite';
  const m = [measure(cur), measure('/tmp/oldsite'), measure(cur), measure('/tmp/oldsite')];
  log(`같은 조건 재측정(심각한 고장 수): 지금 ${m[0]}·${m[2]} · 통과했던 판(${oldSha.slice(0, 10)}) ${m[1]}·${m[3]}`);
  if (!(m[0] > 0 && m[2] > 0 && m[1] === 0 && m[3] === 0)) { log('되돌릴 조건 아님(옛 판도 고장·지금 판 심각한 고장 없음·모름)'); return; }
  if (DRY) { log('--dry: 되돌릴 판정만'); return; }

  // 기록 먼저 — 못 남기면 되돌리지 않는다(상한이 새지 않게)
  const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  const msg = `자동 되돌림 ${today}: 손님 화면 심각한 고장(${m[0]}건) 2회 연속 → index.html 을 통과했던 판 ${oldSha.slice(0, 10)} 로. 원인 코드는 고쳐서 다시 올릴 것`;
  const pr = await fetch(`${SB}/site_watch?id=eq.${r0.id}`, { method: 'PATCH', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify({ auto_action: msg }) }).catch(() => null);
  if (!pr || !pr.ok) { log('기록 실패 — 되돌리지 않음'); return; }

  fs.writeFileSync('index.html', oldHtml);
  const g = (...a) => execFileSync('git', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    g('config', 'user.name', 'momcal-autofix'); g('config', 'user.email', 'autofix@momcalendar.com');
    g('add', 'index.html');
    g('commit', '-m', `자동 되돌림: 손님 화면 심각한 고장 2회 연속 · 통과했던 판(${oldSha.slice(0, 10)})의 index.html 로 (live-watch)`);
    g('push', 'origin', 'HEAD:main');   // rebase 하지 않는다 — 그 사이 누가 올렸으면 거절되고 멈춘다(섞인 판 방지)
  } catch (e) {
    const why = `자동 되돌림 시도했으나 멈춤 ${today}: 그 사이 새 커밋이 올라왔거나 푸시 실패(${String(e.message).slice(0, 80)}) — 지금 라이브 확인 필요`;
    await fetch(`${SB}/site_watch?id=eq.${r0.id}`, { method: 'PATCH', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify({ auto_action: why }) }).catch(() => {});
    await alert(why); log(why); return;
  }
  await alert(msg + ` (커밋 ${g('rev-parse', 'HEAD').trim().slice(0, 10)})`);
  log(msg);
}
await main();
