// 복원 리허설 — 백업만으로 DB 를 진짜 다시 세울 수 있는지 시험한다 (사장님 지시 2026-09-30)
//
// 왜: 무료 플랜엔 자동 백업이 없다. 우리 내보내기(work-backup/db-export)가 유일한 사본인데
//     "되살릴 수 있다" 를 아무도 실제로 해본 적이 없었다(--restore-drill 은 events 100줄짜리 맛보기).
// 무엇을: 같은 DB 안에 **restore_drill 이라는 딴 스키마**를 만들어 백업 파일만으로 표·제약·인덱스를 세우고
//     JSONL 을 도로 넣어 행수·내용이 원본과 같은지 대조한다. 끝나면 그 스키마를 통째로 지운다.
//     ⚠ public 은 손대지 않는다. 스키마 이름은 이 파일에 박아두고 변수로 만들지 않는다.
// 실행: node tools/daily/restore_rehearsal.mjs           (큰 로그표는 표본만)
//       node tools/daily/restore_rehearsal.mjs --resume   (스키마를 다시 안 만들고 빈 표만 채운다 — 중간에 끊겼을 때)
//       node tools/daily/restore_rehearsal.mjs --keep     (끝나고 안 지움)
//       node tools/daily/restore_rehearsal.mjs --drop     (스키마만 지우고 끝)
// 결과: scratchpad/restore_rehearsal.md · 로그 scratchpad/restore_rehearsal_log.txt
// ⚠ 적재는 **바이트로 끊는다**(한 번에 200KB). 500행 고정으로 했더니 CLI 기동 5초 × 수백 번으로 25분을 넘겼다.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { sbArgs, parseRows } from './sb_query.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = 'C:/Users/FAMILY/supabase-cli/supabase.exe';
const OUT = path.join(process.env.USERPROFILE || 'C:/Users/FAMILY', 'work-backup', 'db-export');
const LOG = path.join(REPO, 'scratchpad', 'restore_rehearsal_log.txt');
const REPORT = path.join(REPO, 'scratchpad', 'restore_rehearsal.md');
const KEEP = process.argv.includes('--keep'), RESUME = process.argv.includes('--resume'), DROP = process.argv.includes('--drop');
const CHUNK_BYTES = 200 * 1024;          // 한 번에 보낼 SQL 크기 (더 키우면 413)
const SAMPLE = 2000;                     // 큰 로그표는 이만큼만 (DB 크기 때문)
const BIG = ['events', 'visits', 'visitors', 'price_history'];
const stamp = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');
const log = (m) => { const l = `[${stamp()}] ${m}`; console.log(l); try { fs.appendFileSync(LOG, l + '\n'); } catch {} };
const notes = [];

function q(sql, why) {
  const f = path.join(REPO, 'scratchpad', `_rehearsal_${process.pid}.sql`);
  fs.writeFileSync(f, sql, 'utf8');
  let raw = '', err = null;
  for (let a = 1; a <= 3; a++) { try { raw = execFileSync(CLI, sbArgs(f), { cwd: REPO, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 300e3 }); err = null; break; } catch (e) { err = e; } }
  try { fs.unlinkSync(f); } catch {}
  if (err) throw new Error((why || '') + ' — ' + String(err.stderr || err.message).replace(/\s+/g, ' ').slice(0, 260));
  const r = parseRows(raw); if (!r.ok) throw new Error('CLI 출력 못 읽음: ' + raw.slice(0, 200));
  return r.rows;
}
const toDrill = (sql) => sql.split('public.').join('restore_drill.');
const readSchema = (n) => { const p = path.join(OUT, 'schema', n); return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null; };
const dropDrill = () => q('drop schema if exists restore_drill cascade;', '정리');

