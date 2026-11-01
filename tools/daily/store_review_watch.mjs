// 앱 심사 감시기 — 애플(App Store Connect API)·구글(플레이스토어 공개 페이지) 상태가 바뀌면 사장님 알림 줄에 띄운다
//   (사장님 2026-10-25 "애플에서 그 테스트를 하라고 메일을 별도로 주는 거야? 네가 계속 확인해봐")
//   애플 메일은 계정 주인 momcal@kakao.com 으로만 오고 지메일엔 안 온다 → 메일 대신 API 로 직접 본다.
//
// 보는 것
//   · 애플 앱 1.0 심사 상태(appStoreState) — REJECTED / WAITING_FOR_REVIEW / IN_REVIEW / READY_FOR_SALE …
//   · 애플 심사 제출(reviewSubmissions) 상태 — UNRESOLVED_ISSUES(회신 기다림) 등
//   · 테스트플라이트 베타 심사 — APPROVED 가 되면 가족 폰 공개 링크가 열린 것(심사 녹화 시작 신호)
//   · 구글 플레이 공개 페이지 — 404 → 200 이면 갤럭시 앱 공개
// 실행: node tools/daily/store_review_watch.mjs   (윈도우 예약작업 momcal-store-review-watch, 30분)
// 상태 파일: scratchpad/store_review_state.json   알림 키: store_review (tools/daily/alert.mjs)
// 키: work-backup/secrets/apple/ 의 ASC API 키(.p8)·ASC_API_KEY.txt (비공개 — 레포에 없다)
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setAlert, pushAlerts } from './alert.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const STATE = path.join(REPO, 'scratchpad', 'store_review_state.json');
const LOG = path.join(REPO, 'scratchpad', 'store_review_watch.log');
const SECRETS = 'C:/Users/FAMILY/work-backup/secrets/apple';
const APP = '6826126083';
const say = (s) => { const line = new Date().toISOString().slice(0, 16) + ' ' + s; console.log(line); try { fs.appendFileSync(LOG, line + '\n'); } catch {} };

function apple() {
  const env = { ...process.env, APPLE_API_KEY_PATH: SECRETS + '/AuthKey_NP354BPW6U.p8' };
  for (const l of fs.readFileSync(SECRETS + '/ASC_API_KEY.txt', 'utf8').split(/\r?\n/)) { const m = l.match(/^(APPLE_API_\w+)=(.+)$/); if (m) env[m[1]] = m[2].trim(); }
  const py = `
import sys, json; sys.path.insert(0, r'${path.join(REPO, 'ios-app', 'ci').replace(/\\/g, '/')}')
import asc
o = {}
v = asc.call('GET', '/apps/${APP}/appStoreVersions?limit=1')['data']
o['version'] = (v[0]['attributes']['versionString'] + ' ' + v[0]['attributes']['appStoreState']) if v else ''
s = sorted(asc.call('GET', '/reviewSubmissions?filter[app]=${APP}&limit=20')['data'], key=lambda x: x['attributes'].get('submittedDate') or '', reverse=True)
o['submission'] = s[0]['attributes'].get('state') if s else ''
b = asc.call('GET', '/builds?filter[app]=${APP}&sort=-uploadedDate&limit=3')['data']
r = asc.call('GET', '/betaAppReviewSubmissions?filter[build]=' + ','.join(x['id'] for x in b) + '&limit=5')['data'] if b else []
o['beta'] = ','.join(sorted(set(x['attributes'].get('betaReviewState') or '' for x in r)))
print(json.dumps(o))
`;
  return JSON.parse(execFileSync('python', ['-c', py], { env, encoding: 'utf8', timeout: 90000 }).trim().split('\n').pop());
}

async function play() {
  try { const r = await fetch('https://play.google.com/store/apps/details?id=com.wantsb.momcalendar&hl=ko', { redirect: 'follow' }); return r.status === 200 ? '공개' : '미공개(' + r.status + ')'; }
  catch (e) { return '확인 실패'; }
}

const KO = { REJECTED: '반려', WAITING_FOR_REVIEW: '심사 대기', IN_REVIEW: '심사 중', PENDING_DEVELOPER_RELEASE: '승인(출시 버튼 대기)',
  READY_FOR_SALE: '앱스토어 공개', PREPARE_FOR_SUBMISSION: '제출 준비', UNRESOLVED_ISSUES: '회신 기다림', COMPLETE: '완료',
  APPROVED: '승인', WAITING_FOR_REVIEW_BETA: '베타 심사 대기' };
const ko = (s) => String(s || '').split(/[ ,]/).map((w) => KO[w] || w).join(' ');

const prev = (() => { try { return JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch { return {}; } })();
const now = {};
try { Object.assign(now, apple()); } catch (e) { say('🔴 애플 조회 실패 ' + String(e.message || e).slice(0, 160)); }
now.play = await play();

const changes = [];
if (now.version && now.version !== prev.version) changes.push('아이폰 앱 ' + ko(now.version));
if (now.submission && now.submission !== prev.submission) changes.push('애플 심사 ' + ko(now.submission));
if (now.beta && now.beta !== prev.beta) changes.push(/APPROVED/.test(now.beta) ? '테스트플라이트 링크 열림 → 가족 아이폰 녹화 시작 가능' : '테스트플라이트 ' + ko(now.beta));
if (now.play && now.play !== prev.play && !/실패/.test(now.play)) changes.push('갤럭시 앱 ' + now.play);
say('상태 ' + JSON.stringify(now) + (changes.length ? ' · 바뀜: ' + changes.join(' / ') : ''));

if (changes.length && Object.keys(prev).length) {   // 첫 회차는 기준만 잡고 알리지 않는다
  setAlert('store_review', '📱 앱 심사: ' + changes.join(' · ') + ' (' + new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }).slice(0, -3) + ')');
  try { const r = pushAlerts('사장님 알림: 앱 심사 상태'); say('알림 올림 ' + JSON.stringify(r).slice(0, 80)); } catch (e) { say('알림 올리기 실패 ' + String(e).slice(0, 120)); }
}
fs.writeFileSync(STATE, JSON.stringify({ ...prev, ...now, checked: new Date().toISOString() }, null, 1));
