// DB 내보내기 — Supabase 무료 플랜엔 자동 백업이 없다 (사장님 결정 2026-09-29 "무료 플랜으로")
//
// 흐름: supabase CLI(관리자) 로 표를 JSON Lines 로 받아 work-backup(비공개 레포)/db-export/ 에 쓴다 → backup.ps1 이 매시간 git 으로 올린다.
//   ① 핵심 표(작은 것)   : 매일 통째로  <표>.jsonl  (id 순 → git 이 바뀐 줄만 저장)
//   ② 크고 느린 표(gonggu·gonggu_archive·coupang_watch·seller_profile·gonggu_click_stats·price_history): 일요일만 통째로 (평일에 다 받으면 이 넷만 월 190MB)
//      평일엔 gonggu 새 id 만 gonggu_2026-09.jsonl 에 덧붙인다 — 고친 행은 일요일 판이 담는다
//   ③ 로그성 큰 표       : events·visits·visitors·seller_profile_history — 새 id 만 <표>_<YYYY-MM-DD>.jsonl 에 덧붙임(물 높이 _watermarks.json)
//   ④ 구조               : 함수·정책·뷰·트리거·크론·컬럼·인덱스 → schema/*.sql (되살릴 때 순서: 표 → 함수 → 뷰 → 정책 → 트리거 → 크론)
// 실행: node tools/daily/db_export.mjs           (예약작업 momcal-db-export 매일 04:40, 로그 scratchpad/db_export_log.txt)
//       node tools/daily/db_export.mjs --full     (gonggu 도 통째로)
//       node tools/daily/db_export.mjs --restore-drill  (events 마지막 파일 100줄을 임시 표에 넣어 되읽기 — 백업이 진짜 되살아나는지)
// 전송량: 매일 약 5MB + 일요일 20MB ≈ 월 0.3GB (무료 5GB 안). CLI 경로도 전송량으로 셀 수 있다고 보고 크게 잡았다.
// ⚠ 백업에 못 담는 것: Edge Function 시크릿(CRON_SECRET·카카오·토스·쿠팡 키)·Vault·storage 파일(banners 39MB — 사진은 GitHub Pages banners/ 에도 있다)
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { sbArgs, parseRows } from './sb_query.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = 'C:/Users/FAMILY/supabase-cli/supabase.exe';
const OUT = path.join(process.env.USERPROFILE || 'C:/Users/FAMILY', 'work-backup', 'db-export');
const LOG = path.join(REPO, 'scratchpad', 'db_export_log.txt');
const WM = path.join(OUT, '_watermarks.json');
const FULL = process.argv.includes('--full'), DRILL = process.argv.includes('--restore-drill');
const kst = () => new Date(Date.now() + 9 * 3600e3);
const stamp = () => kst().toISOString().slice(0, 16).replace('T', ' ');
const log = (m) => { const l = `[${stamp()}] ${m}`; console.log(l); try { fs.appendFileSync(LOG, l + '\n'); } catch {} };
fs.mkdirSync(path.join(OUT, 'schema'), { recursive: true });

// 어떤 표를 언제 받을지는 **DB 에서 재서 정한다** — 손으로 적으면 새 표가 조용히 빠진다(실측: events_daily·ops_status 누락)
//   INC(큰 로그성, id 로 새 행만) → WEEKLY(1MB 넘는 표, 일요일만 통째로) → 나머지 전부 매일 통째로
const INC = ['events', 'visits', 'visitors', 'seller_profile_history'];   // id 가 있고 계속 쌓이기만 하는 표
const WEEKLY_MIN_MB = 1;            // 이보다 큰 표는 일요일만 (평일에 다 받으면 gonggu_archive 하나가 월 100MB)
let CORE = [], WEEKLY = ['gonggu'];  // gonggu 는 평일엔 새 id 만(incTable), 일요일엔 통째로
function planTables() {
  const rows = q(`select relname t, round(pg_total_relation_size(oid)/1048576.0,2) mb from pg_class where relkind='r' and relnamespace='public'::regnamespace order by 2 desc`);
  for (const r of rows) {
    if (INC.includes(r.t) || r.t === 'gonggu') continue;
    (Number(r.mb) >= WEEKLY_MIN_MB ? WEEKLY : CORE).push(r.t);
  }
  return `표 ${rows.length}개 → 매일 ${CORE.length} · 주1회 ${WEEKLY.length} · 증분 ${INC.length}`;
}

