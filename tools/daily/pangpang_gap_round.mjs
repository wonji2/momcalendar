// ♻ 공구팡팡 갭 회차 — 1시간마다: 팡팡 오늘~모레 오퍼와 우리 DB 를 대조하고, 빠진 셀러만 수확·등록한다
//   (사장님 2026-10-15 "파싱이어서 계속 돌려 공구팡팡 오늘 갯수보고 우리도 맞춰서 계속 스윕해")
//
//   ① pangpang_gap.mjs      → scratchpad/_todo_pp_gap.txt (우리에게 없는 셀러·상품의 핸들)
//   ② parsing_nightly.mjs --todo 그 명단 → 수확·게이트·등록 (같은 체인)
//
// 🔴 parsing_nightly 는 잠금이 없고 게이트 임시파일 이름이 고정이라 **동시에 두 개가 돌면 섞인다**
//    → 정규 회차(3시간마다 :40)와 겹치지 않게 :05 에 돌고, 다른 회차 로그가 최근 20분 안에 갱신됐으면 건너뛴다.
// 실행: 윈도우 예약작업 momcal-pangpang-gap (매시 :05) · 로그 scratchpad/pangpang_gap_log.txt
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..');
const LOG = path.join(ROOT, 'scratchpad', 'pangpang_gap_log.txt');
const log = (s) => { const t = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' '); try { fs.appendFileSync(LOG, `[${t}] ${s}\n`); } catch { } console.log(s); };

// 다른 파싱 회차가 도는 중이면 양보
const busy = ['parsing_nightly_log.txt', 'ig_feed_pipeline_log.txt', 'gongtok_round_log.txt']
  .map((f) => { try { return Date.now() - fs.statSync(path.join(ROOT, 'scratchpad', f)).mtimeMs; } catch { return Infinity; } })
  .some((age) => age < 20 * 60e3);
if (busy) { log('다른 파싱 회차가 최근 20분 안에 돌았다 — 이번 회차는 건너뛴다'); process.exit(0); }

const run = (script, args, timeoutMs) => spawnSync(process.execPath, [path.join(ROOT, 'tools', 'daily', script), ...args], { cwd: ROOT, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 64e6 });
const g = run('pangpang_gap.mjs', ['--days', '3'], 5 * 60e3);
if (g.status !== 0) { log('⚠ 갭 비교 실패: ' + String(g.stderr || g.stdout).split('\n').slice(-3).join(' ').slice(0, 200)); process.exit(1); }
const todo = path.join(ROOT, 'scratchpad', '_todo_pp_gap.txt');
const n = fs.existsSync(todo) ? fs.readFileSync(todo, 'utf8').split('\n').filter(Boolean).length : 0;
if (!n) { log('갭 0 — 수확할 셀러 없음'); process.exit(0); }
const p = run('parsing_nightly.mjs', ['--todo', todo, '--n', '60'], 40 * 60e3);
const tail = String(p.stdout || '').split('\n').filter((l) => /⑥|✅|⚠/.test(l)).slice(-4).join(' | ');
log(`수확 ${n}명 → exit ${p.status} · ${tail.slice(0, 260)}`);
