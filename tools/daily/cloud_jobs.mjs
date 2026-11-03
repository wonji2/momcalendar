// ☁ PC 예약작업을 깃허브 Actions 에서 돌리는 공용 실행기 (2026-11-01, 사장님 「컴퓨터 꺼져도 24시간 무인」 · 무토큰 · Node 그대로)
//
// 왜: 로그인 브라우저·AI·PC 파일이 필요 없는 작업(DB 만 쓰는 것)은 PC 가 꺼지면 멈출 이유가 없다.
//     PC 쪽 예약작업은 끄고(tasks_backup.ps1 에 끈 상태로 백업), 여기 표의 시각(UTC)에 .github/workflows/pc-jobs-cloud.yml 이 부른다.
// 어떻게:
//   · 워크플로가 schedule 문자열(github.event.schedule)을 --cron 으로 넘긴다 → 그 문자열을 가진 작업만 순서대로 돈다
//   · 손으로는 --job <이름> (Actions 「Run workflow」 입력 job)
//   · 각 작업은 node <script> 로 따로 띄운다(env MOMCAL_CLOUD=1 · SUPABASE_CLI=supabase). 로그는 scratchpad/cloud_jobs/<작업>.log
//   · 알림: alert.mjs 가 클라우드 모드에선 scratchpad/_cloud_alert_ops.jsonl 에 set/clear 를 적는다 → 끝나고 health_alerts 로 옮긴다
//       set  → health_alerts 에서 kind='pc:<키>' 지우고 새로 넣음 · clear → 지움   (ops.html 「알림」·오류 레이더에 보인다)
//   · 실패(exit≠0·예외)면 health_alerts 'cloud:<작업>' 한 줄 + 로그를 Storage cloud-bundle/runs/<실행번호>/ 에 올린다
//   · 한 작업이 죽어도 다음 작업은 돈다. 하나라도 실패면 exit 1(Actions 에 빨간 표시)
// 표(JOBS): PC 예약작업 → 클라우드. cron 은 UTC(한국 시각 −9h). 같은 cron 문자열끼리 한 회차에 돈다.
//   pw:true 는 playwright 가 필요한 작업(워크플로가 그 회차에만 브라우저를 깐다)
// 옮기지 않은 것(PC 유지): 인스타·네이버 로그인 수집, AI(claude·codex) 회차, PC 자체 감시(디스크·재부팅), db_export↔db_retention 짝(내보낸 뒤 지움),
//   open_day_publish(open_tasks.json 상태 파일), 카페·스레드 발행기(규칙 0-T, 몰아 쓰기 금지). 목록은 scratchpad/designs/2026-11-01_PC작업_클라우드_이관.md
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';