function q(sql) {
  const f = path.join(REPO, 'scratchpad', '_db_export_q.sql'); fs.writeFileSync(f, sql, 'utf8');
  let raw = '';
  for (let a = 1; a <= 2; a++) { try { raw = execFileSync(CLI, sbArgs(f), { cwd: REPO, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, timeout: 300e3 }); break; } catch (e) { if (a === 2) throw e; } }
  const r = parseRows(raw); if (!r.ok) throw new Error('CLI 출력 못 읽음: ' + raw.slice(0, 200)); return r.rows;
}
const jsonl = (rows) => rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : '');
let ID_TABLES = null;
function hasId(t) { if (!ID_TABLES) ID_TABLES = new Set(q("select table_name t from information_schema.columns where table_schema='public' and column_name='id'").map((r) => r.t)); return ID_TABLES.has(t); }

function fullTable(t, file) {
  const order = hasId(t) ? 'order by x.id' : '';
  const rows = q(`select coalesce((select json_agg(row_to_json(x) ${order}) from public.${t} x), '[]'::json) j`)[0].j || [];
  fs.writeFileSync(path.join(OUT, file || t + '.jsonl'), jsonl(rows), 'utf8'); return rows.length;
}
// 작은 표 여러 개를 CLI 한 번(5초 기동)에 — 표마다 부르면 55개 × 5초로 너무 느리다
function fullTables(list) {
  const out = [];
  for (let i = 0; i < list.length; i += 12) {
    const chunk = list.slice(i, i + 12);
    const sql = chunk.map((t) => `select '${t}' t, coalesce((select json_agg(row_to_json(x) ${hasId(t) ? 'order by x.id' : ''}) from public.${t} x), '[]'::json) j`).join(' union all ');
    for (const r of q(sql)) { const rows = r.j || []; fs.writeFileSync(path.join(OUT, r.t + '.jsonl'), jsonl(rows), 'utf8'); out.push(`${r.t}:${rows.length}`); }
  }
  return out;
}
function incTable(t, wm) {
  const last = Number(wm[t] || 0);
  const rows = q(`select row_to_json(t) r from (select * from public.${t} where id > ${last} order by id limit 200000) t`).map((x) => x.r);
  if (!rows.length) return 0;
  // 🔴 날짜별로 쪼갠다 — 달 단위로 모으면 events 가 며칠 만에 89MB 가 되고 **GitHub 100MB 한 파일 한도**에 걸려 백업이 통째로 막힌다(2026-09-29 실측)
  const f = path.join(OUT, `${t}_${kst().toISOString().slice(0, 10)}.jsonl`);
  fs.appendFileSync(f, jsonl(rows), 'utf8'); wm[t] = rows[rows.length - 1].id; return rows.length;
}
function schema() {
  const w = (n, s) => fs.writeFileSync(path.join(OUT, 'schema', n), s, 'utf8');
  w('functions.sql', q(`select string_agg(pg_get_functiondef(p.oid), E'\\n\\n' order by p.proname) s from pg_proc p where p.pronamespace='public'::regnamespace and p.prokind='f'`)[0].s || '');
  w('views.sql', q(`select coalesce(string_agg(format('create or replace view public.%I as %s', viewname, definition), E'\\n\\n' order by viewname), '') s from pg_views where schemaname='public'`)[0].s);
  w('policies.sql', q(`select coalesce(string_agg(format('-- %s.%s%s%screate policy %I on public.%I as %s for %s to %s%s%s;', schemaname, tablename, E'\\n', '', policyname, tablename, permissive, cmd, array_to_string(roles, ','), case when qual is not null then ' using ('||qual||')' else '' end, case when with_check is not null then ' with check ('||with_check||')' else '' end), E'\\n' order by tablename, policyname), '') s from pg_policies where schemaname='public'`)[0].s);
  w('triggers.sql', q(`select coalesce(string_agg(pg_get_triggerdef(t.oid)||';', E'\\n' order by t.tgname), '') s from pg_trigger t join pg_class c on c.oid=t.tgrelid where c.relnamespace='public'::regnamespace and not t.tgisinternal`)[0].s);
  w('indexes.sql', q(`select coalesce(string_agg(indexdef||';', E'\\n' order by tablename, indexname), '') s from pg_indexes where schemaname='public'`)[0].s);
  w('cron.sql', q(`select coalesce(string_agg(format('select cron.schedule(%L, %L, %L);', jobname, schedule, command), E'\\n' order by jobname), '') s from cron.job where active`)[0].s);
  w('tables.sql', q(`select string_agg(format('create table if not exists public.%I (%s);', t, cols), E'\\n' order by t) s from (select table_name t, string_agg(format('%I %s%s', column_name, case when data_type='ARRAY' then udt_name||'[]' when data_type='USER-DEFINED' then udt_name else data_type end, case when is_nullable='NO' then ' not null' else '' end), ', ' order by ordinal_position) cols from information_schema.columns where table_schema='public' group by 1) x`)[0].s || '');
  w('grants.txt', q(`select coalesce(string_agg(format('%s %s %s', table_name, grantee, privilege_type), E'\\n' order by table_name, grantee, privilege_type), '') s from information_schema.role_table_grants where table_schema='public' and grantee in ('anon','authenticated')`)[0].s);
  w('rls.txt', q(`select coalesce(string_agg(format('%s rls=%s', relname, relrowsecurity), E'\\n' order by relname), '') s from pg_class where relkind='r' and relnamespace='public'::regnamespace`)[0].s);
}
function restoreDrill() {
  const files = fs.readdirSync(OUT).filter((f) => /^events_\d{4}-\d{2}(-\d{2}|_p\d+)?\.jsonl$/.test(f)).sort();
  if (!files.length) throw new Error('events 내보낸 파일 없음');
  const lines = fs.readFileSync(path.join(OUT, files[files.length - 1]), 'utf8').trim().split('\n').slice(-100);
  const arr = '[' + lines.join(',') + ']';
  const r = q(`create temp table _drill as select * from json_populate_recordset(null::public.events, $j$${arr}$j$); select count(*) n, min(id) lo, max(id) hi from _drill`);
  return `되살리기 시험: ${r[0].n}건 (id ${r[0].lo}~${r[0].hi}) — 원본 100줄 → ${r[0].n == 100 ? '✅ 일치' : '🔴 불일치'}`;
}

