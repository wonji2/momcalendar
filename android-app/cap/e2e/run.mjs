// 에뮬레이터 자동 시험 — 깔린 앱을 실제로 켜고, 사이트에서 되던 것이 앱에서도 되는지 하나씩 본다 (2026-10-26)
//   node e2e/run.mjs <apk>     (CI: android-cap-build.yml e2e 잡, adb 가 연결된 에뮬레이터)
//   방법: adb 로 앱 실행 → 웹뷰 원격 디버깅 소켓(webview_devtools_remote_<pid>)에 붙어 화면 속 자바스크립트를 부른다
//         → 그 뒤 맨 앞 화면(mResumedActivity)과 화면 글자(uiautomator)로 실제로 어디가 열렸는지 본다.
//         「선택창」= ResolverActivity/ChooserActivity(공유 시트 제외). 「열렸다」= 크롬 Custom Tab + 화면에 그 주소.
//   결과: e2e-out/report.md · 스크린샷 e2e-out/*.png · 실패가 하나라도 있으면 exit 1
//   ⚠ 에뮬레이터엔 네이버·카톡 앱이 없다 → 「그 앱으로 넘기기」는 여기서 못 본다(실기기 확인 몫). 이 시험은 앱이 없을 때의 길을 본다.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const APK = process.argv[2];
const PKG = 'com.wantsb.momcalendar';
const TEST = process.env.E2E_URL || 'https://momcalendar.com/test-app.html';   // 시험용 앱이 띄운 주소(test.html 또는 라이브 https://momcalendar.com/)
const OUT = 'e2e-out';
fs.mkdirSync(OUT, { recursive: true });
const sh = (...a) => { try { return execFileSync('adb', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000 }); } catch (e) { return String(e.stdout || '') + String(e.stderr || ''); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rows = [];
let fails = 0;
const rec = (name, ok, note) => { rows.push(`| ${ok ? '✅' : '❌'} | ${name} | ${String(note || '').replace(/\|/g, '/').replace(/\n/g, ' ').slice(0, 300)} |`); if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', name, note || ''); };
const info = (name, note) => rows.push(`| ℹ️ | ${name} | ${String(note || '').replace(/\|/g, '/').replace(/\n/g, ' ').slice(0, 300)} |`);
const shot = (n) => { try { const b = execFileSync('adb', ['exec-out', 'screencap', '-p'], { timeout: 30000 }); fs.writeFileSync(`${OUT}/${n}.png`, b); } catch (_) {} };
const top = () => { const s = sh('shell', 'dumpsys', 'activity', 'activities'); const m = s.match(/mResumedActivity[^\n]*\{[^\n]*\s([\w.]+\/[\w.$]+)/) || s.match(/topResumedActivity[^\n]*\{[^\n]*\s([\w.]+\/[\w.$]+)/); return m ? m[1] : '?'; };
const isChooser = (a) => /ResolverActivity|IntentResolver|ChooserActivity/.test(a);
// 바깥 화면: 앱 안 브라우저 창(2026-10-27 — 사장님 「동일한 창에서 띄우면 되지」). 예전 Custom Tab 도 열린 것으로 본다
// 2026-10-27 오후: 바깥 링크는 폰의 인터넷 앱(에뮬레이터 = 크롬)으로 넘긴다 — 크롬·삼성 인터넷 본 화면도 열린 것으로 본다
const isTab = (a) => /customtabs\.CustomTabActivity|InAppBrowserActivity|^com\.android\.chrome\/|^com\.sec\.android\.app\.sbrowser\//.test(a);
const isBrowserApp = (a) => /^com\.android\.chrome\/|^com\.sec\.android\.app\.sbrowser\//.test(a);
const isInApp = (a) => /InAppBrowserActivity/.test(a);
const ours = (a) => a.startsWith(PKG + '/');
function screenText() { sh('shell', 'uiautomator', 'dump', '/sdcard/ui.xml'); return sh('shell', 'cat', '/sdcard/ui.xml'); }
const hostRe = (url) => { const h = new URL(url).hostname.replace(/^www\./, '').split('.').slice(-2).join('.'); return new RegExp(h.replace(/\./g, '\\.')); };

let C = null;   // 화면 속 자바스크립트 연결 — 화면이 바뀌면 다시 붙는다
async function cdp() {
  let sock = '';
  for (let i = 0; i < 40 && !sock; i++) {
    const pid = sh('shell', 'pidof', PKG).trim();
    const u = sh('shell', 'cat', '/proc/net/unix');
    const m = pid && u.match(new RegExp('@(webview_devtools_remote_' + pid + ')'));
    if (m) sock = m[1];
    else await sleep(1000);
  }
  if (!sock) throw new Error('웹뷰 디버깅 소켓 없음');
  sh('forward', '--remove-all');
  sh('forward', 'tcp:9333', 'localabstract:' + sock);
  let pages = [];
  for (let i = 0; i < 30; i++) {
    try { pages = await (await fetch('http://127.0.0.1:9333/json', { signal: AbortSignal.timeout(5000) })).json(); } catch (_) {}
    if (pages.find((p) => p.type === 'page' && /momcalendar\.com/.test(p.url))) break;
    await sleep(1000);
  }
  const pg = pages.find((p) => p.type === 'page' && /momcalendar\.com/.test(p.url)) || pages.find((p) => p.type === 'page');
  if (!pg) throw new Error('웹뷰 페이지 없음');
  const ws = new WebSocket(pg.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; setTimeout(() => j(new Error('ws 시간 초과')), 15000); });
  let id = 0; const wait = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && wait.has(m.id)) { wait.get(m.id)(m); wait.delete(m.id); } };
  ws.onclose = () => { for (const r of wait.values()) r({ error: 'closed' }); wait.clear(); };
  const send = (method, params = {}) => new Promise((r) => { const k = ++id; wait.set(k, r); try { ws.send(JSON.stringify({ id: k, method, params })); } catch (_) { r({ error: 'send' }); } setTimeout(() => { if (wait.has(k)) { wait.delete(k); r({ error: 'timeout' }); } }, 20000); });
  const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true }); if (r.error) return 'ERR ' + r.error; return r.result && r.result.result ? r.result.result.value : (r.result && r.result.exceptionDetails ? 'ERR ' + JSON.stringify(r.result.exceptionDetails).slice(0, 200) : undefined); };
  // 시험이 손님 통계(events: 로그인 시작·찜·클릭)를 더럽히지 않게 사이트의 기록 요청은 막는다 — live_smoke 와 같다(2026-10-26 error_radar 「로그인 길별 app 1/27」 이 시험 기기로 찼다). 앱 강제 종료 보고는 자바가 직접 보내 여기 안 걸린다
  await send('Network.enable'); await send('Network.setBlockedURLs', { urls: ['*/rest/v1/events*'] });
  return { ev, close: () => { try { ws.close(); } catch (_) {} } };
}
async function js(expr) { for (let k = 0; k < 2; k++) { if (!C) { try { C = await cdp(); } catch (e) { return 'ERR ' + e.message; } } const v = await C.ev(expr); if (!(typeof v === 'string' && /^ERR (closed|send|timeout)/.test(v))) return v; C.close(); C = null; } return 'ERR 연결'; }
const reset = () => { if (C) C.close(); C = null; };

