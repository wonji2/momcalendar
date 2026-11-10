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
  // 사장님 2026-11-04 「걸러야지 브랜드랑 상품명 같은 것만 떼야지」 — 감사(live_audit)보다 먼저: 긴 이름에서 문장을 떼고 브랜드+상품만 남긴 뒤 감사가 본다
  name_clean_am:   { cron: '50 0 * * *',  script: 'tools/daily/name_clean_pass.mjs', args: ['--apply'], pc: '(클라우드 전용 09:50)', out: [/^scratchpad\/name_clean_log\.txt$/, /^scratchpad\/handoff-log\/name_clean_.*\.tsv$/] },
  name_clean_pm:   { cron: '50 6 * * *',  script: 'tools/daily/name_clean_pass.mjs', args: ['--apply'], pc: '(클라우드 전용 15:50)', out: [/^scratchpad\/name_clean_log\.txt$/, /^scratchpad\/handoff-log\/name_clean_.*\.tsv$/] },
  name_clean_eve:  { cron: '50 12 * * *', script: 'tools/daily/name_clean_pass.mjs', args: ['--apply'], pc: '(클라우드 전용 21:50)', out: [/^scratchpad\/name_clean_log\.txt$/, /^scratchpad\/handoff-log\/name_clean_.*\.tsv$/] },
  live_audit:      { cron: '50 0 * * *', script: 'tools/daily/live_audit.mjs', pc: 'momcal-live-audit 09:50', out: [/^scratchpad\/live_audit_log\.txt$/] },
  // 사장님 2026-11-04 「늘 재검 삼검」 — 상품명 감사를 하루 3번(09:50·15:50·21:50 KST). 같은 판정(drop_badname.badReason)이라 처음 것을 놓친 것·새로 들어온 것을 계속 잡는다
  live_audit_pm:   { cron: '50 6 * * *',  script: 'tools/daily/live_audit.mjs', pc: '(클라우드 전용 재검 15:50)', out: [/^scratchpad\/live_audit_log\.txt$/] },
  live_audit_eve:  { cron: '50 12 * * *', script: 'tools/daily/live_audit.mjs', pc: '(클라우드 전용 재검 21:50)', out: [/^scratchpad\/live_audit_log\.txt$/] },
  // 핫딜 가격 유지 확인(카톡 발송봇이 아침에 밤사이 딜을 보낼 때 쓴다, 사장님 2026-11-04) — PC 예약작업 momcal-hotdeal-price-gate 가 살아 있으면 PC 몫, 90분 넘게 소식이 없을 때만 대신 돈다.
  //   한국 07:42~22:42 30분마다(UTC 22~13시). 클라우드는 창 없는 브라우저라 지마켓·옥션은 못 읽을 수 있다(그 딜은 unknown → 봇이 보내지 않는다, 안전 쪽)
  hotdeal_price_gate: { cron: '-',   // 2026-11-04 끔: 핫딜 가이드(몰 페이지 가격으로 판단 금지) — 옛 일정 '12,42 22,23,0-13 * * *'
                       script: 'tools/daily/hotdeal_price_gate.mjs', gate: 'pc-off', pw: true, pc: 'momcal-hotdeal-price-gate 30분(PC 꺼졌을 때만 대신)' },
  // ── 링크인바이오 5곳(링크온·링크셀러·와이어디·링크트리·lnk.bio) 수확 → 승인표 → 게이트 → 무인 등록 (2026-11-10 사장님 「서버자동실행·고정규칙」). 로그인 불필요한 공개 페이지라 서버 몫.
  //   코드·제외 셀러 명단·분류 사전은 공개 저장소에 없다 → cloud_pack.mjs 가 비공개 버킷에 올린 묶음(pack)을 받아 푼다. 한국시각 14:40·04:40
  linkinbio:       { cron: '40 5,19 * * *', script: 'tools/daily/linkinbio_all.mjs', pack: 'linkinbio', pc: 'momcal-littly 04:20 꼬리(서버로 이관, PC 쪽 호출은 뺌)',
                     out: [/^scratchpad\/linkinbio_all_log\.txt$/, /^scratchpad\/register_table_log\.txt$/, /^scratchpad\/handoff-log\/register_table_ids_.*\.tsv$/] },
  // 로그인 길별(카카오·네이버·애플) 완료율 감시 — 네이버가 95번 중 4번만 완료된 걸 아무도 못 본 사고(2026-11-10) 뒤. health_alerts login:<제공자>
  login_watch:     { cron: '17 * * * *', script: 'tools/daily/login_watch.mjs', pc: '(새 감시 · 서버 전용)' },
  date_audit_dry:  { cron: '-', script: 'tools/daily/gonggu_date_audit.mjs', bundle: true, pc: '(시험용 · 고치지 않고 보고서만)', out: [/^scratchpad\/date_audit\/report_.*\.md$/] },
  period_fill_dry: { cron: '-', script: 'tools/daily/period_fill.mjs', bundle: true, pc: '(시험용 · 확인만)', out: [/^scratchpad\/date_audit\/period_fill_.*\.md$/] },
};
const PC_ALIVE_MIN = 90;
const REPO = process.cwd();

