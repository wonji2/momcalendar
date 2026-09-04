/**
 * 캡션 자동 적재 — 매일 (사장님 지시 2026-09-01 "캡션도 모으기로 했는데 잘 돌아가고 있나")
 *
 * 왜: 캡션 붙이기가 /파싱 커맨드의 **수동 절차**라 실제로는 안 돌고 있었다.
 *     8/31 소급 1,594건 이후 최근 등록분 938건에 캡션이 0건이었다.
 *     캡션은 gg 상세 페이지의 본문이 되는 SEO 연료다 — 이게 없으면 문서가 얇아
 *     "바크 공구" 같은 브랜드 검색에서 경쟁사에 밀린다(2026-09-01 실측: 우리 미노출).
 *
 * 하는 일
 *   1. scratchpad/caption_attach.mjs 를 돌려 매칭 SQL 을 만든다
 *   2. 그 SQL 을 문장 단위 100개씩 잘라 CLI 로 적용한다
 *      ⚠ 줄 단위로 자르면 안 된다 — 캡션 안에 줄바꿈이 있다
 *   3. 결과를 로그와 health_alerts 에 남긴다
 *
 * 실행:  node tools/daily/caption_daily.mjs        (예약작업 momcal-caption 이 매일 부른다)
 *        node tools/daily/caption_daily.mjs --dry  적재 없이 매칭 건수만
 * 로그:  scratchpad/caption_daily_log.txt
 */
import { execFileSync } from 'node:child_process';
import { sbArgs, parseRows, firstNum } from './sb_query.mjs';
import { readFileSync, writeFileSync, appendFileSync, existsSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..', '..');
const SB = process.env.SUPABASE_CLI || 'C:/Users/FAMILY/supabase-cli/supabase.exe';
const NODE = process.execPath;
const LOG = path.join(ROOT, 'scratchpad', 'caption_daily_log.txt');
const DRY = process.argv.includes('--dry');

const log = (s) => {
  const t = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');
  try { appendFileSync(LOG, `[${t}] ${s}\n`); } catch (_) {}
  console.log(s);
};
const runSql = (file) => execFileSync(SB, sbArgs(file),
  { encoding: 'utf8', timeout: 120000, cwd: ROOT });

function countCaptions() {
  const f = path.join(ROOT, 'scratchpad', '_cap_count.sql');
  writeFileSync(f, "select count(*) filter (where caption is not null and caption<>'') c from gonggu;", 'utf8');
  // 🔴 -1 을 돌려주면 after-before 산술이 통째로 거짓이 된다. 못 읽으면 멈춘다.
  const parsed = parseRows(runSql(f));
  if (!parsed.ok) throw new Error('CLI 출력을 못 읽었다 — ' + parsed.why);
  const c = firstNum(parsed.rows, 'c');
  if (c === null) throw new Error('캡션 건수를 못 읽었다');
  return c;
}

try {
  const before = countCaptions();

  // 1) 매칭 SQL 생성
  const out = execFileSync(NODE, [path.join(ROOT, 'scratchpad', 'caption_attach.mjs')],
    { encoding: 'utf8', timeout: 300000, cwd: ROOT });
  const hit = (out.match(/매칭 성공:\s*(\d+)/) || [])[1];
  const updF = path.join(ROOT, 'scratchpad', '_caption_upd.sql');

  if (!hit || Number(hit) === 0 || !existsSync(updF)) {
    log(`= 새로 붙일 캡션 없음 (현재 ${before}건 보유)`);
    process.exit(0);
  }
  if (DRY) { log(`[dry] 매칭 ${hit}건 — 적재 안 함`); process.exit(0); }

  // 2) 문장 단위 100개씩 적용 (⚠ 줄 단위 금지 — 캡션에 줄바꿈이 있다)
  const stmts = readFileSync(updF, 'utf8').split(/;\s*\n/).filter(x => x.trim());
  let okChunk = 0, failChunk = 0;
  for (let i = 0, n = 0; i < stmts.length; i += 100, n++) {
    const part = path.join(ROOT, 'scratchpad', `_capd_${n}.sql`);
    writeFileSync(part, stmts.slice(i, i + 100).join(';\n') + ';\n', 'utf8');
    try { runSql(part); okChunk++; } catch (e) { failChunk++; log(`  🔴 청크 ${n} 실패: ${String(e.message).slice(0, 90)}`); }
    try { unlinkSync(part); } catch (_) {}
  }

  const after = countCaptions();
  log(`✅ 캡션 ${after - before}건 추가 (${before} → ${after}) · 매칭 ${hit} · 청크 ${okChunk}성공/${failChunk}실패`);

  if (failChunk > 0) {
    const f = path.join(ROOT, 'scratchpad', '_cap_alert.sql');
    writeFileSync(f, `insert into health_alerts(kind, detail) values ('캡션적재실패','청크 ${failChunk}개 실패 — caption_daily_log.txt 확인');`, 'utf8');
    try { runSql(f); } catch (_) {}
  }
} catch (e) {
  log(`🔴 실패: ${String(e.message).slice(0, 160)}`);
  process.exit(1);
}