async function chromeFre() {
  sh('shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', 'https://example.com/', 'com.android.chrome');
  for (let k = 0; k < 14; k++) {
    await sleep(2500);
    await dismissAnr();
    const x = screenText();
    if (/Example Domain/.test(x) && !/firstrun/i.test(top())) return true;
    const m = [...x.matchAll(/<node [^>]*text="([^"]*)"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/g)]
      .find((n) => /^(Accept & continue|Use without an account|Continue|No thanks|Got it|No Thanks|Done|More|Skip|동의하고 계속|계정 없이 사용|계속|아니요|확인|건너뛰기)$/i.test(n[1]));
    if (m) sh('shell', 'input', 'tap', String((+m[2] + +m[4]) >> 1), String((+m[3] + +m[5]) >> 1));
  }
  return false;
}
async function back() { sh('shell', 'input', 'keyevent', 'KEYCODE_BACK'); await sleep(1800); }
// 에뮬레이터 자체의 「…isn't responding」 창(앱과 상관없는 시스템 창)이 뜨면 「Wait」 를 눌러 닫는다 — 10-26 v14 회차가 이 창 뒤에 에뮬레이터가 꺼졌다
async function dismissAnr() {
  const x = screenText();
  if (!/isn.t responding|응답하지 않/.test(x)) return false;
  const m = [...x.matchAll(/<node [^>]*text="(Wait|대기)"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/g)][0];
  if (m) sh('shell', 'input', 'tap', String((+m[2] + +m[4]) >> 1), String((+m[3] + +m[5]) >> 1));
  else sh('shell', 'input', 'keyevent', 'KEYCODE_BACK');
  info('시스템 창 닫음', 'isn\'t responding');
  await sleep(1500);
  return true;
}
async function launch() {
  await dismissAnr();
  reset();
  sh('shell', 'am', 'force-stop', PKG);
  sh('shell', 'monkey', '-p', PKG, '-c', 'android.intent.category.LAUNCHER', '1');
  await sleep(9000);
}
// 바깥 화면을 닫고 앱으로 — 다음 시험이 깨끗이 시작하게
async function toApp() {
  for (let k = 0; k < 3 && !ours(top()); k++) await back();
  if (!ours(top())) { sh('shell', 'am', 'force-stop', 'com.android.chrome'); await launch(); }
}
// 누르고 나서 「선택창 없이, 브라우저 화면에, 그 주소가」 열렸는지
async function expectTab(name, url, run) {
  await dismissAnr();
  await run();
  // 5초 한 번만 보면 에뮬레이터가 느릴 때 브라우저가 아직 안 올라와 있다(빌드 #40) — 최대 15초, 1초마다 본다. 선택창이 뜨면 바로 멈춘다
  await sleep(3000);
  let t = top();
  for (let k = 0; k < 12 && !isTab(t) && !isChooser(t); k++) { await sleep(1000); t = top(); }
  await sleep(1500);
  // 화면 글자(uiautomator)는 페이지가 그려지는 중이면 비어 나온다 → 맨 앞 화면이 받은 주소(dumpsys 의 dat=)도 함께 본다
  const txt = screenText() + ' ' + sh('shell', 'dumpsys', 'activity', 'top').slice(0, 20000) + ' ' + (sh('shell', 'dumpsys', 'activity', 'activities').match(/mResumedActivity[sS]{0,3000}/) || [''])[0];
  shot('t_' + name.replace(/[^\w가-힣]+/g, '_').slice(0, 40));
  rec(`${name} → 선택창 없음`, !isChooser(t), t);
  rec(`${name} → 브라우저 화면에 그 주소`, isTab(t) && hostRe(url).test(txt), t + ' · ' + hostRe(url) + ' ' + hostRe(url).test(txt));
  rec(`${name} → 폰 인터넷 앱으로(그 앱 로그인 그대로)`, isBrowserApp(t), t);
  await toApp();
}