try {
  if (DRILL) { log(restoreDrill()); process.exit(0); }
  const wm = fs.existsSync(WM) ? JSON.parse(fs.readFileSync(WM, 'utf8')) : {};
  log(planTables());
  const t0 = Date.now(); const done = [];
  try { done.push(...fullTables(CORE)); } catch (e) { log(`⚠ 핵심 표 묶음 실패 ${String(e.message).slice(0, 120)}`); for (const t of CORE) { try { done.push(`${t}:${fullTable(t)}`); } catch (e2) { log(`⚠ ${t} 실패 ${String(e2.message).slice(0, 80)}`); } } }
  if (FULL || kst().getUTCDay() === 0) { done.push(...fullTables(WEEKLY)); wm.gonggu = q(`select coalesce(max(id),0) m from public.gonggu`)[0].m; }
  else { done.push(`gonggu:+${incTable('gonggu', wm)}`); }   // 평일엔 새 공구만 (고친 행은 일요일 판이 담는다)
  for (const t of INC) { try { done.push(`${t}:+${incTable(t, wm)}`); } catch (e) { log(`⚠ ${t} 실패 ${String(e.message).slice(0, 80)}`); } }
  schema(); done.push('schema');
  fs.writeFileSync(WM, JSON.stringify(wm, null, 1));
  log(`✅ ${Math.round((Date.now() - t0) / 1000)}초 · ${done.join(' ')}`);
} catch (e) { log('🔴 ' + String(e.stack || e.message).slice(0, 300)); process.exitCode = 1; }