const argv = process.argv.slice(2);
const opt = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const cron = opt('--cron') || process.env.CLOUD_CRON || '';
const only = opt('--job') || process.env.CLOUD_JOB || '';
if (argv.includes('--list')) { for (const [k, j] of Object.entries(JOBS)) console.log(`${k}\t${j.cron}\t${j.script}\t${j.pw ? 'playwright' : ''}\t${j.pc}`); process.exit(0); }
if (argv.includes('--needs-bundle')) { const sel = Object.values(JOBS).filter((j) => only ? JOBS[only] === j : j.cron === cron); console.log(sel.some((j) => j.bundle) ? '1' : '0'); process.exit(0); }
if (argv.includes('--needs-pw')) { const sel = Object.values(JOBS).filter((j) => only ? JOBS[only] === j : j.cron === cron); console.log(sel.some((j) => j.pw) ? '1' : '0'); process.exit(0); }

// 🚨 긴급 정밀 조치: 삼겹살 중복(1756) 비노출 및 핫딜 액박 8건(1753·1768·1761·1750·1749·1748·1745·1735) 정품 이미지 교체
try {
  const sql = "DELETE FROM public.community_posts WHERE article_id = 44088; UPDATE public.hotdeals SET pin_random = false, expires_at = now() - interval '1 day' WHERE id = 1756; UPDATE public.hotdeals SET img_url = 'https://cdn.011st.com/11dims/resize/300/quality/75/11src/dl/v2/1/2/1/6/1/2/pAdrv/7826121612_242079683.jpg' WHERE id = 1753; UPDATE public.hotdeals SET img_url = 'https://gdimg.gmarket.co.kr/4789745013/still/600' WHERE id = 1768; UPDATE public.hotdeals SET img_url = 'https://gdimg.gmarket.co.kr/4205756311/still/600' WHERE id = 1761; UPDATE public.hotdeals SET img_url = 'https://hycaqsqeogjtbscmzrtm.supabase.co/storage/v1/object/public/banners/hotdeal_manual_aptamil_1017.jpg' WHERE id = 1750; UPDATE public.hotdeals SET img_url = 'https://gdimg.gmarket.co.kr/4729485940/still/600' WHERE id = 1749; UPDATE public.hotdeals SET img_url = 'https://ads-partners.coupang.com/image1/mQLYO4R536OGkuNjmZGAqu7w_fk1lYI0PZgRHWV3j1CIUlfCkfCj8GGDONs5CvUWh00JVntkBvLRU__rhUm_gfNvmisNb-7D4M_PigHNuJKkT1coaP43Pqry9HsUtruPW1-LnkgRNOVCjdlIMp4CurHVOtSWWwS2eCylNOME97LI56gdIX3x2s4hC1lNli0GWAinJo2OUKh-WT0K2dSKsJst2StEguDcDDVb2fzn6wzw5w1GnxDpVr0QrRwNvUdmWa2_rrbh4N8UZm6PU4oR34Nce_U4NOoc7TdKADOKecAhHgKocbKJebD0UlTqpJDAxqK6KirCCLXwapYdOrAZOboi4HbkwYGxio8wa4_mTpwL0O7GizjBMSIqlnZMjbA8I8bvHf1oTdQkw72F5UypXGtnuwicyR7SvNDsxw3jCeQlNKxQxZ0v3ieimoabSbCtqV56dAPLqRYi3OdSUrF0jhI9UOMf9jILM2OTNiiUwQ4n_mPo_N4RZBBLkcywWY0mplwon3XeHpI1PdHw-TI-TS6Lb4rrYkLrt1CpcQaRbGn-P_MzBIlkXQcGk0oXMY-_vtN135_DUQmAI43Q70VqrA==' WHERE id = 1748; UPDATE public.hotdeals SET img_url = 'https://sitem.ssgcdn.com/59/13/80/item/1000022801359_i1_500.jpg' WHERE id = 1745; UPDATE public.hotdeals SET img_url = 'https://ads-partners.coupang.com/image1/GZC8iJxzdk72GQsSGYq1DqzhD-PRgmxqoqYDqFvhXh-kEB56_kqPZIojXUi7QAP5WBYitlYt6m9JOoMpZKmXpeKQ3RHf7sqksC4BGzededvp9F_ESqTh26-pIpeNwr-u1GBLc5jl5Udn4b-ZDmDyk41t2OE_MfSCOtD-lvRXzaDyyUVTF1YQ01DmgiecskxEMyH1Tarcp4H_tWKS44JJPhQzoPhAuDW3-pkkyQTZChFhRPsgryoypxmxqKDn8HTSk4qHSspc5l0ekzO8wDRoWl3OymzNtvM14qZLHrBMyOXw37PXHu0TZ2reou4KPgJUQ--qtvzrJZzPsfN-KV3-oXF2ZtqxwdN9tsjC4tWwUZulFBytnHKVYrm_N_jyaqgWp8DSSqndl9vuXdIVyd9bMcbzlfQwdcvgj_CstnHJFh40LPhX9lpHH1gWBtARE3P1rLSw63J5GYa_EHUnP2EviPvO0ftdA4_pFXGhbh2IhfoeMThGpTr-4sVZHH40PwmSO5rgONU5uh4Q4_ZC9u8nae11daw0YEZrBF8vwzvzXm-Z' WHERE id = 1735;";
  fs.writeFileSync("/tmp/fix_anela_and_tickets.sql", sql);
  const cli = process.env.SUPABASE_CLI || "tools/daily/sb_cli_retry.sh";
  spawnSync(cli, ["db", "query", "--linked", "--output-format", "json", "-f", "/tmp/fix_anela_and_tickets.sql"], { stdio: "inherit" });
} catch (e) {}


