/**
 * 🧼 상품명 정리 회차 — 노출 중인 긴 이름에서 「브랜드 + 상품명」 만 남긴다 (사장님 2026-11-04 「걸러야지 브랜드랑 상품명 같은 것만 떼야지」)
 *
 * 왜: 인포크 블록 제목·캡션 문장이 그대로 상품명이 되어 「오 브리에 패드, 세럼, 크림 찐템이면 건조한 계절 하나도 안두려움」 같은 이름이 나간다.
 *     drop_badname 은 내리거나 잔해만 뗀다 — 이건 **문장 앞뒤를 떼고 상품은 살린다**(내리지 않는다).
 * 어떻게: 노출 행 중 16자 이상 이름을 Edge 함수 name-clean 에 보낸다 → 사전 히트(0원) 아니면 AI 가 「지우기만」 한다(원문 낱말만·순서 유지·검증) →
 *         정리본이 다르고 badReason 이 없으면 이름을 고친다(where id=.. and name=옛이름). 되돌리기 TSV: scratchpad/handoff-log/name_clean_<날짜>.tsv
 * 가드: 원문 20자 이상인데 정리본이 4자 미만이면 건너뜀(과도한 삭제) · 맘캘린더 본인(momcal_)은 안 건드림 · 한 회차 상한 120건(넘으면 쓰지 않고 로그만).
 *
 *   node tools/daily/name_clean_pass.mjs [--apply] [--min 16]
 * 키: PUSH_CRON_SECRET(깃허브 시크릿) 또는 PC 의 ~/.momcal_cron_secret — 코드에 두지 않는다.
 * 주기: 클라우드 JOBS name_clean_am/pm/eve (live_audit 보다 먼저 — 정리한 뒤에 감사)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { sbArgs, parseRows } from './sb_query.mjs';
import { badReason } from './drop_badname.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SP = (f) => path.join(ROOT, 'scratchpad', f);
const SBX = process.env.SUPABASE_CLI || (fs.existsSync('C:/Users/FAMILY/supabase-cli/supabase.exe') ? 'C:/Users/FAMILY/supabase-cli/supabase.exe' : 'supabase');
const APPLY = process.argv.includes('--apply');
const mi = process.argv.indexOf('--min');
const MIN = mi >= 0 ? Number(process.argv[mi + 1]) || 16 : 16;
const FN = 'https://hycaqsqeogjtbscmzrtm.supabase.co/functions/v1/name-clean';
const ANON = 'sb_publishable_u4hR4mdNTSss3kdjFH6R5Q_iuJ2MuGE';
const MAX_APPLY = 120;
const KST = () => new Date(Date.now() + 9 * 3600e3);
const today = () => KST().toISOString().slice(0, 10);
const LOG_F = SP('name_clean_log.txt');
const log = (s) => { const l = `[${KST().toISOString().slice(0, 16).replace('T', ' ')}] ${s}`; console.log(l); try { fs.appendFileSync(LOG_F, l + '\n'); } catch { } };

let secret = process.env.PUSH_CRON_SECRET || '';
if (!secret) { try { secret = fs.readFileSync(path.join(os.homedir(), '.momcal_cron_secret'), 'utf8').trim(); } catch { } }
if (!secret) { log('🔴 PUSH_CRON_SECRET 도 ~/.momcal_cron_secret 도 없다 — 중단'); process.exit(1); }

const SQL_F = SP('_name_clean.sql');
const q = (sql) => { fs.writeFileSync(SQL_F, sql + '\n', 'utf8'); return execFileSync(SBX, sbArgs(SQL_F), { encoding: 'utf8', cwd: ROOT, timeout: 300e3, maxBuffer: 64 * 1024 * 1024 }); };
const sqlStr = (s) => "'" + String(s).replace(/'/g, "''") + "'";

const r = parseRows(q(`select id, name from gonggu where approved and end_date >= ${sqlStr(today())} and coalesce(insta,'') <> 'momcal_' and char_length(name) >= ${MIN} order by id limit 800;`));
if (!r.ok) { log(`🔴 조회를 못 읽었다 — ${r.why}`); process.exit(1); }
const rows = r.rows;
log(`후보 ${rows.length}건 (${MIN}자 이상)${APPLY ? '' : ' [dry]'}`);

const names = [...new Set(rows.map((x) => x.name))];
const map = {};
let ai = 0, dict = 0;
for (let i = 0; i < names.length; i += 100) {
  const batch = names.slice(i, i + 100);
  let res;
  try {
    res = await fetch(FN, { method: 'POST', headers: { 'x-cron-secret': secret, 'content-type': 'application/json', apikey: ANON }, body: JSON.stringify({ names: batch }), signal: AbortSignal.timeout(150000) });
  } catch (e) { log(`🔴 name-clean 호출 실패 — ${String(e).slice(0, 80)}`); process.exit(1); }
  if (!res.ok) { log(`🔴 name-clean 응답 ${res.status}`); process.exit(1); }
  const j = await res.json();
  Object.assign(map, j.map || {}); ai += j.ai || 0; dict += j.dict || 0;
}
log(`정리기 응답: AI ${ai} · 사전 ${dict}`);

const changes = [], hides = [];
for (const row of rows) {
  const c = map[row.name];
  if (!c || c === row.name) continue;
  if (row.name.length >= 20 && c.replace(/\s/g, '').length < 4) { log(`  건너뜀(과도한 삭제) ${row.id} ${row.name} => ${c}`); continue; }
  if (badReason(c)) { log(`  건너뜀(정리본이 여전히 걸림: ${badReason(c)}) ${row.id} ${c}`); continue; }
  // 사실 표기(무항생제·유기농·국산·NON-GMO)를 정리기가 지웠으면 건너뜀 — 상품명의 일부다(CLAUDE.md 규칙 0-S). 홍보 머리말은 drop_badname.cleanJunk 가 따로 뗀다
  if (/(무항생제|유기농|국내산|국산|NON-?GMO)/i.test(row.name) && !/(무항생제|유기농|국내산|국산|NON-?GMO)/i.test(c)) { log(`  건너뜀(사실표기가 빠짐) ${row.id} ${row.name} => ${c}`); continue; }
  // 긴 문장에서 한 낱말·4글자 이하만 남으면 브랜드+상품을 특정할 수 없다 → 이름을 우기지 않고 내린다(사장님 「정확한 게 있을 가능성이 낮다」)
  if (!/\s/.test(c) && c.length <= 4 && row.name.split(/\s+/).length >= 4) { hides.push({ id: row.id, old: row.name, neu: c }); continue; }
  changes.push({ id: row.id, old: row.name, neu: c });
}
log(`고칠 이름 ${changes.length}건 · 내릴 것(브랜드·상품 특정 불가) ${hides.length}건`);
for (const h of hides) log(`  내림 후보 ${h.id}	${h.old}  =>  ${h.neu}`);
for (const c of changes) log(`  ${c.id}\t${c.old}  =>  ${c.neu}`);
if (!APPLY) process.exit(0);
if (changes.length > MAX_APPLY) { log(`🔴 한 회차 상한(${MAX_APPLY}) 초과 — 쓰지 않는다(정리기·규칙 이상 의심)`); process.exit(1); }
if (hides.length) {
  const ids = hides.map((h) => h.id).join(',');
  q(`update gonggu set approved=false where id in (${ids}) and approved;
insert into gonggu_hold(id, reason) select id, '상품명이 문장뿐이라 브랜드·상품을 특정할 수 없음(정리기 결과 한 낱말) ${today()}' from gonggu where id in (${ids}) on conflict (id) do nothing;`);
  try { fs.appendFileSync(path.join(ROOT, 'scratchpad', 'handoff-log', `name_clean_${today()}.tsv`), hides.map((h) => [h.id, h.old, `(내림: ${h.neu})`].join(String.fromCharCode(9))).join(String.fromCharCode(10)) + String.fromCharCode(10)); } catch { }
  log(`⬇ ${hides.length}건 내림(+hold)`);
}
if (changes.length) {
  const tsv = SP('') && path.join(ROOT, 'scratchpad', 'handoff-log', `name_clean_${today()}.tsv`);
  try { fs.mkdirSync(path.dirname(tsv), { recursive: true }); fs.appendFileSync(tsv, changes.map((c) => `${c.id}\t${c.old}\t${c.neu}`).join('\n') + '\n'); } catch { }
  const sql = changes.map((c) => `update gonggu set name=${sqlStr(c.neu)} where id=${c.id} and name=${sqlStr(c.old)};`).join('\n');
  q(sql);
  log(`✅ ${changes.length}건 이름 정리 적용`);
}