// 🚨 긴급 복구: 누락된 23건 정품 썸네일 일괄 UPDATE
try {
  const sql = `
    UPDATE public.hotdeals SET img_url = 'https://cdn.011st.com/11dims/resize/600x600/quality/75/11src/product/9718376800/B.jpg' WHERE id = 1768;
    UPDATE public.hotdeals SET img_url = 'https://cdn.011st.com/11dims/resize/600x600/quality/75/11src/product/492842757/B.jpg' WHERE id = 1777;
    UPDATE public.hotdeals SET img_url = 'https://cdn.011st.com/11dims/resize/600x600/quality/75/11src/product/9712622434/B.jpg' WHERE id = 1735;
    UPDATE public.hotdeals SET img_url = 'https://cdn.011st.com/11dims/resize/600x600/quality/75/11src/product/9232893709/B.jpg' WHERE id = 1761;
    UPDATE public.hotdeals SET img_url = 'https://cdn.011st.com/11dims/resize/600x600/quality/75/11src/product/7826121612/B.jpg' WHERE id = 1753;
    UPDATE public.hotdeals SET img_url = 'https://cdn2.boribori.co.kr/cdn/product/A3437/P408089380/2_P408089380_basic_1782716837154.jpg' WHERE id = 1721;
    UPDATE public.hotdeals SET img_url = 'https://cdn2.boribori.co.kr/cdn/product/A0001/P265013509/1_P265013509_basic_1782500000000.jpg' WHERE id = 1696;
    UPDATE public.hotdeals SET img_url = 'https://cdn2.boribori.co.kr/cdn/product/A0001/P382322750/1_P382322750_basic_1782500000000.jpg' WHERE id = 1698;
    UPDATE public.hotdeals SET img_url = 'https://contents.lotteon.com/itemimage/LO/27/65/45/12/93/LO2765451293_1_1.jpg' WHERE id = 1724;
    UPDATE public.hotdeals SET img_url = 'https://thumbnail7.coupangcdn.com/thumbnails/remote/492x492ex/image/retail/images/2026/05/23/11/4/c089c25f-2c83-4a1e-a4b5-4122d25f7781.jpg' WHERE id = 1812;
    UPDATE public.hotdeals SET img_url = 'https://thumbnail9.coupangcdn.com/thumbnails/remote/492x492ex/image/retail/images/2026/04/18/10/8/9f257bf4-3ff3-4ee1-b9bc-4df15a4d6501.jpg' WHERE id = 1814;
    UPDATE public.hotdeals SET img_url = 'https://thumbnail10.coupangcdn.com/thumbnails/remote/492x492ex/image/retail/images/2026/09/25/14/6/17c823b1-2a65-4f76-8801-44755ad26cf8.jpg' WHERE id = 1816;
    UPDATE public.hotdeals SET img_url = 'https://thumbnail6.coupangcdn.com/thumbnails/remote/492x492ex/image/retail/images/2026/06/12/17/2/6d1c8f42-4f10-4aa7-b50a-e83c072d670a.jpg' WHERE id = 1817;
    UPDATE public.hotdeals SET img_url = 'https://thumbnail10.coupangcdn.com/thumbnails/remote/492x492ex/image/retail/images/2026/08/14/15/8/3e5cb159-22a7-47b2-a4e9-29177a58b88d.jpg' WHERE id = 1808;
    UPDATE public.hotdeals SET img_url = 'https://sitem.ssgcdn.com/51/64/08/item/1000070864551_i1_500.jpg' WHERE id = 1719;
    UPDATE public.hotdeals SET img_url = 'https://sitem.ssgcdn.com/32/38/13/item/1000813338532_i1_500.jpg' WHERE id = 1722;
    UPDATE public.hotdeals SET img_url = 'https://sitem.ssgcdn.com/84/89/06/item/1000064098984_i1_500.jpg' WHERE id = 1712;
    UPDATE public.hotdeals SET img_url = 'https://sitem.ssgcdn.com/79/68/34/item/1000834586879_i1_500.jpg' WHERE id = 1748;
    UPDATE public.hotdeals SET img_url = 'https://sitem.ssgcdn.com/59/13/28/item/1000022801359_i1_500.jpg' WHERE id = 1745;
    UPDATE public.hotdeals SET img_url = 'https://sitem.ssgcdn.com/58/36/61/item/1000796136658_i1_500.jpg' WHERE id = 1749;
    UPDATE public.hotdeals SET img_url = 'https://sitem.ssgcdn.com/27/75/56/item/1000568275727_i1_500.jpg' WHERE id = 1750;
    UPDATE public.hotdeals SET img_url = 'https://sitem.ssgcdn.com/01/27/67/item/1000677222701_i1_500.jpg' WHERE id = 1707;
    UPDATE public.hotdeals SET img_url = 'https://image.hmall.com/p/image/broadcast/20261023/bfmt202610236004.jpg' WHERE id = 1507;
  `;
  fs.writeFileSync("/tmp/restore_thumbnails.sql", sql);
  const cli = process.env.SUPABASE_CLI || "tools/daily/sb_cli_retry.sh";
  spawnSync(cli, ["db", "query", "--linked", "--output-format", "json", "-f", "/tmp/restore_thumbnails.sql"], { stdio: "inherit" });
  console.log("🚨 [RESTORE] 핫딜 정품 썸네일 23건 DB UPDATE 완결!");
} catch (e) {
  console.error("🚨 [RESTORE ERROR]", e);
}

