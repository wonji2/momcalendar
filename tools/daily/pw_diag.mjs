// 예약작업 환경에서 Playwright 가 브라우저를 못 찾는 원인 진단용 (2026-09-06). 결과: scratchpad/pw_diag_out.txt
import os from 'node:os'; import fs from 'node:fs'; import path from 'node:path';
const OUT = path.resolve('C:/Users/FAMILY/Desktop/MOMCALENDAR/scratchpad/pw_diag_out.txt');
const out = [];
out.push('cwd=' + process.cwd(), 'execPath=' + process.execPath, 'homedir=' + os.homedir(), 'argv=' + process.argv.join(' '));
for (const k of ['USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'HOME', 'HOMEDRIVE', 'HOMEPATH', 'TEMP', 'TMP', 'PLAYWRIGHT_BROWSERS_PATH', 'NODE_OPTIONS', 'NODE_USE_SYSTEM_CA', 'SystemRoot', 'ComSpec', 'PATH']) out.push(k + '=' + process.env[k]);
const exe = 'C:/Users/FAMILY/AppData/Local/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-win64/chrome-headless-shell.exe';
out.push('exists=' + fs.existsSync(exe));
try { const st = fs.statSync(exe); out.push('size=' + st.size); } catch (e) { out.push('stat err=' + e.message); }
try { out.push('dir=' + fs.readdirSync(path.dirname(exe)).length + ' entries'); } catch (e) { out.push('readdir err=' + e.message); }
try {
  const { chromium } = await import('playwright');
  out.push('pw executablePath=' + chromium.executablePath());
  const b = await chromium.launch(); out.push('launch OK ' + b.version()); await b.close();
} catch (e) { out.push('launch ERR=' + String(e.message).split('\n')[0]); }
fs.writeFileSync(OUT, out.join('\n'));
console.log(out.join('\n'));
