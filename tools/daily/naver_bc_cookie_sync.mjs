// 🍪 네이버 브랜드커넥트 로그인 쿠키 → 서버 시크릿 NAVER_BC_COOKIE 자동 반영 + 풀림 미리 알기
//   (2026-11-25 사장님 「확인은 니가쳐하라고 · 네이버 안들어오면 니가 내위야」 — 11-25 10:20 쿠키가 풀려 핫딜이 0건이었는데 사장님이 먼저 발견했다)
//
// 왜 PC 몫인가: 네이버 로그인된 크롬 프로필(real_chrome, %USERPROFILE%\browser-profile-realchrome)이 이 PC 에만 있고,
//   서버 함수 naver-bc-hotdeals 는 그 쿠키를 시크릿으로 받아 쓴다. 서버가 스스로 로그인할 길은 없다(비밀번호를 프로그램이 다루지 않는다 — 규칙 0-LG 1).
// 하는 일(모드)
//   (기본, 매시간)  브랜드커넥트 목록 주소를 가볍게 한 번 찔러 본다 → 200 이면 쿠키를 서버 시크릿에 반영(바뀌었거나 5일 넘게 안 올렸을 때만)
//                   → 403 이면 두 번 연달아일 때(첫 회는 10분 뒤 재확인이 아니라 바로 한 번 더 찔러 봄) 카톡으로 요구 + 관리자 화면 표시.
//   --login         로그인 창(네이버 로그인 화면)을 PC 화면에 띄우고 로그인될 때까지 최대 15분 기다린 뒤 반영한다(사장님이 로그인할 때만 창을 띄운다).
//   --force         바뀐 게 없어도 서버에 다시 넣는다.   --dry  서버·카톡을 건드리지 않고 판정만 출력.
// 값은 어디에도 출력·기록하지 않는다(길이·해시 앞 8자리만). 서버 반영은 `supabase secrets set --env-file` — (관리 API 토큰은 secrets 권한이 없어 PC 에 로그인된 supabase CLI 로 넣는다).
// 쿠키 수명 기록: scratchpad/naver_bc_cookie.json  { lastOkAt, lastPushAt, hash, nidSesExp, history:[{seenAt, nidSesExp}] } — 풀린 횟수·수명을 센다.
// 예약작업: momcal-naver-bc-cookie (매시간, wscript run_hidden). 🔴 PC 에서만 돈다. PC 가 꺼져 있으면 서버가 10:20 에 풀림을 만나 카톡으로 요구한다(naver-bc-hotdeals).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { openRealChrome } from './real_chrome.mjs';
import { ownerKakao } from './owner_kakao.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');
const ST = path.join(ROOT, 'scratchpad', 'naver_bc_cookie.json');
const REF = 'hycaqsqeogjtbscmzrtm';
const DRY = process.argv.includes('--dry');
const FORCE = process.argv.includes('--force');
const LOGIN = process.argv.includes('--login');
const rd = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const st = rd(ST, { bad: 0, history: [] });
const save = () => { try { fs.mkdirSync(path.dirname(ST), { recursive: true }); fs.writeFileSync(ST, JSON.stringify(st, null, 1)); } catch { /* */ } };
const env = Object.fromEntries((fs.existsSync(path.join(HERE, '.env')) ? fs.readFileSync(path.join(HERE, '.env'), 'utf8') : '').split(/\r?\n/).map((l) => l.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2].replace(/^["']|["']$/g, '')]));
const log = (m) => console.log(new Date().toISOString().slice(0, 19) + ' ' + m);

async function probe(pg) {
  await pg.goto('https://brandconnect.naver.com/', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await pg.waitForTimeout(2500);
  return pg.evaluate(async () => {
    try {
      const r = await fetch('https://gw-brandconnect.naver.com/affiliate/query/affiliate-products/recommend-by-shopping-promotions?category1Id=50000005&limit=1',
        { credentials: 'include', headers: { 'x-space-id': '916463797554784', accept: 'application/json' } });
      return r.status;
    } catch { return 0; }
  });
}

async function push(ctx) {
  const ck = await ctx.cookies('https://gw-brandconnect.naver.com/');
  const header = ck.map((c) => c.name + '=' + c.value).join('; ');
  const ses = ck.find((c) => c.name === 'NID_SES');
  const exp = ses && ses.expires > 0 ? new Date(ses.expires * 1000).toISOString().slice(0, 10) : '';
  const hash = crypto.createHash('sha256').update(header).digest('hex').slice(0, 8);
  const stale = !st.lastPushAt || Date.now() - Date.parse(st.lastPushAt) > 5 * 86400e3;
  log(`쿠키 ${ck.length}개 · 길이 ${header.length} · 해시 ${hash} · NID_SES 만료 ${exp || '세션'}`);
  if (!ck.some((c) => c.name === 'NID_SES')) { log('NID_SES 없음 — 반영 안 함'); return false; }
  if (!FORCE && !stale && st.hash === hash) { log('바뀐 것 없음 — 서버 반영 생략'); return true; }
  if (DRY) { log('(--dry) 서버 반영 생략'); return true; }
  // 서버 시크릿 반영 = supabase CLI(이 PC 에 로그인돼 있음). env 파일은 임시로 만들고 바로 지운다(값 출력 금지).
  //   (tools/daily/.env 의 SUPABASE_ACCESS_TOKEN 은 secrets 권한이 없어 관리 API 직접 호출은 403 — 2026-11-25 실측)
  const cli = process.env.SUPABASE_CLI || 'C:/Users/FAMILY/supabase-cli/supabase.exe';
  const tmp = path.join(os.tmpdir(), 'nbc_' + process.pid + '.env');
  try {
    fs.writeFileSync(tmp, 'NAVER_BC_COOKIE=' + header + '\n', { mode: 0o600 });
    const r = spawnSync(cli, ['secrets', 'set', '--env-file', tmp, '--project-ref', REF], { encoding: 'utf8', timeout: 90000, windowsHide: true });
    if (r.status !== 0) { log('🔴 서버 반영 실패(CLI 종료코드 ' + r.status + ') ' + String(r.stderr || '').replace(/NAVER_BC_COOKIE=\S+/g, '…').slice(0, 160)); return false; }
  } finally { try { fs.unlinkSync(tmp); } catch { /* */ } }
  st.hash = hash; st.lastPushAt = new Date().toISOString(); st.nidSesExp = exp;
  if (!st.history.length || st.history[st.history.length - 1].nidSesExp !== exp) st.history.push({ seenAt: st.lastPushAt, nidSesExp: exp });
  st.history = st.history.slice(-30);
  save(); log('✅ 서버 시크릿 NAVER_BC_COOKIE 반영(이 시크릿은 다음 함수 호출부터 적용)');
  return true;
}

// 서버 함수의 쿠키가 살아 있나(?ping=1, 등록·알림 없음). 열쇠는 ~/.momcal_cron_secret(PC 에만, 값 출력 금지)
async function serverPing() {
  try {
    const sec = fs.readFileSync(path.join(os.homedir(), '.momcal_cron_secret'), 'utf8').trim();
    const r = await fetch(`https://${REF}.supabase.co/functions/v1/naver-bc-hotdeals?ping=1`, { headers: { 'x-cron-secret': sec }, signal: AbortSignal.timeout(30000) });
    const j = await r.json().catch(() => ({}));
    return { ok: !!j.ok, status: j.status ?? r.status, known: r.ok && 'ok' in j };
  } catch { return { ok: false, status: 0, known: false }; }
}

const quiet = st.suppressUntil && Date.now() < Date.parse(st.suppressUntil);   // 사장님이 이미 여러 번 로그인한 날은 요구하지 않는다(상태 파일에서 사람이 지정)
const sv = LOGIN ? { ok: false, known: false } : await serverPing();
log(`서버 쿠키 ping: ${sv.known ? (sv.ok ? '살아 있음' : '풀림 HTTP ' + sv.status) : '확인 못 함'}`);
if (!LOGIN && sv.known && sv.ok && !FORCE && st.lastPushAt && Date.now() - Date.parse(st.lastPushAt) < 5 * 86400e3) {
  log('서버 쿠키 정상 · 최근에 갱신함 — PC 프로필은 건드리지 않는다'); st.bad = 0; save(); process.exit(0);   // 창·프로필 잠금 없이 끝(대부분의 시간)
}

const rc = await openRealChrome({ visible: LOGIN });
let ok = false;
try {
  const pg = await rc.ctx.newPage();
  let code = await probe(pg);
  if (code === 200) ok = true;
  else if (LOGIN) {
    log(`로그인 필요(HTTP ${code}) — 네이버 로그인 창을 띄웠습니다. 「로그인 상태 유지」에 체크하고 로그인하세요. 로그인되면 자동으로 이어집니다(최대 15분).`);
    await pg.goto('https://nid.naver.com/nidlogin.login?url=https%3A%2F%2Fbrandconnect.naver.com%2F', { waitUntil: 'domcontentloaded' }).catch(() => {});
    const end = Date.now() + 15 * 60e3;
    while (Date.now() < end) { await new Promise((r) => setTimeout(r, 8000)); const u = pg.url(); if (!/nidlogin|nid\.naver\.com/.test(u)) { code = await probe(pg); if (code === 200) { ok = true; break; } } }
  }
  if (ok) {
    st.bad = 0; st.lastOkAt = new Date().toISOString();
    if (st.lost) { st.history.push({ seenAt: st.lastOkAt, back: true, lostAt: st.lost }); delete st.lost; }
    await push(rc.ctx); save();
    // 🔴 크롬이 쿠키를 디스크에 쓰는 데 약 30초 걸린다. 바로 끄면(taskkill) 「로그인 상태 유지」 쿠키도 사라져 프로필이 로그아웃으로 돌아간다(2026-11-25 실측 두 번)
    log('쿠키가 프로필 디스크에 기록되도록 45초 기다린다'); await pg.goto('about:blank').catch(() => {}); await new Promise((r) => setTimeout(r, 45000));
  } else if (!LOGIN) {
    // PC 프로필은 로그아웃인데 서버 쿠키는? — 서버가 살아 있으면 요구하지 않는다(서버 함수가 죽는 순간 스스로 카톡)
    if (sv.known && sv.ok) { log('PC 프로필은 로그아웃이지만 서버 쿠키가 살아 있어 요구하지 않는다'); }
    else {
      st.bad = (st.bad || 0) + 1; if (!st.lost) st.lost = new Date().toISOString(); save();
      log(`브랜드커넥트 로그인 풀림(PC HTTP ${code} · 서버 ${sv.known ? sv.status : '?'}) ${st.bad}회째${quiet ? ' · 오늘은 조용히(suppressUntil)' : ''}`);
      if (st.bad >= 2 && !DRY && !quiet) {
        const r = await ownerKakao(['[네이버 브랜드커넥트 로그인이 풀렸습니다] 집 PC 크롬에서 네이버에 로그인만 해 주시면 서버에 쿠키를 자동으로 다시 넣습니다. 창이 필요하시면 클로드 채팅에 「브랜드커넥트 로그인」이라고 해 주세요.']);
        log('카톡 요구 ' + JSON.stringify(r).slice(0, 120));
      }
    }
  } else { log('15분 안에 로그인되지 않음'); }
} finally { await rc.close(); }
process.exit(ok ? 0 : (sv.known && sv.ok ? 0 : 3));