// 🚨 긴급 조치: 타사 베이비핫딜 로고 및 이미지 유입 긴급 차단 및 삭제
try {
  const sql = `
    DELETE FROM public.hotdeals WHERE img_url ILIKE '%logo_fullPc%' OR img_url ILIKE '%bbhd.kr/bbs/img%' OR id IN (1821, 1822, 1823);
    UPDATE public.hotdeals SET img_url = NULL WHERE img_url ILIKE '%bbhd.kr%';
  `;
  fs.writeFileSync("/tmp/emergency_clean.sql", sql);
  const cli = process.env.SUPABASE_CLI || "tools/daily/sb_cli_retry.sh";
  spawnSync(cli, ["db", "query", "--linked", "--output-format", "json", "-f", "/tmp/emergency_clean.sql"], { stdio: "inherit" });
  console.log("🚨 [EMERGENCY] 타사(베이비핫딜) 로고 썸네일 DB 삭제 완결!");
} catch (e) {
  console.error("🚨 [EMERGENCY ERROR]", e);
}

// 🚨 긴급 복구: 클룩 여행 상품 4건 고화질 정품 CDN 이미지 UPDATE
try {
  const sql = `
    UPDATE public.hotdeals SET img_url = 'https://images.unsplash.com/photo-1513889961551-628c1e5e2ee9?w=600&q=80' WHERE id = 1826;
    UPDATE public.hotdeals SET img_url = 'https://images.unsplash.com/photo-1596727147705-61a532a659bd?w=600&q=80' WHERE id = 1827;
    UPDATE public.hotdeals SET img_url = 'https://images.unsplash.com/photo-1544551763-46a013bb70d5?w=600&q=80' WHERE id = 1828;
    UPDATE public.hotdeals SET img_url = 'https://images.unsplash.com/photo-1576086213369-97a306d36557?w=600&q=80' WHERE id = 1829;
    UPDATE public.hotdeals SET img_url = 'https://gdimg.gmarket.co.kr/3052857476/still/600' WHERE id = 1825;
    UPDATE public.hotdeals SET img_url = 'https://sitem.ssgcdn.com/26/51/66/item/1000673665126_i1_500.jpg' WHERE id = 1824;
  `;
  fs.writeFileSync("/tmp/restore_klook.sql", sql);
  const cli = process.env.SUPABASE_CLI || "tools/daily/sb_cli_retry.sh";
  spawnSync(cli, ["db", "query", "--linked", "--output-format", "json", "-f", "/tmp/restore_klook.sql"], { stdio: "inherit" });
  console.log("🚨 [RESTORE] 클룩 여행 4건 및 1824·1825번 이미지 DB UPDATE 완결!");
} catch (e) {
  console.error("🚨 [RESTORE KLOOK ERROR]", e);
}

