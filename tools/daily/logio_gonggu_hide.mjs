/**
 * 🔴 한 번짜리 — 「로지오가닉 내꺼빼고 다 빼」 (사장님 2026-11-16 지시)
 *
 * 왜 필요한가
 *   my_gonggu_guard 규칙 0-M 은 **이름이 완전히 같을 때만** 자동으로 내린다.
 *   브랜드만 같은 것(로지오가닉 떡뻥·떡뻥&퓨레 …)은 「다른 물건일 수 있다」며 사람에게 넘긴다.
 *   사장님은 이번에 「브랜드가 같으면 다 빼, 내 것만 띄워」라고 정했다 — 그래서 이 도구로 한 번에 내린다.
 *
 * 안전장치
 *   · 내 공구(insta = 'momcal_')는 **어떤 경우에도 건드리지 않는다**(update 조건에 박아 둔다)
 *   · 지우지 않는다 — approved=false + gonggu_hold(잠금). 되돌리려면 둘 다 풀면 된다
 *   · --apply 는 --ids 로 지정한 행만 만진다. 먼저 --dry 로 후보를 눈으로 본다
 *
 * 실행
 *   node tools/daily/logio_gonggu_hide.mjs                     후보 전부 보기(바꾸지 않음)
 *   node tools/daily/logio_gonggu_hide.mjs --apply --ids=1,2   그 행들만 내리기
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { sbArgs, parseRows } from './sb_query.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = process.env.SUPABASE_CLI || 'C:/Users/FAMILY/supabase-cli/supabase.exe';
const TMPDIR = join(ROOT, 'scratchpad');
const TMP = join(TMPDIR, '_logio_hide.sql');
const APPLY = process.argv.includes('--apply');
const IDS = ((process.argv.find((a) => a.startsWith('--ids=')) || '').slice(6))
  .split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n > 0);
// --window (2026-11-17 사장님 「내 공구 기간과 겹치는 타인 로지오 전부 숨김」): 번호를 손으로 고르지 않고
//   내 로지오 공구 창(오픈−14일 ~ 마감, 규칙 0-M)과 기간이 겹치는 타 셀러 행 전부(끝난 행·이미 내렸지만 잠금 없는 행 포함)를 내리고 잠근다.
const WINDOW = process.argv.includes('--window');
const REASON = WINDOW ? '사장님 지시 2026-11-17 「로지오가닉 배도라지 품목만 내 공구 기간 동안 숨김」(규칙 0-M 품목 기준)' : '사장님 지시 2026-11-16 「로지오가닉 내꺼빼고 다 빼」 — 사장님 로지오가닉 공구 기간(11/13~11/22) 중 타셀러 로지오가닉 비노출(규칙 0-M)';
const q = (s) => "'" + String(s == null ? '' : s).replace(/'/g, "''") + "'";

function sql(text) {
  mkdirSync(TMPDIR, { recursive: true });
  writeFileSync(TMP, text, 'utf8');
  const out = execFileSync(CLI, sbArgs(TMP), { encoding: 'utf8', timeout: 240e3, cwd: ROOT, maxBuffer: 64 * 1024 * 1024 });
  const r = parseRows(out);
  if (!r.ok) throw new Error('CLI 출력을 못 읽었다 — ' + r.why);
  return r.rows;
}

const MATCH = `(coalesce(g.name,'') ~* '로지오'
   or coalesce(g.brand,'') ~* '로지오'
   or coalesce(g.item,'') ~* '로지오')`;

const LIST = `select g.id, g.insta, g.influencer, g.name, g.brand, g.item,
       g.open_date, g.end_date, g.source, g.approved,
       (h.id is not null) as held
  from public.gonggu g
  left join public.gonggu_hold h on h.id = g.id
 where ${MATCH}
 order by g.open_date, g.id;`;

const rows = sql(LIST);
const mine = (r) => String(r.insta || '').toLowerCase() === 'momcal_';
const day = (s, n) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const KST = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const myNow = rows.filter((r) => mine(r) && r.approved && r.end_date && r.end_date >= KST);
const WIN = myNow.length ? { lo: myNow.map((r) => r.open_date).sort()[0], hi: myNow.map((r) => r.end_date).sort().pop() } : null;
// 2026-11-17 사장님: 로지오가닉 전체가 아니라 「로지오가닉 + 배도라지(배·도라지·배도라지즙)」 품목만, 내 공구 기간(오픈~마감) 동안만 내린다.
//   떡뻥·퓨레·쌀과자·보리차는 그대로 노출. DB 쪽 같은 규칙 = own_window_item_rule(supabase/sql/own_window_item_rule_156.sql)
const ITEM = /도라지|배즙/;
const inWin = (r) => WIN && !mine(r) && ITEM.test(String(r.name || '')) && String(r.open_date || '') <= WIN.hi && String(r.end_date || r.open_date || '') >= WIN.lo;
if (WINDOW) {
  if (!WIN) { console.log('🔴 진행 중인 내 로지오 공구가 없다 — 창을 못 정해 아무것도 하지 않는다'); process.exit(1); }
  IDS.length = 0; for (const r of rows) if (inWin(r) && (r.approved || !r.held)) IDS.push(Number(r.id));
  console.log(`내 공구 기간 ${WIN.lo}~${WIN.hi} — 겹치는 타 셀러 배도라지 품목 중 노출 또는 잠금 없는 것 ${IDS.length}건`);
  if (APPLY && !IDS.length) { console.log('검증 ✅ 통과 — 내릴 것이 없다(이미 전부 내려가 잠겨 있다)'); process.exit(0); }
}
const say = (r) => `id${r.id} ${mine(r) ? '🟣내것' : '⚪타인'} insta=${r.insta || '(없음)'} influencer=${r.influencer || '(없음)'} 「${String(r.name).slice(0, 40)}」 brand=${r.brand || '-'} item=${r.item || '-'} ${r.open_date}~${r.end_date || '-'} approved=${r.approved} held=${r.held} source=${r.source || '-'}`;

console.log(`■ 로지오 매칭 ${rows.length}행 (그중 내 것 ${rows.filter(mine).length} · 타인 ${rows.filter((r) => !mine(r)).length})`);
for (const r of rows) console.log('  ' + say(r));

// gonggu_archive 는 기록용이라 손대지 않는다 — 세어만 본다
try {
  const a = sql(`select count(*) as n from public.gonggu_archive a where coalesce(a.name,'') ~* '로지오';`);
  console.log(`  (참고) gonggu_archive 로지오 ${a[0] ? a[0].n : '?'}행 — 기록 보존용이라 그대로 둔다`);
} catch (e) { console.log('  (참고) gonggu_archive 조회 실패: ' + String(e.message).slice(0, 80)); }

if (!APPLY) {
  console.log('\n(dry) 바꾸지 않았다. 내릴 행을 정했으면 --apply --ids=… 로 다시 부른다');
  process.exit(0);
}

if (!IDS.length) { console.log('🔴 --apply 인데 --ids 가 없다 — 아무것도 하지 않는다'); process.exit(1); }

// ① 만질 행을 다시 읽어 내 것·로지오가 아닌 것이 섞였는지 확인한다
const target = sql(`select g.id, g.insta, g.influencer, g.name, g.open_date, g.end_date, g.approved
  from public.gonggu g where g.id in (${IDS.join(',')}) order by g.id;`);
const bad = target.filter((r) => mine(r) || !rows.some((x) => Number(x.id) === Number(r.id)));
if (bad.length) {
  console.log('🔴 내 공구이거나 로지오가 아닌 행이 섞였다 — 전부 멈춘다: ' + bad.map((r) => 'id' + r.id).join(', '));
  process.exit(1);
}
console.log(`\n내릴 대상 ${target.length}행`);
for (const r of target) console.log('  · ' + say(r));

// ② 백업(되돌리기용 원본 값)을 로그에 남긴다 — Actions 로그가 기록이다
console.log('BACKUP ' + JSON.stringify(target));

// ③ 내리기 — 지우지 않고 approved=false, 잠금(gonggu_hold)까지
const off = sql(`update public.gonggu set approved = false
  where id in (${target.map((r) => r.id).join(',')})
    and coalesce(lower(insta),'') <> 'momcal_'
    and approved
  returning id, name, open_date, end_date;`);
console.log(`🔻 내림 ${off.length}행: ${off.map((r) => 'id' + r.id + ' ' + String(r.name).slice(0, 20)).join(' / ')}`);

const held = sql(`insert into public.gonggu_hold(id, reason)
  select g.id, ${q(REASON)} from public.gonggu g
   where g.id in (${target.map((r) => r.id).join(',')}) and coalesce(lower(g.insta),'') <> 'momcal_'
  on conflict (id) do nothing
  returning id;`);
console.log(`🔒 잠금(gonggu_hold) ${held.length}행: ${held.map((r) => 'id' + r.id).join(', ')}`);

// ④ 다시 읽어 확인 — 내 것은 그대로, **내 창(오늘~내 마감)과 겹치는 타인**은 내려가고 잠겼는지
const after = sql(LIST);
console.log(`\n■ 처리 후 로지오 매칭 ${after.length}행`);
for (const r of after) console.log('  ' + say(r));
const TODAY = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const mineAfter = after.filter(mine);
const mineLive = mineAfter.filter((r) => r.approved);
const mineEnd = mineLive.reduce((m, r) => (r.end_date && r.end_date > m ? r.end_date : m), TODAY);
const clash = WINDOW ? after.filter((r) => inWin(r) && (r.approved || !r.held))
  : after.filter((r) => !mine(r) && r.approved
  && r.end_date && r.end_date >= TODAY && String(r.open_date || '') <= mineEnd);
const future = after.filter((r) => !mine(r) && r.approved && r.end_date && r.end_date >= TODAY
  && String(r.open_date || '') > mineEnd);
const past = after.filter((r) => !mine(r) && r.approved && !(r.end_date && r.end_date >= TODAY));
const heldNow = after.filter((r) => r.held).length;
console.log(`\n검증 — 내 공구 노출 ${mineLive.length}건(1이어야) · 오늘~${mineEnd} 겹치는 타인 노출 ${clash.length}건(0이어야) · 내 창 뒤 예정 ${future.length}건(그대로 둠) · 지난 공구 ${past.length}건(그대로 둠) · 잠금 ${heldNow}건`);
if (clash.length) console.log('🔴 아직 노출 중: ' + clash.map((r) => 'id' + r.id).join(', '));
console.log(`\n검증 ${mineLive.length === 1 && !clash.length ? '✅ 통과' : '🔴 실패'} — 로지오 매칭 ${after.length} · 내것노출 ${mineLive.length} · 겹침노출 ${clash.length} · 잠금 ${heldNow}`);
process.exit(mineLive.length === 1 && !clash.length ? 0 : 1);
