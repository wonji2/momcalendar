/**
 * 🔎 **이번 달 달력이 비어 있는 달력셀러를 직접 찾아간다** — 매달 정기업무
 *
 * 사장님 지시 2026-10-01:
 *   "달력 9월에 파싱했던 모든셀러 다 찾아서 그 사람들은 앞으로도 계속 달력으로 올리니까
 *    기억해뒀다가 매달 달력파싱 작업도 정기업무로 넣어서 하면 되잖아"
 *
 * 흐름:  calendar_roster --gaps (이번 달 달력 없는 셀러)
 *        → 그 셀러 **프로필 바이오**를 로그인 없이 읽는다 (2026-09-30 실측: 60명 중 59명 성공 · 429 0)
 *        → 바이오에 월간 일정이 그대로 있는 셀러가 있다 (saedek_oins: 「5일 흡착다리미 / 8일 보이러 전기요 …」)
 *        → 같은 달력 파서(`scratchpad/_calendar_parse.mjs`)에 넣어 일정으로 뽑는다
 *        → harvest_clean → harvest_to_table → fix_handles_names → 게이트 → 승인표
 *
 * 왜 바이오인가: 달력 **게시물**은 피드 스윕이 이미 훑는다. 못 잡은 셀러는
 *   ① 달력을 게시물이 아니라 **바이오·링크에 둔 셀러**이거나 ② 아직 안 올린 셀러다.
 *   ①은 여기서 잡고, ②는 남은 명단으로 남아 다음 회차에 다시 본다.
 *
 *   node tools/daily/calendar_gap_hunt.mjs [--n 80] [--gap 2000] [--dry]
 * 상태: scratchpad/ig_bio/bios.jsonl (원문 보관 — 메모리 collect-everything-always)
 * 로그: scratchpad/calendar_gap_log.txt
 * 주기: 윈도우 예약작업 momcal-cal-gap — 매달 1~5일 09:40 (달력은 월초에 올라온다)
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..');
const NODE = 'C:/Users/FAMILY/node-portable/node-v24.18.0-win-x64/node.exe';
const BIO_DIR = path.join(ROOT, 'scratchpad', 'ig_bio');
const LOG_F = path.join(ROOT, 'scratchpad', 'calendar_gap_log.txt');
fs.mkdirSync(BIO_DIR, { recursive: true });

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const N = +arg('--n', 80), GAP = +arg('--gap', 2000), DRY = process.argv.includes('--dry');
const KST = () => new Date(Date.now() + 9 * 3600e3);
const today = KST().toISOString().slice(0, 10);
const stamp = KST().toISOString().slice(11, 16).replace(':', '');
const log = (s) => { const l = `[${today} ${KST().toISOString().slice(11, 16)}] ${s}`; console.log(l); try { fs.appendFileSync(LOG_F, l + '\n'); } catch { } };

const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const dec = (s) => s
  .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
  .replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#064;/g, '@');

// ① 빈 셀러 명단을 받는다
const gapsOut = execFileSync(NODE, [path.join(ROOT, 'tools', 'daily', 'calendar_roster.mjs'), '--gaps'], { encoding: 'utf8', cwd: ROOT });
const thisMonth = KST().toISOString().slice(0, 7);
const gapF = path.join(ROOT, 'scratchpad', `calendar_gaps_${thisMonth}.txt`);
if (!fs.existsSync(gapF)) { log('빈 셀러 명단 파일이 없다 — 끝'); process.exit(0); }
const gaps = fs.readFileSync(gapF, 'utf8').split(/\r?\n/).filter(Boolean).slice(0, N);
log(`이번 달(${thisMonth}) 달력 없는 달력셀러 ${gaps.length}명 — 바이오를 읽는다 (간격 ${GAP}ms)`);

// ② 바이오를 로그인 없이 읽는다
const caps = {}; let ok = 0, bad = 0, wall = 0, empty = 0;
for (const h of gaps) {
  if (DRY) break;
  try {
    const r = await fetch(`https://www.instagram.com/${h}/`, { headers: { 'user-agent': UA } });
    const t = await r.text();
    if (!r.ok) { bad++; if (r.status === 429) { log('⛔ 429 — 레이트 한도. 중단한다'); break; } await new Promise((s) => setTimeout(s, GAP)); continue; }
    // 로그인 벽 판별: 정상 프로필은 80만자 안팎 + og:title 이 있다
    if (t.length < 200000 || !/<meta property="og:title"/.test(t)) {
      wall++; if (wall >= 3) { log('⛔ 로그인벽 3연속 — 중단한다'); break; }
      await new Promise((s) => setTimeout(s, GAP)); continue;
    }
    wall = 0;
    const m = t.match(/on Instagram:\s*&quot;([\s\S]*?)&quot;/);
    if (!m) { empty++; await new Promise((s) => setTimeout(s, GAP)); continue; }
    const bio = dec(m[1]);
    const og = (t.match(/<meta property="og:title" content="([^"]*)"/) || [, ''])[1];
    ok++;
    fs.appendFileSync(path.join(BIO_DIR, 'bios.jsonl'), JSON.stringify({ h, bio, og: dec(og), at: new Date().toISOString() }) + '\n');
    // 날짜줄이 2개 이상일 때만 달력으로 본다 (한 줄은 단건 공구 안내일 뿐이다)
    const dl = bio.split('\n').filter((x) => /^[^0-9\n]{0,4}\d{1,2}\s*(?:[\/.]\s*\d{1,2}|월\s*\d{1,2}\s*일?|일\b)/.test(x.trim())).length;
    if (dl >= 2) caps[h] = bio;
  } catch (e) { bad++; }
  await new Promise((s) => setTimeout(s, GAP));
}
log(`바이오 읽음 ${ok} · 패턴없음 ${empty} · 실패 ${bad} · 로그인벽 ${wall}`);
log(`바이오에 일정표가 있는 셀러 ${Object.keys(caps).length}명`);
if (!Object.keys(caps).length) { log('바이오 일정 0건 — 끝 (남은 명단은 다음 회차에 다시 본다)'); process.exit(0); }
if (DRY) { log('--dry — 여기서 멈춘다'); process.exit(0); }

// ③ 같은 달력 파서에 넣는다 (여기서 파싱 규칙을 베끼지 않는다)
const capF = path.join(BIO_DIR, `_biocal_${today}_${stamp}.json`);
const tsvF = path.join(BIO_DIR, `_biocal_${today}_${stamp}.tsv`);
fs.writeFileSync(capF, JSON.stringify(caps, null, 1), 'utf8');
const out = execFileSync(NODE, [path.join(ROOT, 'scratchpad', '_calendar_parse.mjs'), capF, tsvF], { encoding: 'utf8', cwd: ROOT });
const got = (out.match(/달력에서 뽑은 일정 (\d+)건/) || [, '0'])[1];
log(`바이오 달력 파싱 ${got}건`);
for (const l of out.split('\n').filter((x) => /^\s{2}\d{4}-/.test(x)).slice(0, 10)) log('   ' + l.trim());
if (!+got) { log('뽑힌 일정 0건 — 끝'); process.exit(0); }

const run = (s, a) => execFileSync(NODE, [path.join(ROOT, s), ...a], { encoding: 'utf8', cwd: ROOT });
run('scratchpad/harvest_clean.mjs', [tsvF, tsvF + '.clean']);
run('scratchpad/harvest_to_table.mjs', [tsvF + '.clean', 'scratchpad/catvocab.json', tsvF + '.md', tsvF + '.uncat']);
const rows = (fs.readFileSync(tsvF + '.md', 'utf8').match(/^\| \d+ \|/gm) || []).length;
if (!rows) { log('분류된 행 0 — 끝'); process.exit(0); }
const pend = path.join(ROOT, 'scratchpad', `승인대기_바이오달력_${today}_${stamp}.md`);
fs.renameSync(tsvF + '.md', pend);
run('scratchpad/fix_handles_names.mjs', [pend]);
run('scratchpad/drop_ended.mjs', [pend]);
run('scratchpad/pending_dedupe.mjs', [pend]);
try { run('tools/daily/calendar_roster.mjs', ['--add', tsvF]); } catch { }
const left = (fs.readFileSync(pend, 'utf8').match(/^\| \d+ \|/gm) || []).length;
log(`🟡 ${left}건 승인 대기 → ${path.basename(pend)} (게이트·등록은 세션이 이어서 한다)`);
