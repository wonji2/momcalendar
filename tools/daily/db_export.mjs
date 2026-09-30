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
// 🔴 gonggu 는 **매일 통째로** — 이 표엔 updated_at 이 없어 '고친 행' 을 가려낼 방법이 없다.
//    새 id 만 담으면 주중에 고친 공구(이름·날짜·승인)가 최대 일주일 사본 밖에 있다(검증자 지적 2026-09-29).
//    16.7MB/일 = 월 0.5GB 로 무료 5GB 의 10% 지만, 이게 우리 본 데이터다.
let CORE = ['gonggu'], WEEKLY = [];
// 살아있는 열쇠는 백업에 두지 않는다 — 비공개 저장소라도 (work-backup/.gitignore 의 브라우저 프로필과 같은 뿌리).
//   toss_token 은 toss-sync 함수가 다시 발급한다. seller_auth.login_pw 는 bcrypt 해시라 담아도 된다(2026-09-29 확인).
const SKIP = ['toss_token'];
const FAILED = [];
function planTables() {
  const rows = q(`select relname t, round(pg_total_relation_size(oid)/1048576.0,2) mb from pg_class where relkind='r' and relnamespace='public'::regnamespace order by 2 desc`);
  for (const r of rows) {
    if (SKIP.includes(r.t)) continue;
    if (INC.includes(r.t) || r.t === 'gonggu') continue;   // gonggu 는 위에서 CORE 로 못박았다
    (Number(r.mb) >= WEEKLY_MIN_MB ? WEEKLY : CORE).push(r.t);
  }
  return `표 ${rows.length}개 → 매일 ${CORE.length} · 주1회 ${WEEKLY.length} · 증분 ${INC.length}`;
}