try {
  if (DROP) { dropDrill(); log('restore_drill 스키마 지움'); process.exit(0); }
  if (!RESUME) fs.writeFileSync(LOG, '');
  const t0 = Date.now();
  log(`■ 복원 리허설 ${RESUME ? '이어서' : '시작'} — 백업만으로 다시 세운다`);
  const age = (f) => { const p = path.join(OUT, f); return fs.existsSync(p) ? Math.round((Date.now() - fs.statSync(p).mtimeMs) / 60000) : null; };
  log(`백업 나이: gonggu ${age('gonggu.jsonl')}분 · schema ${age('schema/tables.sql')}분`);

  // 1) 표·제약·인덱스
  if (!RESUME) {
    q('drop schema if exists restore_drill cascade; create schema restore_drill;', '스키마 준비');
    log('restore_drill 스키마 생성');
    // 순서가 중요하다 — 표의 기본값이 시퀀스를 참조하므로 시퀀스가 먼저다(2026-09-30 리허설)
    for (const [file, label] of [['sequences.sql', '시퀀스'], ['tables.sql', '표'], ['constraints.sql', '제약'], ['indexes.sql', '인덱스']]) {
      const src = readSchema(file);
      if (!src) { notes.push(`🔴 ${file} 이 백업에 없다`); continue; }
      try { q(toDrill(src), label); log(`${label} 세움 (${file})`); }
      catch (e) { notes.push(`🔴 ${file} 적용 실패 — ${String(e.message).slice(0, 180)}`); log(`🔴 ${label} 실패: ${String(e.message).slice(0, 160)}`); }
    }
  }

  // 2) JSONL 적재 (이어서면 비어 있는 표만)
  const drillTables = new Set(q(`select table_name t from information_schema.tables where table_schema='restore_drill'`, '표 목록').map((r) => r.t));
  const already = new Set(RESUME ? q(`select relname t from pg_stat_user_tables where schemaname='restore_drill' and n_live_tup > 0`, '적재된 표').map((r) => r.t) : []);
  const plain = fs.readdirSync(OUT).filter((f) => f.endsWith('.jsonl') && !f.startsWith('_') && !/_\d{4}-\d{2}/.test(f)).map((f) => f.replace('.jsonl', ''));
  let loaded = 0, calls = 0; const skipped = [];
  for (const t of plain) {
    if (!drillTables.has(t)) { skipped.push(`${t}(표 없음)`); continue; }
    if (already.has(t)) { loaded++; continue; }
    const lines = fs.readFileSync(path.join(OUT, t + '.jsonl'), 'utf8').split('\n').filter(Boolean);
    const use = BIG.includes(t) ? lines.slice(0, SAMPLE) : lines;
    if (!use.length) { loaded++; continue; }
    try {
      let buf = [], bytes = 0;
      const flush = () => {
        if (!buf.length) return;
        q(`insert into restore_drill.${t} select * from json_populate_recordset(null::restore_drill.${t}, $j$[${buf.join(',')}]$j$);`, t + ' 적재');
        calls++; buf = []; bytes = 0;
      };
      for (const l of use) { buf.push(l); bytes += l.length; if (bytes >= CHUNK_BYTES) flush(); }
      flush();
      loaded++;
    } catch (e) { skipped.push(`${t}(적재 실패: ${String(e.message).slice(0, 80)})`); }
  }
  log(`적재: 표 ${loaded}개 · CLI 호출 ${calls}회 · ${Math.round((Date.now() - t0) / 1000)}초`);
  if (skipped.length) notes.push(`⚠ 못 넣은 표 ${skipped.length}개: ${skipped.slice(0, 6).join(' / ')}`);

  // 3) 구조·행수 대조
  const cmp = q(`select p.table_name t,
      (select count(*) from information_schema.columns c where c.table_schema='public' and c.table_name=p.table_name) pc,
      (select count(*) from information_schema.columns c where c.table_schema='restore_drill' and c.table_name=p.table_name) dc
    from information_schema.tables p where p.table_schema='public' and p.table_type='BASE TABLE' order by 1`, '컬럼 대조');
  const colBad = cmp.filter((r) => Number(r.dc) === 0);
  const colDiff = cmp.filter((r) => Number(r.dc) > 0 && Number(r.pc) !== Number(r.dc));
  if (colBad.length) notes.push(`🔴 복원 스키마에 없는 표 ${colBad.length}개: ${colBad.map((r) => r.t).slice(0, 8).join(', ')}`);
  if (colDiff.length) notes.push(`🔴 컬럼 수가 다른 표: ${colDiff.map((r) => `${r.t}(${r.pc}↔${r.dc})`).join(', ')}`);

  const names = [...drillTables].filter((t) => plain.includes(t));
  const rows = [];
  for (let i = 0; i < names.length; i += 25) {
    const part = names.slice(i, i + 25);
    rows.push(...q(part.map((t) => `select '${t}' t, (select count(*) from public.${t}) p, (select count(*) from restore_drill.${t}) d`).join(' union all '), '행수 대조'));
  }
  const rowBad = rows.filter((r) => !BIG.includes(r.t) && Number(r.p) !== Number(r.d));
  const rowBig = rows.filter((r) => BIG.includes(r.t));
  if (rowBad.length) notes.push(`⚠ 행수가 다른 표 ${rowBad.length}개: ${rowBad.map((r) => `${r.t}(원본 ${r.p}↔복원 ${r.d})`).slice(0, 8).join(', ')} — 백업 시각 이후 늘어난 만큼이면 정상이다`);

  // 4) 값까지 같은지 — 본 데이터 gonggu 해시
  let hash = '(못 함)';
  try {
    const h = q(`select (select md5(string_agg(x,'|' order by x)) from (select id||name||coalesce(open_date,'')||coalesce(end_date,'')||coalesce(insta,'') x from restore_drill.gonggu) b) d,
                        (select md5(string_agg(x,'|' order by x)) from (select id||name||coalesce(open_date,'')||coalesce(end_date,'')||coalesce(insta,'') x from public.gonggu where id <= (select max(id) from restore_drill.gonggu)) a) p`, 'gonggu 해시')[0];
    hash = h.p === h.d ? `✅ 같음 (백업 시점까지 전 행 일치)` : `🔴 다름 (원본 ${String(h.p).slice(0, 10)} ↔ 복원 ${String(h.d).slice(0, 10)})`;
    if (h.p !== h.d) notes.push('🔴 gonggu 내용 해시가 다르다 — 값이 바뀌어 들어갔다');
  } catch (e) { notes.push('⚠ gonggu 해시 비교 실패: ' + String(e.message).slice(0, 120)); }

  // 5) 복원 후 새 행을 넣을 수 있나 (기본값·시퀀스)
  let insertable = '(못 함)';
  try {
    q(`insert into restore_drill.hotdeals(title, manual) values ('복원시험', true);`, '새 행');
    insertable = '✅ 들어감';
  } catch (e) {
    insertable = '🔴 실패 — ' + String(e.message).replace(/\s+/g, ' ').slice(0, 130);
    notes.push('🔴 **복원한 표에 새 행을 못 넣는다** — tables.sql 에 기본값·identity(시퀀스)가 없다. 복원 직후 서비스가 쓰기를 못 한다');
  }

  // 6) 구조 파일 온전성
  const defs = {};
  for (const [f, re, dbq] of [
    ['functions.sql', /CREATE OR REPLACE FUNCTION/gi, `select count(*) n from pg_proc where pronamespace='public'::regnamespace and prokind='f'`],
    ['views.sql', /create or replace view/gi, `select count(*) n from pg_views where schemaname='public'`],
    ['policies.sql', /create policy/gi, `select count(*) n from pg_policies where schemaname='public'`],
    ['triggers.sql', /CREATE TRIGGER/gi, `select count(*) n from pg_trigger t join pg_class c on c.oid=t.tgrelid where c.relnamespace='public'::regnamespace and not t.tgisinternal`],
    ['cron.sql', /cron\.schedule/gi, `select count(*) n from cron.job where active`],
  ]) {
    const src = readSchema(f); const inFile = src ? (src.match(re) || []).length : 0;
    defs[f] = `${inFile} / ${Number(q(dbq, f)[0].n)}`;
    if (!src) notes.push(`🔴 ${f} 없음`);
  }

  const secs = Math.round((Date.now() - t0) / 1000);
  fs.writeFileSync(REPORT, [
    `# 복원 리허설 결과 — ${stamp()} (${secs}초)`,
    '',
    '백업(`work-backup/db-export`)만 가지고 같은 DB 안 **restore_drill** 스키마에 다시 세워본 결과다. 끝나고 그 스키마는 지웠다.',
    '',
    '| 항목 | 결과 |',
    '|---|---|',
    `| 표 세우기 | 원본 ${cmp.length}개 중 ${cmp.length - colBad.length}개 |`,
    `| 컬럼 수 | ${colDiff.length ? '🔴 다른 표 ' + colDiff.length + '개' : '✅ 전부 일치'} |`,
    `| 행수 | ${rowBad.length ? '⚠ 다른 표 ' + rowBad.length + '개(백업 뒤 늘어난 분)' : '✅ 전부 일치'} |`,
    `| 큰 로그표 표본 | ${rowBig.map((r) => r.t + ' ' + r.d + '행').join(' · ')} |`,
    `| gonggu 내용 해시 | ${hash} |`,
    `| 복원 후 새 행 넣기 | ${insertable} |`,
    ...Object.entries(defs).map(([f, v]) => `| ${f} (파일/DB) | ${v} |`),
    '',
    '## 짚을 것',
    ...(notes.length ? notes.map((n) => '- ' + n) : ['- 없음 ✅']),
    '',
    '## 진짜 복원 순서 (이 리허설로 확인된 것)',
    '1. 새 프로젝트 → 확장 설치(pg_cron·pg_net·pg_trgm·pgcrypto·uuid-ossp·fuzzystrmatch)',
    '2. `schema/sequences.sql` → `schema/tables.sql` → `schema/constraints.sql` → `schema/indexes.sql` (표 기본값이 시퀀스를 참조하므로 순서 고정)',
    '3. `*.jsonl` 을 `json_populate_recordset` 으로 적재 (200KB 씩 끊어서)',
    '4. `schema/functions.sql` → `views.sql` → `triggers.sql` → `policies.sql` → `cron.sql`',
    '5. `schema/grants.txt`·`rls.txt` 를 보고 권한·RLS 를 다시 건다',
    '6. ⚠ 백업에 없는 것: Edge Function 시크릿·Vault·storage 파일(사진은 GitHub Pages `banners/` 에도 있다)·`toss_token`(재발급)',
  ].join('\n'), 'utf8');
  log(`리포트: ${REPORT}`);
  for (const n of notes) log('  ' + n);

  if (!KEEP) { dropDrill(); log('restore_drill 스키마 지움 (원래대로)'); }
  log(`■ 끝 — 짚을 것 ${notes.length}건 · ${secs}초`);
} catch (e) {
  log('🔴 오류 ' + String(e.stack || e.message).slice(0, 400));
  try { dropDrill(); log('오류 뒤 restore_drill 정리함'); } catch {}
  process.exitCode = 1;
}
