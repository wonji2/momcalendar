// 🔑 오늘의집 로그인을 **전용 크롬 프로필에 한 번만** 해 두는 도구 (2026-10-13 사장님 "로그인을 대체 몇번 해줘야해")
//
//   node tools/daily/ohouse_login.mjs            창이 화면에 뜬다 → 사장님이 로그인(카카오·네이버·이메일 아무거나)
//                                                 → 로그인된 걸 감지하면 쿠키를 저장하고 창을 닫는다. (최대 10분 대기)
//   node tools/daily/ohouse_login.mjs --check    창 없이 지금 로그인 상태만 확인 (종료코드 0=로그인됨, 3=로그아웃)
//
// 이후엔 ohouse_link.mjs 가 같은 프로필을 써서 큐레이터 링크를 알아서 받는다 — 사람 손 불필요.
// 로그아웃되면 ohouse_link.mjs 가 health_alerts 에 「오늘의집 로그인 만료」 를 남긴다(그때만 이 도구를 다시 실행).
// 프로필: %USERPROFILE%\browser-profile-realchrome (레포 밖, real_chrome.mjs 와 같은 프로필 — 커밋·공개 금지)
import { openRealChrome } from './real_chrome.mjs';

const CHECK = process.argv.includes('--check');
const GOODS = 'https://store.ohou.se/goods/3934303';

async function loggedIn(pg) {
  return await pg.evaluate(() => {
    const labels = [...document.querySelectorAll('header a, header button')].map((e) => (e.textContent || '').replace(/\s+/g, ' ').trim());
    const hasLoginBtn = labels.some((t) => t === '로그인' || t === '회원가입');
    return { loggedIn: labels.length > 0 && !hasLoginBtn, labels: labels.slice(0, 14) };
  }).catch(() => ({ loggedIn: false, labels: [] }));
}

const rc = await openRealChrome({ visible: !CHECK, startUrl: CHECK ? 'about:blank' : 'https://ohou.se/users/sign_in' });
let ok = false;
try {
  const pg = CHECK ? await rc.ctx.newPage() : (rc.ctx.pages().find((p) => /ohou\.se/.test(p.url())) || await rc.ctx.newPage());
  if (CHECK) {
    await pg.goto(GOODS, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await pg.waitForTimeout(4000);
    const r = await loggedIn(pg);
    ok = r.loggedIn;
    console.log(ok ? '✅ 오늘의집 로그인됨' : '🔴 오늘의집 로그아웃 상태 — node tools/daily/ohouse_login.mjs 로 한 번 로그인');
  } else {
    console.log('🪟 크롬 창이 떴습니다. 오늘의집에 로그인해 주세요(최대 10분 기다립니다).');
    const t0 = Date.now();
    while (Date.now() - t0 < 10 * 60 * 1000) {
      await pg.waitForTimeout(4000);
      // 로그인 화면을 떠났는지, 헤더에 로그인 버튼이 없는지
      const url = pg.url();
      if (/sign_in|login|auth|kakao|naver\.com|accounts/.test(url)) continue;
      const probe = await rc.ctx.newPage();
      await probe.goto(GOODS, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
      await probe.waitForTimeout(3500);
      const r = await loggedIn(probe);
      await probe.close().catch(() => {});
      if (r.loggedIn) { ok = true; break; }
    }
    console.log(ok ? '✅ 로그인 확인 — 쿠키가 전용 프로필에 저장됐습니다' : '⏱ 10분 안에 로그인이 확인되지 않았습니다');
    if (ok) {
      const ck = await rc.ctx.cookies('https://ohou.se');
      const persistent = ck.filter((c) => c.expires && c.expires > 0).length;
      console.log(`쿠키 ${ck.length}개 · 만료일 있는 것 ${persistent}개 (세션 쿠키만이면 크롬을 계속 띄워 둬야 한다)`);
    }
  }
} finally { await rc.close(); }
process.exit(ok ? 0 : 3);