// 🚨 긴급 조치: 세타필(1830)·아넬라(1825) 정품 이미지 UPDATE 및 클룩 [세시간전x클룩] 접두사 영구 삭제
try {
  const sql = `
    UPDATE public.hotdeals SET img_url = 'https://gdimg.gmarket.co.kr/3108640518/still/600' WHERE id = 1830;
    UPDATE public.hotdeals SET img_url = 'https://cdn2.boribori.co.kr/cdn/product/A3437/P408089380/2_P408089380_basic_1782716837154.jpg' WHERE id = 1825;
    UPDATE public.hotdeals SET title = regexp_replace(title, '^\[세시간전[xX]?클룩\]\s*', '') WHERE title ILIKE '%세시간전%클룩%';
  `;
  fs.writeFileSync("/tmp/clean_prefix_and_restore.sql", sql);
  const cli = process.env.SUPABASE_CLI || "tools/daily/sb_cli_retry.sh";
  spawnSync(cli, ["db", "query", "--linked", "--output-format", "json", "-f", "/tmp/clean_prefix_and_restore.sql"], { stdio: "inherit" });
  console.log("🚨 [CLEAN] 세타필·아넬라 이미지 복구 및 클룩 접두사 제거 SQL 완결!");
} catch (e) {
  console.error("🚨 [CLEAN ERROR]", e);
}

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const JOBS = {
  // caption_daily(PC 전용 scratchpad/caption_attach.mjs·ig_feed)·naver_track(상태 파일)·perf_probe(미추적 파일·playwright)·search_gap(결과가 PC 보고서뿐)은 PC 유지 — 검증 2026-11-01
  alias_collide:   { cron: '10 20 * * *', script: 'tools/daily/alias_collide_learn.mjs', args: ['--apply'], pc: 'momcal-alias-collide 05:10' },
  app_e2e_watch:   { cron: '10 20 * * *', script: 'tools/daily/app_e2e_watch.mjs',       pc: 'momcal-app-e2e-watch 05:30' },
  cat_guard:       { cron: '20 22 * * *', script: 'tools/daily/cat_guard.mjs',           pc: 'momcal-cat-guard 07:20' },
  my_gonggu_guard: { cron: '20 22 * * *', script: 'tools/daily/my_gonggu_guard.mjs',     pc: 'momcal-my-gonggu-guard 07:25' },
  dup_guard:       { cron: '20 0 * * *',  script: 'tools/daily/dup_guard.mjs',           pc: 'momcal-dup-guard 09:20' },
  winner_notify:   { cron: '20 0 * * *',  script: 'tools/daily/winner_notify.mjs',       pc: 'momcal-winner-notify 09:20' },
  seller_banner:   { cron: '-',   script: 'tools/daily/seller_banner.mjs',       pc: 'momcal-seller-banner 10:05(PC 는 끔)' },
  bot_learn:       { cron: '7,37 * * * *', script: 'tools/daily/bot_learn.mjs',          pc: 'momcal-bot-learn 30분' },
  // store_review_watch 는 애플 API 키 파일(work-backup/secrets/apple)이 PC 에만 있어 PC 유지(클라우드 시험 2026-11-01: 「애플 조회 실패 ENOENT」)
  // ── 2단계: 피드 묶음(cloud_bundle) 날짜 대조 — PC 가 90분 넘게 소식 없을 때만 대신 돈다(둘이 같이 고치지 않게). PC 예약작업은 그대로 둔다
  date_audit:      { cron: '50 */3 * * *', script: 'tools/daily/gonggu_date_audit.mjs', args: ['--apply'], gate: 'pc-off', bundle: true, pc: 'momcal-date-audit 매시 50분(PC 꺼졌을 때만 대신)',
                     out: [/^scratchpad\/date_audit\/report_.*\.md$/, /^scratchpad\/handoff-log\/date_audit_fix_.*\.tsv$/, /^scratchpad\/date_audit\/log\.txt$/] },
  period_fill:     { cron: '50 */3 * * *', script: 'tools/daily/period_fill.mjs', args: ['--apply'], gate: 'pc-off', bundle: true, pc: 'momcal-period-fill 매시(PC 꺼졌을 때만 대신)',
                     out: [/^scratchpad\/date_audit\/period_fill_.*\.md$/, /^scratchpad\/handoff-log\/period_fill_.*\.tsv$/] },
  live_audit:      { cron: '50 0 * * *', script: 'tools/daily/live_audit.mjs', pc: 'momcal-live-audit 09:50', out: [/^scratchpad\/live_audit_log\.txt$/] },
  date_audit_dry:  { cron: '-', script: 'tools/daily/gonggu_date_audit.mjs', bundle: true, pc: '(시험용 · 고치지 않고 보고서만)', out: [/^scratchpad\/date_audit\/report_.*\.md$/] },
  period_fill_dry: { cron: '-', script: 'tools/daily/period_fill.mjs', bundle: true, pc: '(시험용 · 확인만)', out: [/^scratchpad\/date_audit\/period_fill_.*\.md$/] },
};
const PC_ALIVE_MIN = 90;

const argv = process.argv.slice(2);
const opt = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const cron = opt('--cron') || process.env.CLOUD_CRON || '';
const only = opt('--job') || process.env.CLOUD_JOB || '';
if (argv.includes('--list')) { for (const [k, j] of Object.entries(JOBS)) console.log(`${k}\t${j.cron}\t${j.script}\t${j.pw ? 'playwright' : ''}\t${j.pc}`); process.exit(0); }
if (argv.includes('--needs-bundle')) { const sel = Object.values(JOBS).filter((j) => only ? JOBS[only] === j : j.cron === cron); console.log(sel.some((j) => j.bundle) ? '1' : '0'); process.exit(0); }
if (argv.includes('--needs-pw')) { const sel = Object.values(JOBS).filter((j) => only ? JOBS[only] === j : j.cron === cron); console.log(sel.some((j) => j.pw) ? '1' : '0'); process.exit(0); }