(async () => {
  info('설치', sh('install', '-r', APK).trim().slice(-80));
  // 크롬 첫 실행 안내(동의·로그인 권유)를 건너뛴다 — 바깥 링크가 이제 크롬 본 화면으로 열려서(2026-10-27 오후)
  sh('shell', 'am', 'set-debug-app', '--persistent', 'com.android.chrome');
  sh('shell', 'sh', '-c', "echo 'chrome --disable-fre --no-default-browser-check --no-first-run' > /data/local/tmp/chrome-command-line");
  // 시험 폰을 한국어로 — 손님 폰과 같게(에뮬레이터 기본 영어라 네이버·카카오 화면이 영어로 찍혔다, 사장님 2026-10-27 「네이버가 왜 영어로떠」)
  info('앱 언어 한국어', (sh('shell', 'cmd', 'locale', 'set-app-locales', PKG, '--locales', 'ko-KR') + sh('shell', 'cmd', 'locale', 'set-app-locales', 'com.android.chrome', '--locales', 'ko-KR')).trim().slice(0, 80) || 'ok');
  info('크롬 첫 실행 안내 넘김', String(await chromeFre()) + ' · ' + top());
  sh('shell', 'am', 'force-stop', 'com.android.chrome');
  await launch();
  shot('01_home');
  // 처음 켤 때 = 우리 안내 창 없이 **폰 시스템 알림 허용 창만** 바로 (사장님 2026-10-26 「마미톡처럼 시스템 팝업만」, 라이브 a7125d4c20) → 허용 → 알림 켜짐
  {
    let tapped = false, seen = '';
    for (let k = 0; k < 12 && !tapped; k++) {
      await sleep(1500);
      const x = screenText();
      const m = [...x.matchAll(/<node [^>]*text="(Allow|허용)"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/g)][0];
      if (m) { seen = top(); shot('00_perm_system'); sh('shell', 'input', 'tap', String((+m[2] + +m[4]) >> 1), String((+m[3] + +m[5]) >> 1)); tapped = true; }
    }
    const ours = await js(`String(!!document.querySelector('#appPerm.open'))`);
    rec('처음 켤 때 폰 알림 허용 창이 바로 뜬다(우리 안내 창 없음)', tapped && ours !== 'true', `허용창=${tapped} ${seen} · 우리창=${ours}`);
    let on = '';
    for (let k = 0; k < 10 && on !== '1'; k++) { await sleep(1500); on = await js(`localStorage.getItem('mc_push_on')`); }
    rec('허용 → 알림 켜짐', tapped && on === '1', `mc_push_on=${on}`);
  }
  const env = await js(`JSON.stringify({u:location.href, ua:navigator.userAgent, plat:(window.Capacitor&&Capacitor.getPlatform&&Capacitor.getPlatform()), plug:!!(window.Capacitor&&Capacitor.Plugins&&Capacitor.Plugins.MomcalLink), inapp:(typeof _isInApp==='function'?_isInApp():'?'), native:(typeof _mcNative==='function'&&!!_mcNative()), share:typeof navigator.share})`);
  let E = {}; try { E = JSON.parse(env); } catch (_) {}
  rec('앱이 켜지고 사이트가 뜬다', /^https:\/\/momcalendar\.com\//.test(E.u || ''), (E.u || env) + ' · ' + top());
  if (!E.u) return finish();
  rec('앱 표시(UA MomcalApp/android)', /MomcalApp\/android/.test(E.ua || ''), E.ua);
  rec('Capacitor 안드로이드·앱 다리 있음', E.plat === 'android' && E.plug === true && E.native === true, `plat=${E.plat} plug=${E.plug} native=${E.native}`);
  rec('카톡 인앱으로 오인하지 않음(_isInApp=false)', E.inapp === false, 'inapp=' + E.inapp);
  rec('공유 기능이 앱에 연결됨', E.share === 'function', 'navigator.share=' + E.share);
  await sleep(6000);
  const h = await js(`document.querySelectorAll('[data-gid], .card, .g-card, .main-slide').length+'|'+document.body.scrollHeight`);
  rec('목록이 그려짐(카드 수·본문 높이)', /^\d+\|\d+$/.test(h || '') && +h.split('|')[1] > 1500, h);
  shot('02_home_loaded');
  // 상태바·아래 막대 자리가 보라(#602090)인가 — 화면 원본 픽셀(screencap 원시 형식: 머리 + RGBA)
  await dismissAnr();
  {
    let note = '';
    let ok = false;
    // 에뮬레이터가 바쁘면(「응답 없음」 창·화면 버퍼 오류) 캡처가 비거나 다른 화면이 찍힌다 — 최대 세 번, 사이에 응답 없음 창을 닫는다(빌드 #38·#39)
    for (let tryN = 0; tryN < 3 && !ok; tryN++) try {
      if (tryN) { await dismissAnr(); await sleep(3000); }
      const b = execFileSync('adb', ['exec-out', 'screencap'], { timeout: 30000, maxBuffer: 64 * 1024 * 1024 });
      const w = b.readUInt32LE(0), hh = b.readUInt32LE(4), head = b.length - w * hh * 4;
      const px = (x, y) => { const o = head + (y * w + x) * 4; return [b[o], b[o + 1], b[o + 2]]; };
      const near = (p) => Math.abs(p[0] - 0x60) < 24 && Math.abs(p[1] - 0x20) < 24 && Math.abs(p[2] - 0x90) < 24;
      const topPx = px(w >> 1, 6), botPx = px(8, hh - 4);
      ok = near(topPx) && near(botPx);
      note = `위 ${topPx} · 아래 ${botPx} (${w}x${hh})${tryN ? ` · ${tryN + 1}번째 캡처` : ''}`;
    } catch (e) { note = e.message; }
    rec('상태바·아래 막대 보라색(TWA 때와 같은 색)', ok, note);
  }

  // 바깥 링크 — openLink(배너·핫딜·공구 카드가 지나는 길)
  const links = [
    ['파스퇴르 배너(네이버 쇼핑커넥트)', 'https://mkt.shopping.naver.com/link/689933f656cadb06db2de52d'],
    ['네이버 스마트스토어', 'https://smartstore.naver.com/'],
    ['쿠팡', 'https://www.coupang.com/'],
    ['인스타그램', 'https://www.instagram.com/momcal_/'],
    ['카카오 선물하기(앱 안에 갇히면 안 됨)', 'https://gift.kakao.com/'],
    ['카카오 오픈채팅(카톡 없음)', 'https://open.kakao.com/o/gz8pBKAh'],
  ];
  for (const [name, url] of links) await expectTab('openLink ' + name, url, () => js(`openLink(${JSON.stringify(url)}),'ok'`));
  // 생 링크 <a target=_blank> — 핫딜 구매 버튼·카페 링크·검색 줄처럼 openLink 를 안 지나는 곳
  await expectTab('생 링크(a target=_blank)', 'https://smartstore.naver.com/', () => js(`(function(){var a=document.createElement('a');a.href='https://smartstore.naver.com/';a.target='_blank';a.rel='noopener';document.body.appendChild(a);a.click();a.remove();return 'ok'})()`));
  // intent: 주소(네이버 앱 없음) → browser_fallback_url
  await expectTab('intent 주소(앱 없음) → 대체 주소', 'https://smartstore.naver.com/', () => js(`location.href='intent://inappbrowser?url='+encodeURIComponent('https://smartstore.naver.com/')+'#Intent;scheme=naversearchapp;package=com.nhn.android.search;S.browser_fallback_url='+encodeURIComponent('https://smartstore.naver.com/')+';end';'ok'`));
  rec('intent 뒤 앱 살아 있음', sh('shell', 'pidof', PKG).trim() !== '', 'pid=' + sh('shell', 'pidof', PKG).trim());

  // 우리 사이트 안 이동은 앱 화면 안에서 — 주소까지 확인
  {
    await js(`location.href='${TEST}?e2e=inside';'ok'`);
    await sleep(6000); reset();
    const u = await js('location.href');
    rec('우리 사이트 주소는 앱 화면 안에서', ours(top()) && /e2e=inside/.test(u || ''), top() + ' · ' + u);
  }
  // 바깥 링크는 이제 폰의 인터넷 앱으로 넘어가므로(2026-10-27 오후) 그 안에서 누른 링크는 인터넷 앱 몫이다 — 앱 안 창 안 링크 시험은 앱 안 창이 대체 길일 때만 의미가 있어 뺐다
  info('바깥 링크가 여는 곳', '폰의 인터넷 앱(기본 브라우저 → 삼성 인터넷 → 크롬 → 웨일 → 엣지). 그 앱의 로그인을 그대로 쓴다');
  // 뒤로가기: 바깥 화면(Custom Tab)이 정말 열린 뒤 뒤로 → 앱
  {
    await js(`openLink('https://smartstore.naver.com/'),'ok'`);
    await sleep(5000);
    const opened = top();
    await back();
    const t = top();
    rec('바깥 화면에서 뒤로가기 → 앱으로', isTab(opened) && ours(t), opened + ' → ' + t);
    await toApp();
  }
  // 카카오 로그인(카톡 없음): 카톡 앱 호출이 실패하면 카카오 웹 로그인이 **앱 화면 안에서** 떠야 한다
  {
    const r = await js(`(typeof startKakaoLogin==='function'?(startKakaoLogin(),'ok'):'no fn')`);
    await sleep(8000); reset();
    const u = await js('location.href');
    const t = top(); shot('kakao_login');
    rec('카카오 로그인 → 앱 안 카카오 로그인 화면', ours(t) && /(kauth|accounts)\.kakao\.com/.test(u || ''), `r=${r} · ${t} · ${String(u).slice(0, 120)}`);
    sh('shell', 'am', 'force-stop', PKG); await launch();
  }
  // 공유 시트
  {
    const r = await js(`(navigator.share({title:'맘캘린더',text:'시험',url:'https://momcalendar.com/'}).then(()=>'shared').catch(e=>'ERR '+e))`);
    await sleep(3000);
    const t = top(); shot('share');
    rec('공유 → 공유 시트', /Chooser|IntentResolver/.test(t), `r=${r} top=${t}`);
    await back(); await toApp();
  }
  // 캘린더 파일 — 사이트가 실제로 쓰는 길(Blob text/calendar;charset=utf-8 + a download)
  {
    await js(`(function(){var b=new Blob(['BEGIN:VCALENDAR\\r\\nVERSION:2.0\\r\\nEND:VCALENDAR\\r\\n'],{type:'text/calendar;charset=utf-8'});var a=document.createElement('a');a.href=URL.createObjectURL(b);a.download='e2e_site.ics';document.body.appendChild(a);a.click();a.remove();return 'ok'})()`);
    await sleep(4000);
    const ls = sh('shell', 'ls', '/sdcard/Download/맘캘린더/');
    const t = top();
    rec('캘린더 파일 저장(사이트와 같은 길)', /e2e_site/.test(ls), `ls=${ls.trim()} · top=${t}`);
    info('캘린더 파일 연 화면(에뮬레이터엔 캘린더 앱이 없을 수 있음)', t);
    await toApp();
  }
  // 카드 이미지 저장 — 사진 폴더
  {
    await js(`(function(){var c=document.createElement('canvas');c.width=c.height=8;c.toBlob(function(b){var a=document.createElement('a');a.href=URL.createObjectURL(b);a.download='e2e_card.png';document.body.appendChild(a);a.click();a.remove();},'image/png');return 'ok'})()`);
    await sleep(4000);
    const ls = sh('shell', 'ls', '/sdcard/Pictures/맘캘린더/');
    rec('카드 이미지 저장(Pictures/맘캘린더)', /e2e_card/.test(ls), ls.trim());
  }
  info('알림 설정 파일', await js(`(Capacitor.Plugins.MomcalLink.pushReady().then(x=>JSON.stringify(x)).catch(e=>'ERR '+e))`));
  {
    const r = await js(`(Capacitor.Plugins.MomcalLink.widgetId().then(x=>x.id).catch(e=>'ERR '+e))`);
    rec('위젯 번호를 앱이 알려 줌', /^w[A-Za-z0-9]{15,40}$/.test(r || ''), r);
  }
  // 알림 켜기: 사이트의 「알림 켜기」와 같은 함수 → 안드로이드 권한 창 「허용」 → FCM 토큰 → save-fcm-token
  //   (설정 파일이 없는 빌드면 pushReady=false 라 켜기가 false 로 끝나는 게 정상)
  {
    const ready = await js(`(Capacitor.Plugins.MomcalLink.pushReady().then(x=>String(x.ready)).catch(e=>'ERR '+e))`);
    await js(`(window.__e2ep='wait', enablePush().then(r=>{window.__e2ep=String(r)}).catch(e=>{window.__e2ep='ERR '+e}), 'ok')`);
    let tapped = false;
    for (let k = 0; k < 8 && !tapped; k++) {
      await sleep(2000);
      const x = screenText();
      const m = [...x.matchAll(/<node [^>]*text="(Allow|허용)"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/g)][0];
      if (m) { sh('shell', 'input', 'tap', String((+m[2] + +m[4]) >> 1), String((+m[3] + +m[5]) >> 1)); tapped = true; }
    }
    let r = 'wait';
    for (let k = 0; k < 10 && r === 'wait'; k++) { await sleep(1500); r = await js('window.__e2ep'); }
    const dev = await js('deviceId()');
    const on = await js(`localStorage.getItem('mc_push_on')`);
    if (ready === 'true') rec('알림 켜기 → 권한 허용 → 토큰 받음', r === 'true' && on === '1', `ready=${ready} 허용창=${tapped} 결과=${r} mc_push_on=${on}`);
    else info('알림 켜기(설정 파일 없는 빌드)', `ready=${ready} 결과=${r}`);
    info('시험 기기 번호(push_fcm 확인용)', dev);
    // 알림 도착: 바깥(PC 감시기 scratchpad/fcm_e2e_watch.mjs)이 이 기기 토큰을 보면 시험 알림을 보낸다 — 앱을 켠 채 1번, 홈으로 나간 뒤 1번
    //   알림 목록(dumpsys notification)에 우리 앱 알림이 올라왔는지 본다. E2E_PUSH=1 일 때만(감시기가 돌 때)
    if (process.env.E2E_PUSH === '1' && ready === 'true' && r === 'true') {
      const posted = () => { const d = sh('shell', 'dumpsys', 'notification', '--noredact'); const blocks = d.split(/NotificationRecord\(/).filter((b) => b.includes('pkg=' + PKG)); return blocks.map((b) => (b.match(/android\.title=String \(([^)]*)\)/) || [])[1] || '?').join(','); };
      info('알림 기다리기 시작', new Date().toISOString());
      let fg = '';
      for (let k = 0; k < 24 && !/시험/.test(fg); k++) { await sleep(5000); fg = posted(); }
      shot('push_foreground');
      info('앱 켠 채 판정 끝', new Date().toISOString());
      fs.writeFileSync(`${OUT}/notif_fg.txt`, sh('shell', 'dumpsys', 'notification', '--noredact'));
      rec('알림 도착 — 앱을 켠 채', /시험/.test(fg), fg || '120초 동안 없음');
      const num = (t) => Math.max(0, ...String(t).split(',').map((x) => +((x.match(/시험 (\d+)/) || [])[1] || 0)));
      const fgN = num(fg);
      sh('shell', 'service', 'call', 'notification', '1');   // 알림 모두 지우기(다음 판정을 깨끗이)
      sh('shell', 'input', 'keyevent', 'KEYCODE_HOME');
      let bg = '';
      for (let k = 0; k < 24 && !(num(bg) > fgN); k++) { await sleep(5000); bg = posted(); }
      shot('push_background');
      info('홈 판정 끝', new Date().toISOString());
      fs.writeFileSync(`${OUT}/notif_bg.txt`, sh('shell', 'dumpsys', 'notification', '--noredact'));
      rec('알림 도착 — 앱을 닫은(홈) 상태', num(bg) > fgN, `앱 켠 채 ${fgN}번 → 홈 ${num(bg)}번 · ${bg || '없음'}`);
      { const d = sh('shell', 'dumpsys', 'notification', '--noredact'); const b = d.split(/NotificationRecord\(/).filter((x) => x.includes('pkg=' + PKG)); rec('알림이 「맘캘린더 알림」 채널(팝업 등급)로', b.length > 0 && b.every((x) => /channel=momcal_default/.test(x) && /importance=4/.test(x)), b.map((x) => ((x.match(/channel=(\S+)/) || [])[1] || '?') + ' imp=' + ((x.match(/importance=(\d)/) || [])[1] || '?')).join(', ')); }
      info('알림 설정 상태', sh('shell', 'dumpsys', 'notification').split('\n').filter((l) => l.includes(PKG) && /importance|channel|banned|blocked/i.test(l)).slice(0, 6).join(' / '));
      await launch();
    }
  }
  // 앱 강제 종료 기록: 시험용 빌드에서 일부러 죽이고 → 다시 켜면 → 기록이 서버로 갔는가(CrashReporter)
  {
    const r = await js(`(Capacitor.Plugins.MomcalLink.crashTest().then(()=>'ok').catch(e=>'ERR '+e))`);
    await sleep(4000);
    const died = sh('shell', 'pidof', PKG).trim() === '' || !ours(top());
    sh('shell', 'am', 'force-stop', PKG);   // 「앱이 중지됨」 창이 남아 있으면 닫는다
    await dismissAnr();
    await launch();
    let st = '';
    for (let k = 0; k < 8; k++) { await sleep(2500); st = await js(`(Capacitor.Plugins.MomcalLink.crashStatus().then(x=>JSON.stringify(x)).catch(e=>'ERR '+e))`); if (/"pending":false/.test(st) && /"sentAt":[1-9]/.test(st)) break; }
    rec('앱 강제 종료 → 다시 켜면 기록을 서버로 보냄', died && /"pending":false/.test(st) && /"sentAt":[1-9]/.test(st), `시험=${r} 죽음=${died} 상태=${st}`);
  }
  // 앱 링크: 바깥에서 momcalendar.com 주소 → 우리 앱이 받고 그 주소를 띄운다(카카오 로그인 뒤 돌아오기)
  {
    info('앱 링크 확인 상태', sh('shell', 'pm', 'get-app-links', PKG).replace(/\s+/g, ' ').trim().slice(0, 250));
    sh('shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-c', 'android.intent.category.BROWSABLE', '-d', `${TEST}?from=applink`);
    await sleep(7000); reset();
    const u = await js('location.href');
    const t = top(); shot('applink');
    rec('momcalendar.com 주소 → 우리 앱이 받아 그 주소를 띄움', ours(t) && /from=applink/.test(u || ''), t + ' · ' + u);
  }
  // (맨 끝에서 — 폰 설정을 바꾸고 앱을 두 번 다시 켜서 에뮬레이터 화면이 흔들려 뒤 시험이 깨졌다, 빌드 #38) 폰 글자 크기를 키워도 앱 글자는 웹(브라우저)과 같은 크기 — 사장님 2026-10-27 「웹이랑 비교해서 묘하게 확대된 듯 큰 거 같애」
  {
    const measure = async () => Number(await js(`(function(){var s=document.createElement('span');s.textContent='가나다';s.style.cssText='font-size:16px;line-height:normal;position:absolute;left:-999px;top:0';document.body.appendChild(s);var h=s.getBoundingClientRect().height;s.remove();return String(h)})()`));
    const h1 = await measure();
    sh('shell', 'settings', 'put', 'system', 'font_scale', '1.3');
    reset(); await launch();
    const h2 = await measure();
    sh('shell', 'settings', 'put', 'system', 'font_scale', '1.0');
    reset(); await launch();
    rec('폰 글자 크기 130% 에도 앱 글자는 그대로(웹과 같은 크기)', h1 > 0 && h2 > 0 && Math.abs(h2 - h1) < 0.5, `글자 100%=${h1}px · 130%=${h2}px`);
  }
  finish();
})().catch((e) => { rec('시험 중 오류', false, e.stack || e.message); finish(); });

function finish() {
  // 앱이 죽었는지·알림 처리 기록 — 실패 원인을 추측하지 않고 기록으로 본다
  try {
    const crash = sh('logcat', '-d', '-b', 'crash');
    fs.writeFileSync(`${OUT}/crash.txt`, crash);
    const fatal = (crash.match(/FATAL EXCEPTION[\s\S]{0,600}/) || [''])[0].replace(/\s+/g, ' ');
    info('앱 강제 종료 기록', fatal ? fatal.slice(0, 280) : '없음');
    const all = sh('logcat', '-d', '-v', 'brief');
    const L = all.split('\n');
    fs.writeFileSync(`${OUT}/logcat_push.txt`, L.filter((l) => /FirebaseMessaging|FCM|GCM|PushNotification|Capacitor|NotificationService|momcalendar|AndroidRuntime|notif/i.test(l)).slice(-1500).join('\n'));
    fs.writeFileSync(`${OUT}/logcat_all_tail.txt`, L.slice(-6000).join('\n'));
  } catch (_) {}
  const md =`# 안드로이드 앱 자동 시험 (${new Date().toISOString()})\n\n| 결과 | 항목 | 메모 |\n|---|---|---|\n${rows.join('\n')}\n\n실패 ${fails}개\n`;
  fs.writeFileSync(`${OUT}/report.md`, md);
  console.log(md);
  process.exit(fails ? 1 : 0);
}
