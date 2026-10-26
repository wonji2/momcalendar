// 앱 밤샘 자동 점검 결과를 사장님 알림줄에 올린다 (2026-10-26 사장님 「앱 버그 스스로 검증」)
//
//   GitHub Actions 가 매일 밤 두 가지를 돈다(공개 저장소라 비용 없음):
//     · 안드로이드 앱 빌드 (웹뷰)  .github/workflows/android-cap-build.yml  KST 03:40 — 에뮬레이터에 실제 앱을 깔고
//       라이브 사이트로 바깥 링크·선택창·뒤로가기·카카오 로그인·공유·파일 저장·위젯·앱 링크·첫 실행 권한 안내를 본다(android-app/cap/e2e/run.mjs)
//     · 아이폰 앱 시뮬레이터 점검  .github/workflows/ios-sim-check.yml       KST 04:10 — 켜짐·사이트 화면·강제 종료 기록
//   이 스크립트는 그 두 실행의 가장 최근 결과를 읽어, 실패면 알림줄(daily/_alert.txt 키 app_e2e)에 올리고 통과면 지운다.
//
//   실행: node tools/daily/app_e2e_watch.mjs          (예약작업 momcal-app-e2e-watch, 매일 05:30)
//   토큰: git credential(github.com) — 저장소 읽기만 한다
//   상태: scratchpad/app_e2e_watch.json (마지막으로 본 실행 번호)
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setAlert, clearAlert, pushAlerts } from './alert.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const STATE = path.join(REPO, 'scratchpad', 'app_e2e_watch.json');
const token = execFileSync('git', ['credential', 'fill'], { input: 'protocol=https\nhost=github.com\n\n', encoding: 'utf8' })
  .split('\n').find((l) => l.startsWith('password='))?.slice(9);
const API = 'https://api.github.com/repos/wonji2/momcalendar/actions';
const get = async (p) => (await fetch(API + p, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' } })).json();

const FLOWS = [['android-cap-build.yml', '안드로이드 앱'], ['ios-sim-check.yml', '아이폰 앱']];
const bad = [];
const seen = {};
for (const [file, label] of FLOWS) {
  const j = await get(`/workflows/${file}/runs?per_page=5&status=completed`);
  const run = (j.workflow_runs || [])[0];
  if (!run) continue;
  seen[file] = { id: run.id, n: run.run_number, c: run.conclusion, at: run.updated_at };
  const ageH = (Date.now() - new Date(run.updated_at)) / 36e5;
  if (run.conclusion !== 'success') bad.push(`${label} 점검 실패(${run.run_number}번, ${run.html_url})`);
  else if (ageH > 36) bad.push(`${label} 점검이 ${Math.round(ageH)}시간째 안 돌았다`);
}
fs.writeFileSync(STATE, JSON.stringify({ at: new Date().toISOString(), seen, bad }, null, 2));
if (bad.length) setAlert('app_e2e', '🔴 ' + bad.join(' / '));
else clearAlert('app_e2e');
try { pushAlerts('사장님 알림: 앱 밤샘 점검'); } catch (e) { console.log('알림 올리기 실패', e.message); }
console.log(bad.length ? bad.join('\n') : '앱 밤샘 점검 통과', JSON.stringify(seen));
