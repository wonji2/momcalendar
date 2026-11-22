/**
 * 🛡 PC 광고 프로그램 감시 (2026-10-24 사장님 「뿌리까지 확실히 삭제하고 저런거 다신 안깔리게 해봐」)
 *
 * 왜: 이 PC 에 파일노리 Plug-in·샵마인·SafeVisit(WinDivert 통신 가로채기 드라이버)가 2019~2022년부터 깔려 있었고,
 *     쿠팡에 들어가면 searchalgorithm.co.kr/ad/tab_open.php → api.onpith.com → 남의 쿠팡 제휴(subid S1200751)로 쿠키를 덮어썼다.
 *     10-24 22:24 엔 그 주소가 Claude 앱 채팅에 저절로 들어왔다(앞에 떠 있던 크롬 계열 창에 붙여 넣은 꼴). 메모리 adware-types-into-claude-app.
 *
 * 흐름: pc_watch_collect.ps1(읽기만) → 지난 상태(scratchpad/pc_watch_state.json)와 비교
 *       ① 차단 목록(이름·광고 서버·확장 id)에 걸리면 🔴  ② 새로 생긴 프로그램·시작 프로그램·예약작업·서비스·드라이버·확장·루트 인증서·프록시는 🟡
 *       → 오늘 카드 맨 위 알림(daily/_alert.txt 키 pcwatch) + DB health_alerts('PC감시:…', 12시간에 한 번) + 로그 scratchpad/pc_watch_log.txt
 *       ⚠ 지우지 않는다 — 알리기만. 지우는 건 사장님 승인 뒤(설정 → 앱, 크롬 chrome://extensions).
 * 실행: node tools/daily/pc_adware_watch.mjs          (예약작업 momcal-pc-watch 매일 12:40 · 로그인할 때)
 *       node tools/daily/pc_adware_watch.mjs --dry    (알림·DB 안 씀, 화면에만)
 *       node tools/daily/pc_adware_watch.mjs --reset  (지금 상태를 기준으로 삼는다 — 새 프로그램을 확인하고 괜찮으면)
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { sbArgs, parseRows } from './sb_query.mjs';
import { setAlert, clearAlert } from './alert.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = 'C:/Users/FAMILY/supabase-cli/supabase.exe';
const LOG = path.join(REPO, 'scratchpad', 'pc_watch_log.txt');
const STATE_F = path.join(REPO, 'scratchpad', 'pc_watch_state.json');
const DRY = process.argv.includes('--dry'), RESET = process.argv.includes('--reset');
const stamp = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');
const log = (m) => { const l = `[${stamp()}] ${m}`; console.log(l); if (!DRY) try { fs.appendFileSync(LOG, l + '\n'); } catch {} };
const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
const sql = (text) => {
  const f = path.join(REPO, 'scratchpad', `_pcw_${process.pid}.sql`); fs.writeFileSync(f, text, 'utf8');
  try { const r = parseRows(execFileSync(CLI, sbArgs(f), { cwd: REPO, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 120e3 })); return r.rows; }
  finally { try { fs.unlinkSync(f); } catch {} }
};

// 차단 목록 — 이름·광고 서버·확장. 늘릴 땐 근거를 주석으로(2026-10-24 실측)
const BAD_NAME = /샵마인|ShopMine|SafeVisit|FileNori|파일노리|WinDivert|searchalgorithm|onpith/i;
const BAD_DNS = /searchalgorithm\.co\.kr|onpith\.com/i;
// 쇼핑몰 제휴 쿠키를 덮을 수 있는 확장(우리 쿠팡·링크프라이스 수수료를 가져간다) · 무료 VPN·광고 전력 확장
const WATCH_EXT = { djjjmdgomejlopjnccoejdhgjmiappap: 'ShopBack 캐시백(쇼핑몰 제휴 쿠키 덮어쓰기)', bihmplhobchoageeokmgbdihknkjbknd: 'Touch VPN(모든 사이트 통신 경유)', elicpjhcidhpjomhibiffojpinpmmpil: 'Video Downloader Professional(광고 삽입 신고 전력)', amlcmfdiddkikfmljhdhhookgjmnpedc: 'Currency Converter PRO' };

const raw = execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(REPO, 'tools', 'daily', 'pc_watch_collect.ps1')], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 300e3 });
const now = JSON.parse(raw.slice(raw.indexOf('{')));
const arr = (x) => (Array.isArray(x) ? x : x ? [x] : []);
const keysOf = {
  programs: (x) => x.name, run: (x) => `${x.name}=${x.cmd}`, tasks: (x) => x.name, services: (x) => x.name, drivers: (x) => x.name,
  extensions: (x) => `${x.browser}/${x.profile}/${x.id}`, roots: (x) => x.tp,
};
const cur = {}; for (const k of Object.keys(keysOf)) cur[k] = arr(now[k]).map(keysOf[k]);
let prev = null; try { prev = JSON.parse(fs.readFileSync(STATE_F, 'utf8')); } catch {}

const red = [], yellow = [];
// ① 차단 목록
for (const p of arr(now.programs)) if (BAD_NAME.test(`${p.name} ${p.pub} ${p.un}`)) red.push(`프로그램 ${p.name}`);
for (const r of arr(now.run)) if (BAD_NAME.test(`${r.name} ${r.cmd}`)) red.push(`시작 프로그램 ${r.name}`);
for (const t of arr(now.tasks)) if (BAD_NAME.test(`${t.name} ${t.cmd}`)) red.push(`예약작업 ${t.name}`);
for (const s of arr(now.services)) if (BAD_NAME.test(`${s.name} ${s.path}`)) red.push(`서비스 ${s.name}`);
for (const d of arr(now.drivers)) red.push(`드라이버 ${d.name} ${d.path}`);
for (const h of arr(now.dns)) if (BAD_DNS.test(h)) red.push(`광고 서버 접속 ${h}`);
for (const e of arr(now.extensions)) if (WATCH_EXT[e.id]) yellow.push(`확장 ${e.browser}/${e.profile} ${e.name} — ${WATCH_EXT[e.id]}`);
for (const e of arr(now.extensions)) if (!e.store) yellow.push(`스토어 밖에서 깔린 확장 ${e.browser}/${e.profile} ${e.name} (${e.id})`);
if (now.proxy && (now.proxy.enable || now.proxy.pac)) yellow.push(`프록시 켜짐 ${now.proxy.server || ''} ${now.proxy.pac || ''}`);
// ② 지난번에 없던 것
if (prev && !RESET) {
  const lab = { programs: '새 프로그램', run: '새 시작 프로그램', tasks: '새 예약작업', services: '새 서비스', drivers: '새 드라이버', extensions: '새 확장', roots: '새 루트 인증서' };
  for (const k of Object.keys(keysOf)) {
    const old = new Set(prev[k] || []);
    for (const [i, key] of cur[k].entries()) if (!old.has(key)) {
      const x = arr(now[k])[i];
      if (k === 'tasks' && /^\\momcal-|^\\njob-|^\\work-backup|^\\smartstore/.test(x.name)) continue;   // 우리 예약작업
      yellow.push(`${lab[k]}: ${k === 'extensions' ? `${x.browser}/${x.profile} ${x.name}${x.wide ? ' (모든 사이트 권한)' : ''}` : k === 'roots' ? x.subj.slice(0, 80) : k === 'run' ? x.name : (x.name || key)}`);
    }
  }
}
const uniq = (a) => [...new Set(a)];
const R = uniq(red), Y = uniq(yellow);
log(`🔴 ${R.length} · 🟡 ${Y.length}${prev ? '' : ' (첫 실행 — 지금 상태를 기준으로 저장)'}`);
R.forEach((x) => log('  🔴 ' + x)); Y.forEach((x) => log('  🟡 ' + x));

if (!DRY) {
  fs.writeFileSync(STATE_F, JSON.stringify({ at: stamp(), ...cur }, null, 0));
  if (R.length || Y.some((y) => /^새 (프로그램|드라이버|서비스|루트 인증서|시작)/.test(y))) {
    setAlert('pcwatch', `🛡 PC 점검: ${R.length ? `광고 프로그램 흔적 ${R.length}건(${R[0]})` : `새로 깔린 것 ${Y.length}건(${Y[0]})`} — scratchpad/pc_watch_log.txt`);
    const detail = [...R.map((x) => '🔴 ' + x), ...Y.map((x) => '🟡 ' + x)].join(' / ').slice(0, 900);
    try { sql(`insert into public.health_alerts(kind, detail) select 'PC감시', ${q(detail)} where not exists (select 1 from public.health_alerts where kind='PC감시' and detail=${q(detail)} and created_at > now() - interval '12 hours');`); } catch (e) { log('health_alerts 실패 ' + String(e).slice(0, 120)); }
  } else clearAlert('pcwatch');
}