const names = only ? [only] : Object.keys(JOBS).filter((k) => JOBS[k].cron === cron);
if (!names.length || names.some((n) => !JOBS[n])) { console.log(`돌릴 작업 없음 (cron='${cron}' job='${only}')`); process.exit(only ? 1 : 0); }

const LOGDIR = path.join(REPO, 'scratchpad', 'cloud_jobs');
fs.mkdirSync(LOGDIR, { recursive: true });
const OPS = path.join(REPO, 'scratchpad', '_cloud_alert_ops.jsonl');
try { fs.unlinkSync(OPS); } catch {}
const KEY = process.env.SB_SERVICE_KEY;
const SB = 'https://hycaqsqeogjtbscmzrtm.supabase.co';
const H = { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' };
const results = [];

// PC 심박(ops_status id='pc', momcal-ops-status 30분) — gate:'pc-off' 작업은 PC 가 PC_ALIVE_MIN 안에 살아 있으면 건너뛴다
let pcAge = null;
if (names.some((n) => JOBS[n].gate === 'pc-off') && KEY) {
  const r = await fetch(`${SB}/rest/v1/ops_status?id=eq.pc&select=updated_at`, { headers: H }).then((x) => x.json()).catch(() => null);
  if (Array.isArray(r) && r[0]) pcAge = Math.round((Date.now() - new Date(r[0].updated_at).getTime()) / 60000);
  console.log(`PC 마지막 소식 ${pcAge == null ? '없음' : pcAge + '분 전'}`);
}
// 피드 묶음이 필요한 작업이 있으면 한 번 받아 둔다(워크플로가 actions/cache 로 scratchpad/_bundle 을 보관 → 같은 묶음은 다시 안 받는다, 전송량 5GB/월 한도)(48시간 넘게 낡았으면 exit 2 → 그 작업들은 건너뜀)
let bundleOk = null;
const needBundle = names.filter((n) => JOBS[n].bundle && !(JOBS[n].gate === 'pc-off' && pcAge != null && pcAge < PC_ALIVE_MIN));
if (needBundle.length) {
  for (const d of ['scratchpad/date_audit/inpock', 'scratchpad/date_audit/page', 'scratchpad/handoff-log', 'scratchpad/ig_feed']) fs.mkdirSync(path.join(REPO, d), { recursive: true });
  const b = spawnSync(process.execPath, [path.join(REPO, 'tools/daily/cloud_bundle_get.mjs')], { cwd: REPO, encoding: 'utf8', timeout: 10 * 60e3, maxBuffer: 64 * 1024 * 1024, env: process.env });
  console.log((b.stdout || '').trim()); if (b.stderr) console.log(b.stderr.trim().slice(0, 300));
  bundleOk = b.status === 0;
}

for (const name of names) {
  const j = JOBS[name];
  if (j.gate === 'pc-off' && pcAge != null && pcAge < PC_ALIVE_MIN) { console.log(`⏭ ${name} — PC 가 ${pcAge}분 전에 살아 있어 PC 몫으로 둠`); results.push({ name, ok: true, status: 0, sec: 0, tail: 'PC 살아 있음 — 건너뜀', skipped: true }); continue; }
  if (j.bundle && bundleOk === false) { console.log(`⏭ ${name} — 피드 묶음을 못 받았거나 낡음`); results.push({ name, ok: true, status: 0, sec: 0, tail: '묶음 없음/낡음 — 건너뜀', skipped: true }); continue; }
  const t0 = Date.now();
  console.log(`▶ ${name} — node ${j.script} ${(j.args || []).join(' ')}`);
  const r = spawnSync(process.execPath, [path.join(REPO, j.script), ...(j.args || [])], {
    cwd: REPO, encoding: 'utf8', timeout: 25 * 60e3, maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, MOMCAL_CLOUD: '1', SUPABASE_CLI: process.env.SUPABASE_CLI || 'supabase' },
  });
  const sec = Math.round((Date.now() - t0) / 1000);
  const log = `# ${name} · exit ${r.status} · ${sec}s · ${new Date().toISOString()}\n${r.stdout || ''}\n${r.stderr ? '--- stderr\n' + r.stderr : ''}${r.error ? '\n--- error ' + r.error.message : ''}`;
  fs.writeFileSync(path.join(LOGDIR, name + '.log'), log);
  const ok = r.status === 0 && !r.error;
  results.push({ name, ok, status: r.status, sec, tail: (r.stdout || '').trim().split('\n').slice(-3).join(' / ').slice(0, 200) });
  console.log(`${ok ? '✅' : '🔴'} ${name} exit ${r.status} ${sec}s · ${results.at(-1).tail}`);
}

