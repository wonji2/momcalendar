// 라이브 실제 화면 검사 — 손님이 들어오는 4가지 길(모바일 웹·카톡 인앱·아이폰 앱·안드로이드 앱)로 사이트를 열어 핵심 동작을 직접 눌러 본다
//   (사장님 2026-10-26 "뭐든지 고치고 나면 오류 없는지 확인하는 시스템 … 제대로 구현된 거 맞아?")
//   만든 이유: 아이폰 앱 카카오 로그인이 하루 종일 0/10 이었는데, 서버 집계(error_radar)는 합계만 봐서 묻혔고
//              고친 뒤 「실제로 눌러 보는」 검사가 없었다. 이 도구가 그 검사다.
//
// 길마다 보는 것
//   ① 열기: 페이지 오류(pageerror)·우리 서버(supabase·api.momcalendar.com) 4xx/5xx·공구 카드 수
//   ② 앱(아이폰·안드)이면: 앱 표시(body.native-app)·머리가 상태바 아래에 있는지(아이폰 안전영역 59px 흉내)
//   ③ 핫딜·세일 탭 내용 · ④ 검색 「파스퇴르」 결과 · ⑤ 찜 켜고 끄기(서버 200) · ⑥ 옆 메뉴
//   ⑦ 카카오 로그인 누르면 어디로 가나: 앱·인앱은 kauth.kakao.com(카톡 앱 전환 금지), 웹은 카카오 어디든
//   ⑧ 다른 쪽(register·privacy·terms·test·todaycard) 200·페이지 오류 없음  ⑨ 위젯·찜 RPC 200
// 실행
//   node tools/daily/live_smoke.mjs            라이브 (실패하면 사장님 알림줄 'smoke' + health_alerts)
//   node tools/daily/live_smoke.mjs --local=<폴더>   그 폴더의 index.html·test.html 을 라이브 주소에 끼워 배포 전 시험(알림 안 씀)
//   node tools/daily/live_smoke.mjs --dry      알림 안 씀
// 예약: momcal-live-smoke (윈도우 예약작업) — 15분마다 index.html 이 바뀌었으면 즉시, 아니어도 매시 정각대 한 번
// 상태: scratchpad/live_smoke_state.json(마지막으로 검사한 index.html 해시) · 로그 scratchpad/live_smoke_log.txt
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { setAlert, clearAlert, pushAlerts } from './alert.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const LOCAL = (process.argv.find((a) => a.startsWith('--local=')) || '').slice(8);
const DRY = process.argv.includes('--dry') || !!LOCAL;
const AUTO = process.argv.includes('--auto');     // 예약작업: 바뀐 게 없고 지난 검사가 1시간 안이면 건너뛴다
const STATE = path.join(REPO, 'scratchpad', 'live_smoke_state.json');
const LOGF = path.join(REPO, 'scratchpad', 'live_smoke_log.txt');
const SITE = 'https://momcalendar.com/';
const KEY = 'sb_publishable_u4hR4mdNTSss3kdjFH6R5Q_iuJ2MuGE';
const kst = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');
const log = (s) => { console.log(s); try { fs.appendFileSync(LOGF, `[${kst()}] ${s}\n`); } catch {} };

