// 🏠 오늘의집 로그인이 풀리면 **사람 없이** 다시 들어간다 (사장님 2026-10-27 「두번다신 안해도 된다고 했는데 또 해달라는 개소리말고 찾아서 해」)
//
// 왜 — 오늘의집 세션 쿠키(_ohouse_session_4)는 며칠짜리라 10-13·10-22 에 해 둔 로그인이 또 풀렸다(10-26 실측: 머리에 「로그인·회원가입」).
//   전용 크롬 프로필(real_chrome.mjs)에는 **카카오·네이버 로그인이 1년짜리로 살아 있다**(쿠키 만료 2026-11~2027-11).
//   오늘의집의 「카카오로 로그인」 「네이버로 로그인」은 그 세션으로 버튼 한 번에 끝난다 → 비밀번호를 쓰지 않는다.
// 순서 — 카카오(/users/auth/kakao, 「계정 선택」이면 저장된 momcal@kakao.com 을 누른다) → 안 되면 네이버(/users/auth/naver). 어느 쪽이든 **비밀번호·동의 화면이 나오면 멈춘다**(누르지 않는다).
// 쓰는 곳 — ohouse_link.mjs 가 로그아웃을 보면 먼저 이걸 부르고, 그래도 안 될 때만 경보.
//   직접: node tools/daily/ohouse_relogin.mjs      (결과 한 줄: ✅ 다시 로그인됨 · 🔴 못 함 + 이유)
import { openRealChrome } from './real_chrome.mjs';
const KAKAO_ACCOUNT = 'momcal@kakao.com';   // 오늘의집 계정이 가입한 카카오계정(간편로그인 목록에 저장돼 있다)

const loggedIn = async (pg) => {
  await pg.goto('https://store.ohou.se/goods/3934303', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await pg.waitForTimeout(3000);
  return pg.evaluate(() => { const l = [...document.querySelectorAll('header a, header button')].map((e) => (e.textContent || '').trim()); return !l.some((t) => t === '로그인' || t === '회원가입'); });
};

export async function ohouseRelogin(rc) {
  const own = !rc; if (own) rc = await openRealChrome();
  const pg = await rc.ctx.newPage(); const tried = [];
  try {
    if (await loggedIn(pg)) return { ok: true, how: '이미 로그인' };
    for (const sns of ['kakao', 'naver']) {
      await pg.goto(`https://ohou.se/users/auth/${sns}`, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
      // SSO 왕복을 기다린다 — 오늘의집으로 돌아오면 끝
      for (let i = 0; i < 20; i++) {
        await pg.waitForTimeout(1000);
        const u = pg.url();
        if (/ohou\.se/.test(new URL(u).host) && !/sign_in|auth|already_in/.test(u)) break;
        // 카카오 「로그인할 카카오계정 선택」(간편로그인 = 저장된 계정 한 번 누르기, 비밀번호 없음) — 이 계정은 카카오로 가입했다(10-27 실측 momcal@kakao.com)
        if (/accounts\.kakao\.com\/login\/simple/.test(u) && !(await pg.locator('input[type=password]').count().catch(() => 0))) {
          const acct = pg.getByText(KAKAO_ACCOUNT, { exact: false }).first();
          if (await acct.isVisible().catch(() => false)) { await acct.click().catch(() => {}); tried.push('카카오 간편로그인 계정 누름'); await pg.waitForTimeout(3000); }
        }
      }
      const host = new URL(pg.url()).host;
      if (/ohou\.se/.test(host) && await loggedIn(pg)) return { ok: true, how: sns };
      const pwd = await pg.locator('input[type=password]').count().catch(() => 0);
      tried.push(`${sns}: ${host}${pwd ? ' (비밀번호 화면 — 멈춤)' : ''}`);
    }
    return { ok: false, why: tried.join(' / ') };
  } finally { await pg.close().catch(() => {}); if (own) await rc.close().catch(() => {}); }
}

if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('tools/daily/ohouse_relogin.mjs')) {
  const r = await ohouseRelogin();
  console.log(r.ok ? `✅ 오늘의집 로그인됨 (${r.how})` : `🔴 다시 로그인 못 함 — ${r.why}`);
  process.exit(r.ok ? 0 : 3);
}
