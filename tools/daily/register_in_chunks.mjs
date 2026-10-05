/**
 * 승인표를 **조각내어** 등록한다 — 큰 표가 통째로 막히는 것을 막는다
 *
 * 🔴 왜 (2026-10-05 발견)
 *   밤샘 파싱·월초 집중 회차가 몇 주째 **등록 0건**이었다. 로그엔 「등록 단계 실패」만 찍혔다.
 *   재현해 보니 `gen_insert_gonggu.mjs` 는 정상이고(1,755건 SQL 생성), 그 SQL 을 보내는 순간
 *   **`unexpected status 413: request entity too large`** — SQL 이 3.49MB 라 서버가 거부했다.
 *   승인표가 쌓일수록 SQL 이 커져서, 많이 수확할수록 **하나도 못 넣는** 구조였다.
 *
 * 그래서 표를 N행씩 끊어 각각 등록한다. 한 조각이 실패해도 나머지는 들어간다.
 *   ⚠ 헤더는 **조각마다 그대로 붙인다** — 헤더가 다르면 등록기가 값을 한 칸 밀어 쓰레기를 넣는다
 *     (메모리 approval-table-header-trap).
 *   ⚠ 중복검사는 생성된 SQL 안의 `where not exists` 가 한다 — 조각내도 안전하다.
 *
 * 실행: node tools/daily/register_in_chunks.mjs <표.md> [--size=200] [--source=inpock] [--dry]
 * 로그: scratchpad/register_chunks_log.txt
 */
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = process.env.SUPABASE_CLI || 'C:/Users/FAMILY/supabase-cli/supabase.exe';
const NODE = process.execPath;
const GEN = join(ROOT, 'scratchpad', 'gen_insert_gonggu.mjs');
const LOG = join(ROOT, 'scratchpad', 'register_chunks_log.txt');
const NL = String.fromCharCode(10);

const args = process.argv.slice(2);
const table = args.find((a) => !a.startsWith('--'));
const argv = (k, d) => { const a = args.find((x) => x.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : d; };
const SIZE = Number(argv('size', '200')) || 200;
const SOURCE = argv('source', 'inpock');
const DRY = args.includes('--dry');
if (!table) { console.log('표 파일을 주세요: node tools/daily/register_in_chunks.mjs <표.md> [--size=200]'); process.exit(1); }

const log = (s) => {
  const t = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');
  console.log(s);
  try { appendFileSync(LOG, `[${t}] ${s}${NL}`); } catch (_) {}
};

const lines = readFileSync(table, 'utf8').split(/\r?\n/);
// 헤더 = 표가 시작되기 전까지(제목줄 + 칸이름줄 + 구분줄)
const sep = lines.findIndex((l) => /^\|\s*-{2,}/.test(l));
if (sep < 0) { log('🔴 표 구분줄(|---|)을 못 찾았다 — 형식이 다르다'); process.exit(1); }
const head = lines.slice(0, sep + 1);
const rows = lines.slice(sep + 1).filter((l) => /^\|/.test(l.trim()));
log(`표 ${table} — 데이터 ${rows.length}행 · ${SIZE}행씩 ${Math.ceil(rows.length / SIZE)}조각`);

let ok = 0, fail = 0, inserted = 0;
for (let i = 0; i < rows.length; i += SIZE) {
  const part = rows.slice(i, i + SIZE);
  const n = Math.floor(i / SIZE) + 1;
  const tf = join(ROOT, 'scratchpad', `_chunk_${n}.md`);
  const sf = join(ROOT, 'scratchpad', `_chunk_${n}.sql`);
  writeFileSync(tf, head.concat(part).join(NL) + NL, 'utf8');
  try {
    execFileSync(NODE, [GEN, tf, sf, '--source', SOURCE], { encoding: 'utf8', timeout: 300e3, cwd: ROOT });
  } catch (e) { log(`  조각 ${n}: SQL 생성 실패 — ${String(e.message).slice(0, 110)}`); fail++; continue; }
  const kb = Math.round((readFileSync(sf, 'utf8').length) / 1024);
  if (DRY) { log(`  조각 ${n}: ${part.length}행 · SQL ${kb}KB (미리보기라 실행 안 함)`); ok++; continue; }
  try {
    const out = execFileSync(CLI, ['db', 'query', '--linked', '--file', sf], { encoding: 'utf8', timeout: 600e3, cwd: ROOT });
    const m = out.match(/"id"/g);
    inserted += m ? m.length : 0;
    log(`  조각 ${n}: ${part.length}행 · SQL ${kb}KB → 등록 ${m ? m.length : 0}건`);
    ok++;
  } catch (e) {
    const msg = String(e.stdout || '') + String(e.message || '');
    log(`  🔴 조각 ${n} 실패 (${kb}KB): ${msg.replace(/\s+/g, ' ').slice(0, 150)}`);
    fail++;
  }
}
log(`끝 — 조각 ${ok} 성공 · ${fail} 실패 · 새로 등록 ${inserted}건`);