function q(sql) {
  const f = path.join(REPO, 'scratchpad', `_db_export_q_${process.pid}.sql`); fs.writeFileSync(f, sql, 'utf8');   // 회차마다 다른 이름 — 겹쳐 돌면 서로 덮어썼다(2026-09-29 검증)
  let raw = '';
  let err = null;
  for (let a = 1; a <= 3; a++) { try { raw = execFileSync(CLI, sbArgs(f), { cwd: REPO, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, timeout: 300e3 }); err = null; break; } catch (e) { err = e; } }
  try { fs.unlinkSync(f); } catch {}
  if (err) throw err;
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
    try { for (const r of q(sql)) { const rows = r.j || []; fs.writeFileSync(path.join(OUT, r.t + '.jsonl'), jsonl(rows), 'utf8'); out.push(`${r.t}:${rows.length}`); } }
    catch (e) { log(`⚠ 묶음 실패 → 한 표씩 다시: ${String(e.message).slice(0, 60)}`); for (const t of chunk) { try { out.push(`${t}:${fullTable(t)}`); } catch (e2) { FAILED.push(t); log(`🔴 ${t} 실패 — 다음 회차에 다시 받는다`); } } }
  }
  return out;
}
function saveWm(wm) { fs.writeFileSync(WM, JSON.stringify(wm, null, 1), 'utf8'); }
// 물높이 파일을 잃으면 id 1 부터 다시 받아 그날 파일이 90MB 가 되고 GitHub 100MB 한도에 걸려 백업이 통째로 멈춘다 → 내보낸 파일에서 되살린다
function wmFromFiles(t) {
  const files = fs.readdirSync(OUT).filter((f) => f.startsWith(t + '_') && f.endsWith('.jsonl')).sort();
  let max = 0;
  for (const f of files) {
    const txt = fs.readFileSync(path.join(OUT, f), 'utf8'); const i = txt.lastIndexOf('\n', txt.length - 2);
    const lastLine = txt.slice(i + 1).trim(); if (!lastLine) continue;
    try { max = Math.max(max, Number(JSON.parse(lastLine).id) || 0); } catch {}
  }
  return max;
}
function incTable(t, wm) {
  if (!wm[t]) { const back = wmFromFiles(t); if (back) { wm[t] = back; log(`물높이 되살림 ${t} → ${back} (내보낸 파일에서)`); } }
  const last = Number(wm[t] || 0);
  const rows = q(`select row_to_json(t) r from (select * from public.${t} where id > ${last} order by id limit 200000) t`).map((x) => x.r);
  if (!rows.length) return 0;
  // 🔴 날짜별로 쪼갠다 — 달 단위로 모으면 events 가 며칠 만에 89MB 가 되고 **GitHub 100MB 한 파일 한도**에 걸려 백업이 통째로 막힌다(2026-09-29 실측)
  const f = path.join(OUT, `${t}_${kst().toISOString().slice(0, 10)}.jsonl`);
  fs.appendFileSync(f, jsonl(rows), 'utf8'); wm[t] = rows[rows.length - 1].id; saveWm(wm); return rows.length;   // 표마다 바로 저장 — 뒤에서 죽으면 같은 행이 두 번 붙었다
}
function schema() {
  const w = (n, s) => fs.writeFileSync(path.join(OUT, 'schema', n), s, 'utf8');
  w('functions.sql', q(`select string_agg(pg_get_functiondef(p.oid), E'\\n\\n' order by p.proname) s from pg_proc p where p.pronamespace='public'::regnamespace and p.prokind='f'`)[0].s || '');
  w('views.sql', q(`select coalesce(string_agg(format('create or replace view public.%I as %s', viewname, definition), E'\\n\\n' order by viewname), '') s from pg_views where schemaname='public'`)[0].s);
  w('policies.sql', q(`select coalesce(string_agg(format('-- %s.%s%s%screate policy %I on public.%I as %s for %s to %s%s%s;', schemaname, tablename, E'\\n', '', policyname, tablename, permissive, cmd, array_to_string(roles, ','), case when qual is not null then ' using ('||qual||')' else '' end, case when with_check is not null then ' with check ('||with_check||')' else '' end), E'\\n' order by tablename, policyname), '') s from pg_policies where schemaname='public'`)[0].s);
  w('triggers.sql', q(`select coalesce(string_agg(pg_get_triggerdef(t.oid)||';', E'\\n' order by t.tgname), '') s from pg_trigger t join pg_class c on c.oid=t.tgrelid where c.relnamespace='public'::regnamespace and not t.tgisinternal`)[0].s);
  // 기본키·외래키·고유·검사 제약 — tables.sql 은 컬럼과 타입만 담는다(2026-09-29 검증 지적). 되살릴 때 표 다음에 이걸 건다
  w('constraints.sql', q(`select coalesce(string_agg(format('alter table public.%I add constraint %I %s;', c.relname, con.conname, pg_get_constraintdef(con.oid)), E'\n' order by c.relname, con.conname), '') s from pg_constraint con join pg_class c on c.oid=con.conrelid where c.relnamespace='public'::regnamespace and con.contype in ('p','f','u','c')`)[0].s);
  // 제약(PK·UNIQUE)이 자기 인덱스를 같이 만든다 → 여기서 빼지 않으면 복원 때 "이미 있다" 로 터진다(2026-09-30 리허설에서 발견)
  w('indexes.sql', q(`select coalesce(string_agg(i.indexdef||';', E'\\n' order by i.tablename, i.indexname), '') s from pg_indexes i where i.schemaname='public' and not exists (select 1 from pg_constraint c join pg_class t on t.oid=c.conrelid where t.relnamespace='public'::regnamespace and t.relname=i.tablename and c.conname=i.indexname)`)[0].s);
  w('cron.sql', q(`select coalesce(string_agg(format('select cron.schedule(%L, %L, %L);', jobname, schedule, command), E'\\n' order by jobname), '') s from cron.job where active`)[0].s);
  // 🔴 기본값·identity 까지 담는다 — 없으면 복원한 표에 새 행을 못 넣어 '읽기 전용 박물관' 이 된다(2026-09-30 리허설).
  //    information_schema 는 타입 길이를 잃는다 → pg_attribute + format_type 으로 정확히.
  w('tables.sql', q(`select coalesce(string_agg(format('create table if not exists public.%I (%s);', t, cols), E'\\n' order by t), '') s from (select c.relname t, string_agg(format('%I %s%s%s%s', a.attname, format_type(a.atttypid, a.atttypmod), case when a.attidentity = 'a' then ' generated always as identity' when a.attidentity = 'd' then ' generated by default as identity' else '' end, case when a.attnotnull then ' not null' else '' end, case when a.attidentity = '' and d.adbin is not null then ' default '||pg_get_expr(d.adbin, d.adrelid) else '' end), ', ' order by a.attnum) cols from pg_class c join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped left join pg_attrdef d on d.adrelid = c.oid and d.adnum = a.attnum where c.relkind='r' and c.relnamespace='public'::regnamespace group by 1) x`)[0].s);
  // 시퀀스(serial 계열 기본값이 참조한다) — identity 는 표와 함께 만들어지지만 옛 serial 은 시퀀스가 따로 있어야 한다
  w('sequences.sql', q(`select coalesce(string_agg(format('create sequence if not exists public.%I;', sequencename), E'\n' order by sequencename), '') s from pg_sequences where schemaname='public'`)[0].s);
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
  // 지난 회차에 실패한 표는 요일과 상관없이 오늘 다시 받는다
  const failFile = path.join(OUT, '_failed.json');
  const prevFailed = fs.existsSync(failFile) ? JSON.parse(fs.readFileSync(failFile, 'utf8')) : [];
  for (const t of prevFailed) if (!CORE.includes(t) && !INC.includes(t)) CORE.push(t);
  if (prevFailed.length) log(`지난 회차 실패분 다시 받기: ${prevFailed.join(', ')}`);
  const t0 = Date.now(); const done = [];
  try { done.push(...fullTables(CORE)); } catch (e) { log(`⚠ 핵심 표 묶음 실패 ${String(e.message).slice(0, 120)}`); for (const t of CORE) { try { done.push(`${t}:${fullTable(t)}`); } catch (e2) { log(`⚠ ${t} 실패 ${String(e2.message).slice(0, 80)}`); } } }
  if ((FULL || kst().getUTCDay() === 0) && WEEKLY.length) done.push(...fullTables(WEEKLY));

  for (const t of INC) { try { done.push(`${t}:+${incTable(t, wm)}`); } catch (e) { log(`⚠ ${t} 실패 ${String(e.message).slice(0, 80)}`); } }
  schema(); done.push('schema');
  saveWm(wm);
  fs.writeFileSync(path.join(OUT, '_failed.json'), JSON.stringify(FAILED), 'utf8');
  if (FAILED.length) log(`🔴 못 받은 표 ${FAILED.length}개: ${FAILED.join(', ')} — 다음 회차에 다시 받는다`);
  log(`✅ ${Math.round((Date.now() - t0) / 1000)}초 · ${done.join(' ')}`);
} catch (e) { log('🔴 ' + String(e.stack || e.message).slice(0, 300)); process.exitCode = 1; }
