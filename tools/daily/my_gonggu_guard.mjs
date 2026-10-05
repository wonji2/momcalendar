/**
 * 규칙 0-M 감시 — **사장님 공구가 있으면 그 2주 전부터 타셀러 같은 상품을 내린다**
 *   사장님 지시 2026-10-05: *"내가 공구하는 상품은 2주전부터 타셀러 db는 넣지마 내거만 띄워 모든곳에 공통사항이야"*
 *
 * 왜 감시기인가
 *   공구가 들어오는 길이 둘이다 — `tools/daily/cafe_crawl.mjs`(카페 크롤)와
 *   `scratchpad/gen_insert_gonggu.mjs`(파싱 승인표). 두 곳에 같은 판정을 베껴 넣으면
 *   한쪽만 고쳐져 어긋난다(2026-10-01·10-04 에 실제로 그랬다 — 메모리 same-flaw-in-sibling-code).
 *   그래서 **들어온 뒤 한 곳에서 본다.** 어느 경로로 와도 잡힌다.
 *
 * 판정
 *   창 = 내_오픈일 − 14일 ~ 내_마감일
 *   · **완전일치**(이름을 정규화해 같음) → 바로 내린다(approved=false, DELETE 금지)
 *   · **브랜드만 같음**(첫 낱말) → 내리지 않고 health_alerts 로 알린다.
 *     「티니핑 완구」와 「티니핑 멀티비타민젤리」는 브랜드만 같은 **다른 물건**이다(2026-10-05 실측).
 *
 * 실행: node tools/daily/my_gonggu_guard.mjs          (--dry 면 바꾸지 않고 보기만)
 * 로그: scratchpad/my_gonggu_guard_log.txt
 */
import { writeFileSync, appendFileSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { sbArgs, parseRows } from './sb_query.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = process.env.SUPABASE_CLI || 'C:/Users/FAMILY/supabase-cli/supabase.exe';
const TMP = join(ROOT, 'scratchpad', '_my_gonggu_guard.sql');
const LOG = join(ROOT, 'scratchpad', 'my_gonggu_guard_log.txt');
const DRY = process.argv.includes('--dry');
const NL = String.fromCharCode(10);

const q = (sql) => {
  writeFileSync(TMP, sql, 'utf8');
  const r = parseRows(execFileSync(CLI, sbArgs(TMP), { encoding: 'utf8', timeout: 120000, cwd: ROOT }));
  if (!r.ok) throw new Error('CLI 출력을 못 읽었다 — ' + r.why);
  return r.rows;
};

const WINDOW = `
with mine as (
  select id, name, open_date, end_date,
         lower(regexp_replace(name, '[^가-힣a-z0-9]', '', 'g')) k,
         lower(split_part(btrim(name), ' ', 1)) brand
    from public.gonggu where insta = 'momcal_' and approved
)
select o.id, o.influencer, o.name, o.open_date, o.end_date,
       m.name mine_name, m.open_date mine_open, m.end_date mine_end,
       case when lower(regexp_replace(o.name, '[^가-힣a-z0-9]', '', 'g')) = m.k
            then 'exact' else 'brand' end kind
  from mine m
  join public.gonggu o
    on o.insta is distinct from 'momcal_' and o.approved
   and (lower(regexp_replace(o.name, '[^가-힣a-z0-9]', '', 'g')) = m.k
        or (length(m.brand) >= 3 and lower(o.name) like m.brand || '%'))
   and o.open_date >= to_char(m.open_date::date - 14, 'YYYY-MM-DD')
   and o.open_date <= m.end_date
 where o.end_date >= to_char((now() at time zone 'Asia/Seoul')::date, 'YYYY-MM-DD')
 order by o.open_date;`;

const rows = q(WINDOW);
const exact = rows.filter((r) => r.kind === 'exact');
const brand = rows.filter((r) => r.kind === 'brand');
const stamp = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');
const head = `[${stamp}] 노출중 창 안 ${rows.length}건 — 완전일치 ${exact.length} · 브랜드만 ${brand.length}`;
console.log(head);
for (const r of rows) {
  console.log(`  ${r.kind === 'exact' ? '🔴' : '⚠ '} id${r.id} ${r.influencer || '(셀러없음)'} 「${String(r.name).slice(0, 24)}」 ` +
    `${r.open_date}~${r.end_date}  ↔ 내 「${String(r.mine_name).slice(0, 20)}」 ${r.mine_open}~${r.mine_end}`);
}

if (exact.length && !DRY) {
  const ids = exact.map((r) => r.id).join(',');
  const done = q(`update public.gonggu set approved = false where id in (${ids}) and approved returning id;`);
  console.log(`🔴 완전일치 ${done.length}건을 내렸다 (approved=false · 창이 지나면 되살릴 수 있다)`);
}
// 브랜드만 같은 것은 **사람이 봐야 한다** — 다른 물건일 수 있다
if (brand.length && !DRY) {
  const d = `사장님 공구 2주 창 안에 브랜드가 같은 타셀러 공구 ${brand.length}건 (다른 물건일 수 있어 자동으로 안 내렸다): ` +
    brand.slice(0, 6).map((r) => `id${r.id} ${r.influencer || '?'} ${String(r.name).slice(0, 14)}`).join(', ');
  q(`insert into public.health_alerts(kind, detail) values ('내공구창_브랜드겹침', '${d.split("'").join("''")}');`);
  console.log('⚠ health_alerts 에 남겼다 — 같은 물건이면 손으로 내릴 것');
}

try {
  const body = head + (rows.length ? NL + rows.map((r) => `  ${r.kind} id${r.id} ${r.influencer} ${r.name}`).join(NL) : '') + NL;
  appendFileSync(LOG, body);
  const all = readFileSync(LOG, 'utf8').split(NL).filter(Boolean);
  writeFileSync(LOG, all.slice(-300).reverse().join(NL) + NL, 'utf8');
} catch (_) {}
if (!rows.length) console.log('✅ 창 안 위반 0건');