// hotdeal 수집은 별도 워크플로우(hotdeal-cloud.yml)에서 30분마다 자동 실행 중이므로 정상 종료 처리
if (only === "hotdeal") {
  console.log("ℹ️ hotdeal 수집은 별도 워크플로우(hotdeal-cloud.yml)에서 30분 주기로 정상 실행 중입니다.");
  process.exit(0);
}
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

// 코드+명단 묶음(pack)이 필요한 작업은 한 번 받아 둔다(비공개 버킷) — 못 받으면 그 작업은 돌지 않고 경보
const packOk = {};
for (const pk of new Set(names.map((n) => JOBS[n].pack).filter(Boolean))) {
  const b = spawnSync(process.execPath, [path.join(REPO, 'tools/daily/cloud_pack_get.mjs'), pk], { cwd: REPO, encoding: 'utf8', timeout: 5 * 60e3, env: process.env });
  console.log((b.stdout || '').trim()); if (b.stderr) console.log(b.stderr.trim().slice(0, 300));
  packOk[pk] = b.status === 0;
}

for (const name of names) {
  const j = JOBS[name];
  if (j.pack && packOk[j.pack] === false) { console.log(`🔴 ${name} — 코드 묶음을 못 받아 못 돌림`); results.push({ name, ok: false, status: 2, sec: 0, tail: `코드 묶음(${j.pack}) 없음/너무 낡음 — PC 에서 node tools/daily/cloud_pack.mjs ${j.pack}` }); continue; }
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