// 예약 회차: 라이브 index.html 이 안 바뀌었고 마지막 검사가 1시간 안이면 쉰다
const liveHtml = LOCAL ? '' : await fetch(SITE + '?smoke=' + Date.now()).then((r) => r.text()).catch(() => '');
const hash = crypto.createHash('sha1').update(liveHtml).digest('hex').slice(0, 12);
const st = (() => { try { return JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch { return {}; } })();
// ⚠ process.exit() 로 끊으면 윈도우 node 가 열린 fetch 소켓을 닫다가 터진다(0xC0000409 — 예약작업이 실패로 찍힘). 블록을 건너뛰고 자연 종료한다
const SKIP = AUTO && st.hash === hash && Date.now() - (st.at || 0) < 55 * 60e3;
if (SKIP) console.log('바뀐 것 없음 — 건너뜀');
else {

const PATHS = {
  web:   { ua: 'Mozilla/5.0 (Linux; Android 14; SM-S921N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36' },
  kakao: { ua: 'Mozilla/5.0 (Linux; Android 14; SM-S921N; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0 Mobile Safari/537.36 KAKAOTALK 10.8.0', inapp: true },
  ios_app: { ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148', native: 'ios', safeTop: 59, safeBottom: 34 },
  android_app: { ua: 'Mozilla/5.0 (Linux; Android 14; SM-S921N; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0 Mobile Safari/537.36', native: 'android' },
};
const fails = []; const okn = { n: 0 };
const ok = (who, name, cond, extra = '') => { if (cond) okn.n++; else fails.push(`${who} · ${name}${extra ? ' — ' + extra : ''}`); log(`${cond ? '✅' : '🔴'} [${who}] ${name}${extra ? ' — ' + extra : ''}`); };

const b = await chromium.launch().catch(() => chromium.launch({ channel: 'chrome' }));
try {
  for (const [who, cfg] of Object.entries(PATHS)) {
    const ctx = await b.newContext({ viewport: { width: 393, height: 852 }, userAgent: cfg.ua, isMobile: true, hasTouch: true });
    if (cfg.native) await ctx.addInitScript((pf) => { window.Capacitor = { isNativePlatform: () => true, getPlatform: () => pf, Plugins: {} }; }, cfg.native);
    await ctx.addInitScript(() => { try { localStorage.setItem('mc_onb_done', '1'); localStorage.setItem('mc_onb_done_app', '1'); localStorage.setItem('mc_sheet_day', new Date().toISOString().slice(0, 10)); } catch (_) {} });
    if (LOCAL) await ctx.route((u) => u.hostname === 'momcalendar.com' && /^\/(index\.html|test\.html)?$/.test(u.pathname), (r) => {
      const f = new URL(r.request().url()).pathname.slice(1) || 'index.html';
      r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: fs.readFileSync(path.join(LOCAL, f), 'utf8') });
    });
    // 검사가 손님 통계(events: 로그인 시작·찜·클릭)를 더럽히지 않게 기록 요청은 막는다
    await ctx.route(/\/rest\/v1\/events/, (r) => r.fulfill({ status: 201, body: '' }));
    const kakaoNav = [];
    await ctx.route(/kakao\.com/, (r) => { if (r.request().isNavigationRequest()) { kakaoNav.push(r.request().url()); return r.abort(); } return r.continue(); });
    const p = await ctx.newPage();
    // 안드로이드 크롬 웹은 카톡 앱 전환(intent:)으로 가서 https 이동으로 안 잡힌다 → 실패한 이동도 센다
    p.on('requestfailed', (q) => { const u = q.url(); if (/kakao|^intent:/.test(u)) kakaoNav.push(u); });
    p.on('framenavigated', (fr) => { if (fr === p.mainFrame() && /^intent:|kakao|chrome-error/.test(fr.url())) kakaoNav.push(fr.url()); });
    if (cfg.safeTop) { const c = await ctx.newCDPSession(p); await c.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: cfg.safeTop, bottom: cfg.safeBottom, left: 0, right: 0 } }); }
    const errs = []; const bad = [];
    p.on('pageerror', (e) => errs.push(String(e.message).slice(0, 120)));
    p.on('response', (r) => { const u = r.url(); if (/supabase\.co|api\.momcalendar\.com/.test(u) && r.status() >= 400 && !/kakao-auth|naver-auth/.test(u)) bad.push(r.status() + ' ' + u.replace(/^https:\/\/[^/]+/, '').slice(0, 70)); });

    // ① 열기
    await p.goto(SITE + '?smoke=' + Date.now(), { waitUntil: 'domcontentloaded', timeout: 60000 });
    await p.waitForFunction(() => document.querySelectorAll('.card').length > 50, null, { timeout: 25000 }).catch(() => {});
    const cards = await p.evaluate(() => document.querySelectorAll('.card').length);
    ok(who, '공구 목록', cards > 100, `카드 ${cards}장`);
    // ② 앱 표시·상태바
    if (cfg.native) {
      const nat = await p.evaluate(() => document.body.classList.contains('native-app'));
      ok(who, '앱으로 알아봄(native-app)', nat);
      if (cfg.safeTop) {
        const t = await p.evaluate(() => { const e = document.querySelector('.hd input, .hd .logo, .hd img, .hd'); return e ? Math.round(e.getBoundingClientRect().top) : -1; });
        const logo = await p.evaluate(() => { const e = [...document.querySelectorAll('.hd *')].find((x) => x.getBoundingClientRect().height > 10 && x.offsetParent); return e ? Math.round(e.getBoundingClientRect().top) : -1; });
        ok(who, '머리가 상태바 아래', logo >= cfg.safeTop - 2, `머리 첫 요소 top ${logo}px (상태바 ${cfg.safeTop})`);
      }
    }
    // ③ 탭
    const tab = (t) => p.evaluate((x) => { try { switchContent(x); return true; } catch (e) { return false; } }, t);
    await tab('hotdeal'); await p.waitForTimeout(3000);
    { const n = await p.evaluate(() => [...document.querySelectorAll('#hotdealList .hc')].filter((e) => e.offsetParent).length); ok(who, '핫딜 탭', n > 0, `${n}개`); }
    await tab('sale'); await p.waitForTimeout(3000);
    { const txt = await p.evaluate(() => document.body.innerText); ok(who, '세일 탭', /세일|라방/.test(txt) && !/불러오지 못/.test(txt)); }
    await tab('gonggu'); await p.waitForTimeout(1500);
    // ④ 검색
    const s = await p.$('input[placeholder*="검색"]');
    if (s) { await s.fill('파스퇴르'); await s.press('Enter'); await p.waitForTimeout(2500); const hit = await p.evaluate(() => [...document.querySelectorAll('.card')].filter((c) => c.offsetParent && /파스퇴르/.test(c.textContent)).length); ok(who, '검색 「파스퇴르」', hit > 0, `${hit}건`); await s.fill(''); await s.press('Enter'); await p.waitForTimeout(1500); }
    else ok(who, '검색창', false, '못 찾음');
    // ⑤ 찜 켜고 끄기
    const wishRes = [];
    p.on('response', (r) => { if (/rpc\/wish_toggle/.test(r.url())) wishRes.push(r.status()); });
    await p.evaluate(() => { const c = document.querySelector('#cardList .card .wbtn[data-wid]'); c && c.scrollIntoView({ block: 'center' }); }); await p.waitForTimeout(600);
    const wid = await p.evaluate(() => { const b = document.querySelector('#cardList .card .wbtn[data-wid]') || [...document.querySelectorAll('.wbtn[data-wid]')].find((x) => x.offsetParent); if (!b) return null; const id = b.getAttribute('data-wid'); const was = isWished(id); toggleWish(Number(id), b); const now = isWished(id); toggleWish(Number(id), b); return { was, now, after: isWished(id) }; });
    await p.waitForTimeout(2000);
    ok(who, '찜 켜고 끄기', !!wid && wid.was !== wid.now && wid.after === wid.was && wishRes.length >= 2 && wishRes.every((x) => x === 200), JSON.stringify(wid) + ' 서버 ' + wishRes.join(','));
    await p.evaluate(() => { document.querySelectorAll('.app-pop.open,.app-sheet.open').forEach((e) => e.classList.remove('open')); });
    // ⑥ 옆 메뉴
    await p.evaluate(() => { try { openSide(); } catch (e) { window.__sideErr = e.message; } }); await p.waitForTimeout(700);   // 0.3초 미끄러져 나온다
    const side = await p.evaluate(() => { if (window.__sideErr) return 'err ' + window.__sideErr; const m = document.getElementById('sideMenu'); const r = m.getBoundingClientRect(); return r.right > 100 ? 'ok' : 'hidden ' + Math.round(r.right); });
    ok(who, '옆 메뉴', side === 'ok', side); await p.evaluate(() => { try { closeSide(); } catch (_) {} });
    // ⑦ 카카오 로그인 갈 곳
    await p.evaluate(() => { try { localStorage.removeItem('mc_member'); } catch (_) {} try { window.__kkoSkipGuide = true; startKakaoLogin(); } catch (e) { window.__kkErr = e.message; } });
    await p.waitForTimeout(3500);
    const dest = kakaoNav[0] || '';
    // 앱은 카카오톡 앱으로 바로(사장님 2026-10-27): 아이폰 kakaotalk://inappbrowser · 안드 intent:(SDK 의 CAPRI 로그인) — 크롬·kauth 화면 이동이면 실패
    const want = cfg.native === 'ios' ? /^kakaotalk:\/\/inappbrowser\?url=https%3A%2F%2Fkauth\.kakao\.com/ : cfg.native ? /^intent:/ : cfg.inapp ? /^https:\/\/kauth\.kakao\.com\/oauth\/authorize/ : /kakao|^intent:/;
    ok(who, '카카오 로그인 이동', want.test(dest), dest.replace(/client_id=[^&]+/, 'client_id=…').slice(0, 90) || '이동 없음');
    ok(who, '페이지 오류 없음', errs.length === 0, errs.slice(0, 2).join(' | '));
    ok(who, '우리 서버 4xx/5xx 없음', bad.length === 0, bad.slice(0, 3).join(' | '));
    await ctx.close();
  }
  // ⑧ 다른 쪽
  const ctx = await b.newContext({ viewport: { width: 393, height: 852 } }); const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  for (const pg of ['register.html', 'privacy.html', 'terms.html', 'test.html', 'todaycard.html', 'hotdealcard.html']) {
    errs.length = 0; const r = await p.goto(SITE + pg + '?smoke=' + Date.now(), { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => null);
    await p.waitForTimeout(3500);
    ok('다른 쪽', pg, r && r.status() === 200 && errs.length === 0, (r ? r.status() : '응답 없음') + (errs.length ? ' · ' + errs[0].slice(0, 80) : ''));
  }
  await ctx.close();
  // ⑨ RPC
  for (const [fn, body] of [['widget_feed', {}], ['wish_list', { p_device: 'smoketest0001' }], ['wish_counts', {}], ['gonggu_click_counts', {}]]) {
    const r = await fetch(`https://hycaqsqeogjtbscmzrtm.supabase.co/rest/v1/rpc/${fn}`, { method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null);
    ok('서버', 'RPC ' + fn, r && r.status === 200, r ? String(r.status) : '응답 없음');
  }
} finally { await b.close(); }

log(`결과: 통과 ${okn.n} · 실패 ${fails.length}${LOCAL ? ' (배포 전 시험)' : ''}`);
if (!LOCAL) fs.writeFileSync(STATE, JSON.stringify({ hash, at: Date.now(), fails }, null, 1));
if (!DRY) {
  if (fails.length) {
    setAlert('smoke', `🔴 라이브 화면 검사 실패 ${fails.length}건: ${fails.slice(0, 3).join(' / ')} — node tools/daily/live_smoke.mjs`);
    try {
      await fetch('https://hycaqsqeogjtbscmzrtm.supabase.co/rest/v1/events', { method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify({ event_type: 'smoke_fail', event_data: fails.join(' | ').slice(0, 900) }) });
    } catch {}
  } else clearAlert('smoke');
  try { pushAlerts('사장님 알림: 라이브 화면 검사'); } catch {}
}
process.exitCode = fails.length ? 1 : 0;
}
