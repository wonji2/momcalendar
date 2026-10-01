/**
 * 📅 달력 채널 무인화 — 피드 스윕이 이미 받아둔 캡션에서 **공구 달력 글**을 골라 일정으로 뽑는다
 *
 * 왜 만들었나 (사장님 지적 2026-09-30 "달력 읽는건 기본인데 왜 매달 바뀌는거야 전달엔 달력 파싱해서 다했는데"):
 *   `scratchpad/_calendar_parse.mjs` 는 9/28 에 만들어 잘 돈다. 그런데 **입력을 사람이 손으로 넣어야** 했다
 *   (`{핸들: 캡션}` JSON 을 브라우저에서 옮겨 담는 방식). 9월 달력은 그렇게 손으로 했고,
 *   10월은 그 손 단계를 아무도 안 해서 **달력 글이 통째로 버려졌다**(9/30 하루에만 100건 넘음).
 *   피드 스윕(`ig_feed_sweep.mjs`)이 캡션을 **줄바꿈까지 온전히** jsonl 로 쌓고 있으니 손 단계가 필요 없다.
 *
 * 흐름:  scratchpad/ig_feed/<날짜>.jsonl  →  (달력 글 고르기)  →  _calendar_parse.mjs  →  6열 수확 TSV
 *        →  harvest_clean → harvest_to_table(분류) → drop_ended → pending_dedupe
 *        →  pending_check.sh(게이트) → 승인표  (INSERT 는 사장님 "올려" 뒤 — 규칙 0-N/09-17)
 *
 * 실행:  node tools/daily/calendar_round.mjs [--days 2] [--dry]
 * 상태:  scratchpad/calendar_seen.txt   (이미 뽑은 게시물 code — 같은 달력을 두 번 안 뽑는다)
 * 로그:  scratchpad/calendar_round_log.txt
 * 주기:  윈도우 예약작업 momcal-calendar (하루 3회 — 달력은 월초에 몰린다)
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..');
const NODE = 'C:/Users/FAMILY/node-portable/node-v24.18.0-win-x64/node.exe';
const DIR = path.join(ROOT, 'scratchpad', 'ig_feed');
const SEEN_F = path.join(ROOT, 'scratchpad', 'calendar_seen.txt');
const LOG_F = path.join(ROOT, 'scratchpad', 'calendar_round_log.txt');

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const DAYS = +arg('--days', 2);
const DRY = process.argv.includes('--dry');
const KST = () => new Date(Date.now() + 9 * 3600e3);
const today = KST().toISOString().slice(0, 10);
const stamp = KST().toISOString().slice(11, 16).replace(':', '');
const log = (s) => { const line = `[${today} ${KST().toISOString().slice(11, 16)}] ${s}`; console.log(line); try { fs.appendFileSync(LOG_F, line + '\n'); } catch { } };

// 🔴🔴 2026-10-01 검증자 지적: 예약작업은 `wscript //B run_hidden.vbs` 로 돌아 **자식의 stderr 가
//    어디에도 안 남는다**(run_hidden.vbs 에 리다이렉션이 없다). 전엔 전역 핸들러도 없어서
//    터지면 로그가 「달력 파싱 N건」에서 **그냥 끊겼다** — 「exit 0 인데 아무 일도 안 한 회차」가
//    로그상 정상으로 보였다. 메모리 scheduled-task-swallows-stderr.
//    → 죽는 이유를 반드시 로그 파일에 남기고 **0 이 아닌 코드로** 끝낸다(예약작업 LastResult 로 보인다).
for (const ev of ['uncaughtException', 'unhandledRejection']) {
  process.on(ev, (e) => {
    log(`🔴🔴 ${ev} — ${String(e && e.stack || e).split('\n').slice(0, 6).join(' | ')}`);
    process.exit(1);
  });
}

// ── 달력 글 판별
//   ① 달력·일정 모음이라고 **스스로 말하는** 글
const CAL_MARK = /(#?\s*\d{1,2}\s*월\s*공구\s*(달력|일정|라인업)|공구\s*(달력|일정|라인업)|월\s*(공구\s*)?(달력|일정|라인업)|일정\s*(모음|공유|안내)|공구\s*리스트|라인업\s*(공개|안내))/;
//   ② 또는 **날짜줄이 3개 이상** 있는 글 (스스로 말하지 않아도 달력이다)
const DATE_LINE = /^[^0-9\n]{0,4}(\d{1,2})\s*(?:[\/.]\s*\d{1,2}|월\s*\d{1,2}\s*일?)/;
const AGG = /^(gonggu_|gongu_|gonggoo|ggonggu|momcal)/;
// 🔴🔴 2026-10-01 — 공구 셀러가 아닌 계정은 **계정 명단으로만** 막는다(`calendar_not_sellers.txt`).
//    업종 낱말(병원·학원·약국…)로 막아 봤다가 되돌렸다: 피드 쪽에서 재니 **죽인 24건이 전부 정상 공구**였다
//    (`약국` 이 약사 셀러 woori_yaksa·yaksa_mh·yakstagram_ 를 잡았다).
//    2026-09-30 사고 계정 4개(doksanyouth·pangyodaycare·j.entclinic·baesebok_dental)는
//    **이미 그 명단에 있다** — 낱말 차단은 애초에 중복이었다. 새 비셀러가 보이면 명단에 한 줄 더한다.
// 🔴 파싱 제외 셀러는 **여기서 미리 뺀다** — 게이트(pending_check)에 걸리면 회차 전체가 멈춘다
//    (ig_feed_to_table.mjs 가 같은 이유로 같은 자리에서 뺀다. 2026-09-30 첫 회차에 yunu_uno 가 들어왔다)
const EXCLUDED = new Set(['ggumi_geonhu', 'mimimiso_', 'avocado_ha_', 'kkang_twins_', 'hyun._.brother', 'yunu_uno', 'momcal_']);
// 두 명단을 읽는다:
//   parsing_excluded.txt      — 사장님 지정 제외셀러
//   calendar_not_sellers.txt  — 달력꼴 글을 올리지만 **공구 셀러가 아닌 계정**(헬스장·학원·공연기획사·어린이집 등, 내 실측분)
// 🔴 2026-10-01 검증자 지적: 전엔 `catch { }` 라 **파일이 없으면 하드코딩 7명만 적용**되고
//    `my.77l77l`·`dalkom__mom` 등 6명이 조용히 통과했다. 못 읽으면 회차를 세우고 로그에 남긴다.
for (const f of ['parsing_excluded.txt', 'calendar_not_sellers.txt']) {
  const p = path.join(ROOT, 'scratchpad', f);
  try {
    const before = EXCLUDED.size;
    for (const l of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
      if (l.trim().startsWith('#')) continue;
      const h = l.trim().split(/[\s|#(]/)[0];
      if (/^[a-z0-9._]{3,}$/.test(h)) EXCLUDED.add(h);
    }
    if (EXCLUDED.size === before) { log(`🔴 ${f} 에서 아무 핸들도 못 읽었다 — 형식이 바뀌었나? 회차를 멈춘다`); process.exit(1); }
  } catch (e) {
    log(`🔴 제외셀러 명단을 못 읽었다: ${f} (${e.code}) — 제외 없이 돌면 제외셀러가 등록된다. 회차를 멈춘다`);
    process.exit(1);
  }
}

const seen = new Set(fs.existsSync(SEEN_F) ? fs.readFileSync(SEEN_F, 'utf8').split(/\r?\n/).filter(Boolean) : []);

// ── 입력 모으기
const caps = {}; const codeOf = new Map(); let scanned = 0, picked = 0, skipAgg = 0, skipSeen = 0, skipExc = 0;
for (let d = 0; d < DAYS; d++) {
  const day = new Date(KST().getTime() - d * 864e5).toISOString().slice(0, 10);
  const f = path.join(DIR, `${day}.jsonl`);
  if (!fs.existsSync(f)) continue;
  for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let o; try { o = JSON.parse(line); } catch { continue; }
    const cap = o.cap || '';
    const h = (o.u || '').replace(/^@+/, '').toLowerCase();
    if (!h || !cap) continue;
    scanned++;
    if (AGG.test(h)) { skipAgg++; continue; }                      // 집계계정은 단서일 뿐 (규칙 8)
    if (EXCLUDED.has(h)) { skipExc++; continue; }
    // 🔴 2026-09-30 실측: "날짜줄 3개 이상"만으로 통과시키니 **공구 셀러가 아닌 계정**이 통째로 들어왔다 —
    //    독산청년(doksanyouth)·판교어린이집(pangyodaycare)·이비인후과(j.entclinic)·치과(baesebok_dental)가
    //    올린 행사·진료 일정이 「7090콘서트 : 인순이」·「무학중 학교시험 대비 특강」으로 후보에 떴다.
    //    🔴🔴 2026-10-01 사장님 지시로 **「공구 낱말이 있어야 한다」를 없앴다** —
    //       *"공구라는 낱말 없으면 버리라는게 무슨 이상한 규칙이야 그딴 규칙 없애"*
    //       셀러는 달력에 「10월 일정」만 쓰고 「공구」를 안 쓰는 경우가 흔하다.
    //       → 낱말을 **요구하지 않는다.** 공구 셀러가 아닌 계정은 **계정 명단으로만** 막는다:
    //         scratchpad/calendar_not_sellers.txt (사람이 보고 한 줄 추가).
    //         업종 낱말 차단(병원·학원·약국…)은 재봤다가 **되돌렸다** — 위 :55 주석 참조
    //         (피드 쪽에서 재니 정상 공구 24건이 죽었다). 코드에도 없다.
    const lines = cap.split('\n').map((x) => x.trim()).filter(Boolean);
    const dateLines = lines.filter((x) => DATE_LINE.test(x)).length;
    if (!(CAL_MARK.test(cap) && dateLines >= 2) && dateLines < 3) continue;
    if (o.code && seen.has(o.code)) { skipSeen++; continue; }
    picked++;
    // 같은 셀러 글이 여러 개면 이어 붙인다 (파서는 핸들 하나에 캡션 하나를 받는다)
    caps[h] = caps[h] ? caps[h] + '\n' + cap : cap;
    if (o.code) { seen.add(o.code); codeOf.set(o.code, h); }   // 어느 셀러 게시물인지 기억 — 0건이면 seen 에서 뺀다
  }
}
log(`게시물 ${scanned}건 훑음 → 달력 글 ${picked}건 · 셀러 ${Object.keys(caps).length}명 (집계 ${skipAgg} · 제외셀러·비셀러 ${skipExc} · 이미 뽑음 ${skipSeen})`);
if (!picked) { log('달력 글 0건 — 끝'); process.exit(0); }

const capF = path.join(DIR, `_cal_${today}_${stamp}.json`);
const tsvF = path.join(DIR, `_cal_${today}_${stamp}.tsv`);
fs.writeFileSync(capF, JSON.stringify(caps, null, 1), 'utf8');

// ── 달력 파서 (기존 도구 — 여기서 로직을 베끼지 않는다)
const out = execFileSync(NODE, [path.join(ROOT, 'scratchpad', '_calendar_parse.mjs'), capF, tsvF], { encoding: 'utf8', cwd: ROOT });
// 🔴 2026-10-01 검증자 지적: 전엔 `|| [,'0']` 폴백이라 **파서 출력 문구가 바뀌면 got='0'** 이 되어
//    「뽑힌 일정 0건 — 끝」이라고 정상처럼 적고 끝났다. 문구를 못 읽으면 **TSV 행 수로 다시 센다.**
let got = (out.match(/달력에서 뽑은 일정 (\d+)건/) || [])[1];
if (got === undefined) {
  const rows = fs.existsSync(tsvF) ? fs.readFileSync(tsvF, 'utf8').split(/\r?\n/).filter((x) => x.trim()).length : 0;
  log(`⚠ 파서 출력에서 건수를 못 읽었다 (문구가 바뀌었나?) — TSV 행 수로 센다: ${rows}건`);
  got = String(rows);
}
log(`달력 파싱 ${got}건 → ${path.basename(tsvF)}`);
for (const l of out.split('\n').filter((x) => /^\s{2}\d{4}-/.test(x)).slice(0, 12)) log('   ' + l.trim());
// 🔴🔴 2026-10-01 검증자 실측: 전엔 **0건이어도 seen 에 박아** 그 게시물을 영원히 다시 안 봤다.
//    91명 중 51명이 그렇게 묻혔고, 그 안에 파서 주석이 「월/일꼴만 써서 0건이었다」고 직접 지목한
//    `kongal.pick`(콩알픽)이 있었다. **파서를 고쳐도 그 게시물은 다시 안 읽힌다.**
//    규칙 0-P 「수확 0건 = 일정 없음이 아니다」가 코드에 반대로 박혀 있었다.
//    → **일정이 나온 게시물만** seen 에 넣는다. 0건이면 다음 회차에 다시 본다.
const gotHandles = new Set();
if (+got) for (const l of fs.readFileSync(tsvF, 'utf8').split(/\r?\n/)) { const h = l.split('\t')[0]; if (h) gotHandles.add(h); }
const keepSeen = [...seen].filter((c) => !codeOf.has(c) || gotHandles.has(codeOf.get(c)));
if (!+got) { log(`뽑힌 일정 0건 — 끝 (이번에 본 게시물 ${picked}건은 seen 에 넣지 않는다 — 파서를 고치면 다시 본다)`); process.exit(0); }
if (DRY) { log(`--dry — 여기서 멈춘다 (TSV: ${tsvF})`); process.exit(0); }
log(`seen 저장 ${keepSeen.length}건 (일정이 나온 셀러 ${gotHandles.size}명분만 — 0건 셀러는 다시 본다)`);
fs.writeFileSync(SEEN_F, keepSeen.join('\n') + '\n');

// 📋 달력 셀러 명단 갱신 (사장님 지시 2026-10-01 — 달력 올리는 셀러를 기억해 매달 챈다)
//    명단: scratchpad/calendar_sellers.tsv · 이번 달 빈 셀러: `--gaps`
try {
  const r = execFileSync(NODE, [path.join(ROOT, 'tools', 'daily', 'calendar_roster.mjs'), '--add', tsvF], { encoding: 'utf8', cwd: ROOT });
  for (const l of r.split('\n').filter((x) => x.trim()).slice(0, 3)) log('📋 ' + l.trim());
} catch (e) { log('⚠ 명단 갱신 실패 — ' + String(e.message).split('\n')[0]); }

// ── 기존 수확 파이프라인에 그대로 얹는다
// 자식이 죽으면 **무엇이 왜 죽었는지** 로그에 남기고 회차를 1 로 끝낸다 (조용히 넘어가지 않는다)
const run = (script, args) => {
  try { return execFileSync(NODE, [path.join(ROOT, script), ...args], { encoding: 'utf8', cwd: ROOT }); }
  catch (e) {
    log(`🔴 ${script} 실패 (코드 ${e.status}) — ${String(e.stderr || e.stdout || e.message).split('\n').slice(0, 4).join(' | ')}`);
    process.exit(1);
  }
};
run('scratchpad/harvest_clean.mjs', [tsvF, tsvF + '.clean']);
run('scratchpad/harvest_to_table.mjs', [tsvF + '.clean', 'scratchpad/catvocab.json', tsvF + '.md', tsvF + '.uncat']);
const mdRows = (fs.readFileSync(tsvF + '.md', 'utf8').match(/^\| \d+ \|/gm) || []).length;
const unc = fs.existsSync(tsvF + '.uncat') ? (fs.readFileSync(tsvF + '.uncat', 'utf8').split('\n').filter((x) => x.trim()).length) : 0;
log(`분류 ${mdRows}건 · 미분류 ${unc}건`);
if (!mdRows) { log('분류된 행 0 — 끝'); process.exit(0); }

// 게이트는 표가 scratchpad/ 바로 아래 있어야 한다 (내부에서 basename 으로 경로를 다시 만든다)
const pend = path.join(ROOT, 'scratchpad', `승인대기_달력_${today}_${stamp}.md`);
fs.renameSync(tsvF + '.md', pend);
// 🔴 핸들 정정 + **한글명 채움** — 빼먹으면 셀러 칸이 전부 비고, 등록기가 그 행을 전부 버린다
//    (2026-09-30 첫 회차에서 178건 모두 셀러 칸이 비어 나왔다. ig_feed_pipeline.sh 에는 이 단계가 있다)
run('scratchpad/fix_handles_names.mjs', [pend]);
run('scratchpad/drop_ended.mjs', [pend]);
run('scratchpad/pending_dedupe.mjs', [pend]);
const left = (fs.readFileSync(pend, 'utf8').match(/^\| \d+ \|/gm) || []).length;
log(`마감·중복 걷어낸 뒤 ${left}건 → ${path.basename(pend)}`);
log('🟡 게이트·등록은 세션이 이어서 한다 (INSERT 는 사장님 "올려" 뒤 — 규칙 09-17)');