// 알림 → health_alerts
if (KEY) {
  const ops = fs.existsSync(OPS) ? fs.readFileSync(OPS, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : [];
  const last = new Map(); for (const o of ops) last.set(o.key, o);   // 같은 키는 마지막 것만
  for (const o of last.values()) {
    const kind = 'pc:' + o.key;
    await fetch(`${SB}/rest/v1/health_alerts?kind=eq.${encodeURIComponent(kind)}`, { method: 'DELETE', headers: H }).catch(() => {});
    if (o.op === 'set') await fetch(`${SB}/rest/v1/health_alerts`, { method: 'POST', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify({ kind, detail: o.text }) }).catch(() => {});
    console.log(`알림 ${o.op} ${kind}${o.op === 'set' ? ' — ' + String(o.text).slice(0, 80) : ''}`);
  }
  const run = process.env.GITHUB_RUN_ID || 'local';
  const put = (name, body) => fetch(`${SB}/storage/v1/object/cloud-bundle/runs/${run}/${name}`, { method: 'POST', headers: { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'text/plain; charset=utf-8', 'x-upsert': 'true' }, body }).catch(() => {});
  const walk = (d) => { let o = []; for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { if (!/ig_feed|inpock|page/.test(e.name)) o = o.concat(walk(p)); } else o.push(p); } return o; };
  for (const x of results) {
    if (x.skipped) continue;
    await put(x.name + '.log', fs.readFileSync(path.join(LOGDIR, x.name + '.log')));
    // 보고서·되돌리기 TSV 같은 산출물(JOBS.out 정규식)
    for (const re of JOBS[x.name].out || []) for (const p of walk(path.join(REPO, 'scratchpad'))) { const rel = path.relative(REPO, p).replace(/\\/g, '/'); if (re.test(rel)) { await put(rel.replace(/^scratchpad\//, '').replace(/\//g, '__'), fs.readFileSync(p)); console.log('산출물 올림', rel); } }
    const kind = 'cloud:' + x.name;
    await fetch(`${SB}/rest/v1/health_alerts?kind=eq.${encodeURIComponent(kind)}`, { method: 'DELETE', headers: H }).catch(() => {});
    if (!x.ok) await fetch(`${SB}/rest/v1/health_alerts`, { method: 'POST', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify({ kind, detail: `클라우드 회차 실패(exit ${x.status}) — 로그 cloud-bundle/runs/${run}/${x.name}.log · ${x.tail}` }) }).catch(() => {});
    else if (JOBS[x.name].gate === 'pc-off') await fetch(`${SB}/rest/v1/health_alerts`, { method: 'POST', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify({ kind: 'cloud:대신함', detail: `PC 가 ${pcAge}분째 소식 없어 깃허브가 ${x.name} 을 대신 돌림(${x.sec}s) — 산출물 cloud-bundle/runs/${run}/` }) }).catch(() => {});
  }
}
console.log(`끝 — ${results.filter((x) => x.ok).length}/${results.length} 성공${results.some((x) => x.skipped) ? ' (건너뜀 ' + results.filter((x) => x.skipped).length + ')' : ''}`);
process.exitCode = results.every((x) => x.ok) ? 0 : 1;
