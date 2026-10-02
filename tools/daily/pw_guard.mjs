// playwright 도구가 **어떤 경우에도 끝나고, 끝날 때 임시 프로필을 남기지 않게** 한다 (2026-10-02)
//
// 2026-10-02 C드라이브 0바이트 사고 — 실측으로 밝힌 것 (추측 아님)
//   Temp 에 playwright 임시 프로필(playwright_chromiumdev_profile-*)이 3,912개(6.5GB) 쌓여 있었다.
//
//   ① playwright 는 브라우저를 띄울 때 process.on('exit') 훅을 걸어 둔다
//      (playwright-core lib/coreBundle.js: killSet.add(killProcessAndCleanup) → exitHandler).
//      그 훅은 **동기로** `taskkill /pid <크롬> /T /F` 하고 임시 프로필을 `rmSync` 한다.
//      → 그래서 「예외가 나서 close() 를 못 불렀다」만으로는 **안 샌다.** 직접 재현해 확인했다:
//         close() 없이 예외를 내고 죽여도 프로필 수가 18 → 19 → 18 로 제자리였다.
//
//   ② 그런데 **똑같은 스크립트를 `| head -6` 에 물려 돌리면 프로필이 남았다** (17 → 18, 그대로).
//      head 가 먼저 끝나 파이프가 닫히면 종료훅이 로그를 쓰다 EPIPE 로 엎어져 **치우기가 중간에 멈춘다.**
//      호출한 쪽이 출력을 그만 읽는 상황은 흔하다 — 그래서 종료훅에만 기대면 안 된다.
//
//   ③ 그리고 진짜 범인은 **안 끝나는 스크립트**였다. 남아 있던 것들의 부모를 찍어보니
//      node 도 크롬도 멀쩡히 살아 있었다:
//         node src/yt-capture.mjs …      1시간 30분째 그대로 (9회차)
//         node tools/video_frames.mjs …  **이틀째** 그대로
//      클로드 Bash 호출은 90초에 기다리기를 포기하고 돌아갔을 뿐, node 와 크롬은 영원히 남는다.
//      회차마다 임시 프로필 20MB + 크롬 11개 프로세스가 쌓였다.
//
//   ⇒ 그래서 방어가 세 겹이다.
//      · 예외가 나면 **우리가 직접 닫는다** (종료훅은 EPIPE 에 약하다)
//      · 제한시간이 지나면 **스스로 끝낸다** (안 끝나는 회차)
//      · 그래도 강제종료되면 남는다 → 안전망 예약작업 tools/daily/pw_tmp_clean.mjs 가 치운다
//
// 쓰는 법 — 두 줄이면 된다 (최상위 await 스크립트를 뜯어고치지 않아도 된다)
//   import { pwGuard } from './pw_guard.mjs';
//   const guard = pwGuard('오늘 카드', 5 * 60e3);
//   const browser = await chromium.launch();
//   guard.use(browser);
//   …                                      // 그대로. 끝에 await browser.close() 가 있으면 그것도 그대로 둔다
//
//   최상위 await 스크립트에서 예외는 unhandledRejection/uncaughtException 으로 올라온다 →
//   guard 가 그걸 받아 브라우저를 닫고 종료코드 1 로 끝낸다(스택은 그대로 찍는다).
//   제한시간 타이머는 unref() 라 **정상 종료를 1초도 늦추지 않는다.**
//   환경변수 PW_DEADLINE_MS 로 회차별 제한시간을 덮어쓸 수 있다 (음수면 제한시간 없음).

// 로그가 EPIPE 로 엎어져도 치우기가 멈추면 안 된다 — 출력은 전부 삼킨다
const say = (s) => { try { console.error(s); } catch {} };

export function pwGuard(label = 'playwright 작업', ms = 5 * 60e3) {
  const env = Number(process.env.PW_DEADLINE_MS);
  const limit = process.env.PW_DEADLINE_MS && Number.isFinite(env) ? env : ms;
  let browser = null;
  let done = false;

  // 8초만 기다려 본다 — close() 자체가 매달릴 수 있다 (매달린 close 를 기다리면 이 가드가 무의미해진다)
  const shut = async () => {
    if (!browser) return;
    const b = browser; browser = null;
    await Promise.race([b.close().catch(() => {}), new Promise((r) => setTimeout(r, 8000))]);
  };

  const bail = (code, why) => async (e) => {
    if (done) return;
    done = true;
    say(`🔴 ${label} — ${why}`);
    if (e) say(String((e && e.stack) || e));
    await shut();
    process.exit(code);           // 남은 크롬·임시프로필은 playwright 종료훅이 치운다
  };

  const onFail = bail(1, '예외로 중단 — 브라우저를 닫고 끝낸다');
  const t = (Number.isFinite(limit) && limit > 0)
    ? setTimeout(bail(3, `제한시간 ${Math.round(limit / 1000)}초 초과 — 끝내지 못해 강제 종료한다`), limit)
    : null;
  if (t) t.unref();

  return {
    use(b) {
      browser = b;
      process.on('unhandledRejection', onFail);
      process.on('uncaughtException', onFail);
    },
    // 브라우저를 다 쓰고 난 뒤 호출하면 가드를 뗀다 (안 불러도 된다 — 타이머는 unref 다)
    clear() {
      done = true;
      if (t) clearTimeout(t);
      process.off('unhandledRejection', onFail);
      process.off('uncaughtException', onFail);
    },
  };
}
