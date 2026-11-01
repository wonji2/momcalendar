// 🌐 「그냥 크롬」을 띄워 CDP 로 붙는 공용 도구 (2026-10-13 — 지마켓 봇체크·오늘의집 로그인 유지 해결)
//
// 왜 — playwright 가 직접 띄운 크롬(launchPersistentContext)은 자동화 표식(--enable-automation 등)이 붙어
//   지마켓이 「잠시만 기다리십시오…」에서 안 넘어간다(2026-10-08 실측). **자동화 표식 없이 크롬을 그냥 띄우고**
//   `--remote-debugging-port` 로 붙으면 navigator.webdriver=false 이고 지마켓이 열린다(2026-10-13 실측, 새 프로필·창 화면 밖).
// 또 — **프로필이 디스크에 남는다.** 오늘의집·네이버 등 로그인은 이 프로필에 한 번만 해 두면 계속 쓴다
//   (사장님 2026-10-13 "로그인을 대체 몇번 해줘야해" — 세션마다 임시 프로필이라 매번 풀렸다).
//
// 쓰는 법
//   import { openRealChrome } from './real_chrome.mjs';
//   const rc = await openRealChrome();            // 창은 화면 밖(-3000,-3000)
//   const pg = await rc.ctx.newPage(); …          // playwright BrowserContext
//   await rc.close();                              // 내가 띄운 크롬만 끈다
//   openRealChrome({ visible: true })              // 사장님이 직접 로그인할 때 — 창을 화면 안에 띄운다
//
// 프로필 위치  %USERPROFILE%\browser-profile-realchrome  (레포 밖 — 쿠키가 들어 있으니 커밋·공개 금지, 백업 제외)
// 동시 실행    파일 잠금(%USERPROFILE%\.momcal-realchrome.lock). 다른 도구가 쓰는 중이면 최대 3분 기다린다.
// 한계         사장님이 같은 프로필을 직접 열어 둔 상태에서는(visible) 다른 도구가 못 쓴다 — 닫으면 된다.
import { spawn, execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  path.join(os.homedir(), 'AppData/Local/Google/Chrome/Application/chrome.exe'),
];
export const REAL_PROFILE = path.join(os.homedir(), 'browser-profile-realchrome');
const LOCK = path.join(os.homedir(), '.momcal-realchrome.lock');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function alive(pid) { try { process.kill(pid, 0); return true; } catch { return false; } }
async function acquire(maxWaitMs = 180000) {
  const t0 = Date.now();
  for (;;) {
    try { fs.writeFileSync(LOCK, String(process.pid), { flag: 'wx' }); return; }
    catch {
      let stale = false;
      try {
        const pid = Number(fs.readFileSync(LOCK, 'utf8'));
        const age = Date.now() - fs.statSync(LOCK).mtimeMs;
        stale = !alive(pid) || age > 15 * 60 * 1000;
      } catch { stale = true; }
      if (stale) { try { fs.unlinkSync(LOCK); } catch {} continue; }
      if (Date.now() - t0 > maxWaitMs) throw new Error('real_chrome: 다른 작업이 크롬 프로필을 쓰는 중(잠금) — 3분 넘게 기다렸다');
      await sleep(1500);
    }
  }
}

export async function openRealChrome({ profile = REAL_PROFILE, port = 9341, visible = false, startUrl = 'about:blank' } = {}) {
  const exe = CANDIDATES.find((p) => fs.existsSync(p));
  if (!exe) throw new Error('real_chrome: chrome.exe 를 못 찾았다');
  await acquire();
  const release = () => { try { fs.unlinkSync(LOCK); } catch {} };
  let child = null;
  try {
    const up = async () => { try { return (await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1500) })).ok; } catch { return false; } };
    if (!(await up())) {
      const args = [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
        '--disable-features=Translate', '--lang=ko-KR'];
      if (!visible) args.push('--window-position=-3000,-3000', '--window-size=1280,900');
      // 프로필에 화면 밖(-3000,-3000) 위치가 저장돼 있어 위치를 안 주면 창이 안 보인다(2026-10-13 사장님 '크롬창이 눈에 안 보여') — 항상 명시한다
      else args.push('--window-position=80,40', '--window-size=1100,900');
      args.push(startUrl);
      child = spawn(exe, args, { detached: false, stdio: 'ignore' });
      child.on('error', () => {});
      for (let i = 0; i < 40 && !(await up()); i++) await sleep(500);
      if (!(await up())) throw new Error('real_chrome: 크롬이 디버그 포트에 안 떴다(같은 프로필이 이미 열려 있을 수 있다)');
    }
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    const ctx = browser.contexts()[0];
    return {
      ctx, browser, spawned: !!child,
      async close() {
        try { await browser.close(); } catch {}
        if (child && child.pid) { try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch {} }
        release();
      },
    };
  } catch (e) {
    if (child && child.pid) { try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch {} }
    release();
    throw e;
  }
}
