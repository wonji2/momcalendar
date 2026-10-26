// 에뮬레이터 자동 시험 — 깔린 앱을 실제로 켜고, 사이트에서 되던 것이 앱에서도 되는지 하나씩 본다 (2026-10-26)
//   node e2e/run.mjs <apk>     (CI: android-cap-build.yml e2e 잡, adb 가 연결된 에뮬레이터)
//   방법: adb 로 앱 실행 → 웹뷰 원격 디버깅 소켓(webview_devtools_remote_<pid>)에 붙어 화면 속 자바스크립트를 부른다
//         → 그 뒤 맨 앞 화면(mResumedActivity)이 무엇인지 본다. 「선택창」= ResolverActivity/ChooserActivity(공유 시트 제외)
//   결과: e2e-out/report.md · 스크린샷 e2e-out/*.png · 실패가 하나라도 있으면 exit 1
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const APK = process.argv[2];
const PKG = 'com.wantsb.momcalendar';
const OUT = 'e2e-out';
fs.mkdirSync(OUT, { recursive: true });
const sh = (...a) => { try { return execFileSync('adb', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { return String(e.stdout || '') + String(e.stderr || ''); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rows = [];
let fails = 0;
const rec = (name, ok, note) => { rows.push(`| ${ok ? '✅' : '❌'} | ${name} | ${String(note || '').replace(/\|/g, '/').replace(/\n/g, ' ').slice(0, 300)} |`); if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', name, note || ''); };
const shot = (n) => { try { const b = execFileSync('adb', ['exec-out', 'screencap', '-p']); fs.writeFileSync(`${OUT}/${n}.png`, b); } catch (_) {} };
const top = () => { const s = sh('shell', 'dumpsys', 'activity', 'activities'); const m = s.match(/mResumedActivity[^\n]*\{[^\n]*\s([\w.]+\/[\w.$]+)/) || s.match(/topResumedActivity[^\n]*\{[^\n]*\s([\w.]+\/[\w.$]+)/); return m ? m[1] : '?'; };
const isChooser = (a) => /ResolverActivity|IntentResolver|ChooserActivity/.test(a);

async function cdp() {
  let sock = '';
  for (let i = 0; i < 40 && !sock; i++) {
    const pid = sh('shell', 'pidof', PKG).trim();
    const u = sh('shell', 'cat', '/proc/net/unix');
    const m = u.match(new RegExp('@(webview_devtools_remote_' + (pid || '\\d+') + ')'));
    if (m) sock = m[1];
    else await sleep(1000);
  }
  if (!sock) throw new Error('웹뷰 디버깅 소켓 없음');
  sh('forward', 'tcp:9333', 'localabstract:' + sock);
  let pages = [];
  for (let i = 0; i < 30; i++) {
    try { pages = await (await fetch('http://127.0.0.1:9333/json')).json(); } catch (_) {}
    if (pages.find((p) => p.type === 'page' && /momcalendar\.com/.test(p.url))) break;
    await sleep(1000);
  }
  const pg = pages.find((p) => p.type === 'page' && /momcalendar\.com/.test(p.url)) || pages.find((p) => p.type === 'page');
  if (!pg) throw new Error('웹뷰 페이지 없음');
  const ws = new WebSocket(pg.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const wait = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && wait.has(m.id)) { wait.get(m.id)(m); wait.delete(m.id); } };
  const send = (method, params = {}) => new Promise((r) => { const k = ++id; wait.set(k, r); ws.send(JSON.stringify({ id: k, method, params })); });
  const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true }); return r.result && r.result.result ? r.result.result.value : (r.result && r.result.exceptionDetails ? 'ERR ' + JSON.stringify(r.result.exceptionDetails).slice(0, 200) : undefined); };
  return { ev, close: () => ws.close() };
}

async function back() { sh('shell', 'input', 'keyevent', 'KEYCODE_BACK'); await sleep(1500); }
async function home() { sh('shell', 'am', 'force-stop', 'com.android.chrome'); await sleep(500); }
async function launch() {
  sh('shell', 'am', 'force-stop', PKG);
  sh('shell', 'monkey', '-p', PKG, '-c', 'android.intent.category.LAUNCHER', '1');
  await sleep(9000);
}

(async () => {
  console.log(sh('install', '-r', APK));
  // 크롬 첫 실행 화면이 Custom Tab 앞을 막지 않게
  sh('shell', 'am', 'set-debug-app', '--persistent', 'com.android.chrome');
  sh('shell', 'sh', '-c', 'echo "chrome --disable-fre --no-default-browser-check --no-first-run" > /data/local/tmp/chrome-command-line');
  await launch();
  shot('01_home');
  let c;
  try { c = await cdp(); rec('앱이 켜지고 사이트가 뜬다', true, ''); } catch (e) { rec('앱이 켜지고 사이트가 뜬다', false, e.message + ' top=' + top()); return finish(); }
  const env = await c.ev(`JSON.stringify({u:location.href, ua:navigator.userAgent, plat:(window.Capacitor&&Capacitor.getPlatform&&Capacitor.getPlatform()), plug:!!(window.Capacitor&&Capacitor.Plugins&&Capacitor.Plugins.MomcalLink), inapp:(typeof _isInApp==='function'?_isInApp():'?'), native:(typeof _isNativeApp==='function'?_isNativeApp():'?'), title:document.title, h:document.body&&document.body.scrollHeight})`);
  const E = JSON.parse(env || '{}');
  rec('사이트 주소가 momcalendar.com', /^https:\/\/momcalendar\.com\//.test(E.u || ''), E.u);
  rec('앱 표시(UA MomcalApp/android)', /MomcalApp\/android/.test(E.ua || ''), E.ua);
  rec('Capacitor 안드로이드·앱 다리 있음', E.plat === 'android' && E.plug === true, `plat=${E.plat} plug=${E.plug}`);
  rec('카톡 인앱으로 오인하지 않음(_isInApp=false)', E.inapp === false, 'inapp=' + E.inapp);
  rec('화면이 그려짐(본문 높이)', (E.h || 0) > 800, 'h=' + E.h);

  // 바깥 링크 — 선택창 없이 브라우저(Custom Tab)·앱으로
  const links = [
    ['네이버 쇼핑커넥트(파스퇴르 배너)', 'https://mkt.shopping.naver.com/link/689933f656cadb06db2de52d'],
    ['네이버 스마트스토어', 'https://smartstore.naver.com/'],
    ['쿠팡 제휴 링크', 'https://link.coupang.com/a/b'],
    ['인스타그램', 'https://www.instagram.com/momcal_/'],
  ];
  for (const [name, url] of links) {
    await c.ev(`(window.openLink?openLink(${JSON.stringify(url)}):location.href=${JSON.stringify(url)}),'ok'`);
    await sleep(4500);
    const t = top();
    shot('link_' + name.replace(/\W+/g, '_'));
    rec(`openLink ${name} → 선택창 없음`, !isChooser(t) && !t.startsWith(PKG + '/'), t);
    await back(); await home();
    if (!top().startsWith(PKG)) await launch();
  }
  // 생 링크(<a target=_blank>) — 사이트의 핫딜 구매 버튼·카페 링크 같은 것
  {
    await c.ev(`(function(){var a=document.createElement('a');a.href='https://smartstore.naver.com/';a.target='_blank';a.rel='noopener';document.body.appendChild(a);a.click();return 'ok'})()`);
    await sleep(4500);
    const t = top(); shot('raw_link');
    rec('생 링크 a target=_blank → 선택창 없음', !isChooser(t) && !t.startsWith(PKG + '/'), t);
    await back(); await home(); if (!top().startsWith(PKG)) await launch();
  }
  // intent: 주소(카톡 없는 폰) — 앱이 죽지 않고 대체 주소로
  try { c.close(); } catch (_) {}
  c = await cdp();
  {
    await c.ev(`location.href='intent://inappbrowser?url='+encodeURIComponent('https://smartstore.naver.com/')+'#Intent;scheme=naversearchapp;package=com.nhn.android.search;S.browser_fallback_url='+encodeURIComponent('https://smartstore.naver.com/')+';end';'ok'`);
    await sleep(4500);
    const t = top(); shot('intent_fallback');
    const alive = sh('shell', 'pidof', PKG).trim() !== '';
    rec('intent: 주소(앱 없음) → 대체 주소, 앱 살아 있음', alive && !isChooser(t), t);
    await back(); await home(); if (!top().startsWith(PKG)) await launch();
  }
  // 우리 사이트 안 이동은 앱 화면 안에서
  try { c.close(); } catch (_) {}
  c = await cdp();
  {
    await c.ev(`location.href='https://momcalendar.com/test.html?e2e=1';'ok'`);
    await sleep(5000);
    const t = top();
    rec('우리 사이트 주소는 앱 화면 안에서', t.startsWith(PKG + '/'), t);
  }
  // 뒤로가기: 바깥 화면에서 뒤로 → 앱으로
  try { c.close(); } catch (_) {}
  c = await cdp();
  {
    await c.ev(`openLink('https://smartstore.naver.com/');'ok'`);
    await sleep(4000); await back();
    const t = top();
    rec('바깥 화면에서 뒤로가기 → 앱으로 돌아옴', t.startsWith(PKG + '/'), t);
  }
  // 공유: 공유 시트(ChooserActivity)가 뜨는 게 정상
  try { c.close(); } catch (_) {}
  c = await cdp();
  {
    const r = await c.ev(`(navigator.share?navigator.share({title:'맘캘린더',text:'시험',url:'https://momcalendar.com/'}).then(()=>'shared').catch(e=>'ERR '+e):'no share')`);
    await sleep(3000);
    const t = top(); shot('share');
    rec('공유 → 공유 시트', /Chooser|IntentResolver|ResolverActivity/.test(t) || r === 'shared', `r=${r} top=${t}`);
    await back();
  }
  // 파일 저장(카드 이미지·캘린더 파일)
  try { c.close(); } catch (_) {}
  c = await cdp();
  {
    const r = await c.ev(`(window.Capacitor&&Capacitor.Plugins.MomcalLink?Capacitor.Plugins.MomcalLink.saveFile({name:'e2e_test.ics',mime:'text/calendar',base64:btoa('BEGIN:VCALENDAR\\r\\nEND:VCALENDAR\\r\\n')}).then(x=>JSON.stringify(x)).catch(e=>'ERR '+e):'no plugin')`);
    const ls = sh('shell', 'ls', '/sdcard/Download/맘캘린더/');
    rec('캘린더 파일 저장(Download/맘캘린더)', /e2e_test/.test(ls), `r=${r} ls=${ls.trim()}`);
  }
  // 알림 준비 상태(설정 파일 유무를 그대로 보고)
  {
    const r = await c.ev(`(Capacitor.Plugins.MomcalLink.pushReady().then(x=>JSON.stringify(x)).catch(e=>'ERR '+e))`);
    rows.push(`| ℹ️ | 알림 설정 파일 | ${r} |`);
  }
  // 위젯 번호
  {
    const r = await c.ev(`(Capacitor.Plugins.MomcalLink.widgetId().then(x=>x.id).catch(e=>'ERR '+e))`);
    rec('위젯 번호를 앱이 알려 줌', /^w[A-Za-z0-9]{15,40}$/.test(r || ''), r);
  }
  // 앱 링크: 바깥에서 momcalendar.com 주소를 열면 우리 앱이 받는다(카카오 로그인 뒤 돌아오기)
  {
    const v = sh('shell', 'pm', 'get-app-links', PKG);
    rows.push(`| ℹ️ | 앱 링크 확인 상태 | ${v.replace(/\s+/g, ' ').trim().slice(0, 250)} |`);
    sh('shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-c', 'android.intent.category.BROWSABLE', '-d', 'https://momcalendar.com/?from=applink');
    await sleep(6000);
    const t = top(); shot('applink');
    rec('momcalendar.com 주소 → 우리 앱이 받음', t.startsWith(PKG + '/'), t);
  }
  finish();
})().catch((e) => { rec('시험 중 오류', false, e.stack || e.message); finish(); });

function finish() {
  const md = `# 안드로이드 앱 자동 시험 (${new Date().toISOString()})\n\n| 결과 | 항목 | 메모 |\n|---|---|---|\n${rows.join('\n')}\n\n실패 ${fails}개\n`;
  fs.writeFileSync(`${OUT}/report.md`, md);
  console.log(md);
  process.exit(fails ? 1 : 0);
}
