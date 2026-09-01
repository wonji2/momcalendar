/**
 * 밤샘 인포크 파싱 — 사람·Claude 앱 없이 (사장님 지시 2026-09-01
 *   "수동절차 다 없애고 앱 삭제했다 재설치해도 자동으로 계속 돌아가는 시스템")
 *
 * 왜: 이 일을 하던 `night-parsing` 은 **Claude 앱 예약작업**이었고, 앱 예약작업은
 *     지금까지 4번 통째로 사라졌다(8/25·8/27·8/31·9/1). 인포크 수확은 로그인이
 *     필요 없는 순수 HTTP 라 윈도우 예약작업으로 옮기면 앱과 무관하게 돈다.
 *     (인스타 피드·바이오 수확은 로그인 브라우저가 필요해 여기 넣지 못한다 — 그건 세션 몫)
 *
 * 흐름  ① 인포크 수확 → ② 세척 → ③ 자동분류 → ④ 누적 승인표에 병합(없는 것만)
 *       등록은 하지 않는다. 사장님 승인이 필요한 단계라 승인표까지만 쌓아둔다.
 *
 * 실행  node tools/daily/parsing_nightly.mjs         (예약작업 momcal-night-parsing 이 매일 부른다)
 *       node tools/daily/parsing_nightly.mjs --n 200 (그날 확인할 셀러 수, 기본 400)
 * 로그  scratchpad/parsing_nightly_log.txt
 * 상태  scratchpad/_inpock_seen_auto.txt  (이미 확인한 핸들 — 다음 회차는 그 다음부터)
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync, appendFileSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..', '..');
const SP = (f) => path.join(ROOT, 'scratchpad', f);
const NODE = process.execPath;
const LOG = SP('parsing_nightly_log.txt');
const N = Number((process.argv.find(a => a === '--n') ? process.argv[process.argv.indexOf('--n') + 1] : 0)) || 400;

const log = (s) => {
  const t = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');
  try { appendFileSync(LOG, `[${t}] ${s}\n`); } catch (_) {}
  console.log(s);
};
const run = (args, timeout = 1800e3) =>
  execFileSync(NODE, args, { encoding: 'utf8', timeout, cwd: ROOT, maxBuffer: 64 * 1024 * 1024 });

try {
  // 0) 대상 명단 — DB 의 활성 셀러 핸들 (로그인 불필요, 공개 REST)
  const KEY = 'sb_publishable_u4hR4mdNTSss3kdjFH6R5Q_iuJ2MuGE';
  const API = 'https://hycaqsqeogjtbscmzrtm.supabase.co/rest/v1/gonggu';
  const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  const since = new Date(Date.now() + 9 * 3600e3 - 90 * 864e5).toISOString().slice(0, 10);
  let handles = new Set();
  for (let from = 0; from < 6000; from += 1000) {
    const r = await fetch(`${API}?select=insta&open_date=gte.${since}&limit=1000&offset=${from}`, { headers: { apikey: KEY } });
    const p = await r.json();
    if (!Array.isArray(p) || !p.length) break;
    p.forEach(x => { const h = String(x.insta || '').trim(); if (h) handles.add(h); });
    if (p.length < 1000) break;
  }
  const seenF = SP('_inpock_seen_auto.txt');
  const seen = existsSync(seenF) ? new Set(readFileSync(seenF, 'utf8').split(/\r?\n/).filter(Boolean)) : new Set();
  let todo = [...handles].filter(h => !seen.has(h));
  if (!todo.length) {           // 한 바퀴 다 돌았으면 처음부터 다시
    log(`한 바퀴 완주 — seen 초기화 후 재시작 (전체 ${handles.size}명)`);
    writeFileSync(seenF, '', 'utf8');
    todo = [...handles];
  }
  todo = todo.slice(0, N);
  const todoF = SP('_pn_todo.txt');
  writeFileSync(todoF, todo.join('\n'), 'utf8');
  log(`시작 — 대상 ${todo.length}명 (전체 ${handles.size}명 중 미확인 우선)`);

  // ① 수확 → ② 세척 → ③ 분류 → ④ 병합
  const outF = SP('_pn_out.tsv'), cleanF = SP('_pn_clean.tsv'),
        tableF = SP('_pn_table.md'), unclsF = SP('_pn_uncls.tsv');
  run([SP('inpock_harvest.mjs'), todoF, outF, seenF, String(todo.length)]);
  const got = existsSync(outF) ? readFileSync(outF, 'utf8').split('\n').filter(Boolean).length : 0;
  log(`① 수확 ${got}건`);
  if (!got) { log('= 수확 0건 — 종료'); process.exit(0); }

  run([SP('harvest_clean.mjs'), outF, cleanF]);
  const cleaned = readFileSync(cleanF, 'utf8').split('\n').filter(Boolean).length;
  log(`② 세척 ${cleaned}건`);

  run([SP('harvest_to_table.mjs'), cleanF, SP('catvocab.json'), tableF, unclsF]);
  const rows = existsSync(tableF) ? readFileSync(tableF, 'utf8').split('\n').filter(l => l.startsWith('|') && !/^\|\s*[-#]/.test(l)).length : 0;
  log(`③ 자동분류 ${rows}행`);

  run([SP('merge_pending.mjs'), tableF, SP('승인대기_누적.md')]);
  const acc = existsSync(SP('승인대기_누적.md'))
    ? readFileSync(SP('승인대기_누적.md'), 'utf8').split('\n').filter(l => l.startsWith('|') && !/^\|\s*[-#]/.test(l)).length : 0;
  log(`④ 병합 완료 — 누적 승인표 ${acc}행`);
  log(`✅ 끝. 등록은 사람이 승인한 뒤에 한다(이 스크립트는 승인표까지만 쌓는다).`);
} catch (e) {
  log(`🔴 실패: ${String(e.message).slice(0, 200)}`);
  process.exit(1);
}
