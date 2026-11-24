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

// 🔴 2026-10-26 — 예약작업(07:25)이 exit 1 로 끝났다. 같은 날 04:35 vocab-refresh 도 CLI 가 비정상 종료(stderr 는 「Initialising login role...」 뿐).
//   원인(추정 — 당시 stderr 를 못 남겨 확정 못 함)은 CLI 의 일시 실패(임시 로그인 역할 발급 경합·동시 호출) — 같은 명령이 몇 시간 뒤 손으로 돌리면 통과한다.
//   한 번 실패했다고 회차를 통째로 잃지 않도록 **3번까지 다시 시도**하고, 그래도 안 되면 stderr 꼬리를 로그에 남기고 exit 1 로 끝낸다.
const sleepMs = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const q = (sql) => {
  writeFileSync(TMP, sql, 'utf8');
  let last;
  for (let i = 1; i <= 3; i++) {
    try {
      const r = parseRows(execFileSync(CLI, sbArgs(TMP), { encoding: 'utf8', timeout: 120000, cwd: ROOT }));
      if (!r.ok) throw new Error('CLI 출력을 못 읽었다 — ' + r.why);
      return r.rows;
    } catch (e) {
      last = e;
      try { appendFileSync(LOG, '[재시도 ' + i + '/3] ' + String((e && (e.stderr || e.message)) || e).slice(-200).replace(/\s+/g, ' ') + NL); } catch (_) {}
      if (i < 3) sleepMs(15000 * i);
    }
  }
  throw last;
};

// ⚡ 2026-11-17 — 깃허브 회차(run 43790981371)가 120초 제한에 걸려 실패했다. 예전 질의는 내 공구마다 노출 중인 공구 전체(1.5만 행)에
//   정규식을 돌린 뒤에야 날짜로 걸렀다. 이제 「아직 안 끝난 타 셀러 행」을 먼저 추리고(수백 행) 이름 정규화도 한 번만 한다. 판정은 같다.
const WINDOW = `
with mine as (
  select id, name, open_date, end_date,
         lower(regexp_replace(name, '[^가-힣a-z0-9]', '', 'g')) k,
         lower(split_part(btrim(name), ' ', 1)) brand,
         r.item_re, r.from_date, r.to_date
    from public.gonggu g0 left join public.own_window_item_rule r on r.mine_id = g0.id
   where insta = 'momcal_' and approved
),
o as materialized (
  select id, influencer, name, open_date, end_date,
         lower(regexp_replace(name, '[^가-힣a-z0-9]', '', 'g')) k, lower(name) ln
    from public.gonggu
   where approved and insta is distinct from 'momcal_'
     and end_date >= to_char((now() at time zone 'Asia/Seoul')::date, 'YYYY-MM-DD')
     and open_date <= (select max(end_date) from mine)
)
select o.id, o.influencer, o.name, o.open_date, o.end_date,
       m.name mine_name, m.open_date mine_open, m.end_date mine_end,
       case when o.k = m.k then 'exact' when m.item_re is not null then 'item' else 'brand' end kind
  from mine m
  join o
    on (o.k = m.k or (length(m.brand) >= 3 and o.ln like m.brand || '%') or (m.item_re is not null and o.name ~* m.item_re))   -- 2026-11-24 품목 줄이 있으면 이름에 그 품목 낱말이 든 행도 후보(상시 공구 라꽁·어그: 첫 낱말 비교로는 「정품호주UGG어그」↔「호주어그부츠」를 못 잡았다)
   and o.open_date >= to_char(m.open_date::date - 14, 'YYYY-MM-DD')
   and o.open_date <= m.end_date
   -- 품목 예외(own_window_item_rule, 2026-11-17 사장님 「로지오가닉은 배도라지 품목만 내 공구 기간 동안 숨김」):
   --   줄이 있는 내 공구는 그 품목이고 기간이 겹치는 행만 본다 — 같은 브랜드의 다른 품목(떡뻥·퓨레)은 경보에도 안 올린다
   and (m.item_re is null or o.k = m.k
        or (o.name ~* m.item_re and o.open_date <= m.to_date and coalesce(nullif(o.end_date,''), o.open_date) >= m.from_date))
 order by o.open_date;`;

const rows = q(WINDOW);
const exact = rows.filter((r) => r.kind === 'exact' || r.kind === 'item');   // item = 품목 예외 줄에 맞는 행(브랜드+품목) — 완전일치처럼 내린다
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
  console.log(`🔴 완전일치·품목 ${done.length}건을 내렸다 (approved=false · 창이 지나면 되살릴 수 있다)`);
  const itemIds = exact.filter((r) => r.kind === 'item').map((r) => r.id);
  if (itemIds.length) q(`insert into public.gonggu_hold(id, reason) select g.id, '규칙 0-M 품목 예외 — 내 공구 기간 동안 같은 브랜드·같은 품목 비노출(own_window_item_rule)' from public.gonggu g where g.id in (${itemIds.join(',')}) and g.insta is distinct from 'momcal_' on conflict (id) do nothing returning id;`);
}
// 브랜드만 같은 것은 **사람이 봐야 한다** — 다른 물건일 수 있다
if (brand.length && !DRY) {
  const d = `사장님 공구 2주 창 안에 브랜드가 같은 타셀러 공구 ${brand.length}건 (다른 물건일 수 있어 자동으로 안 내렸다): ` +
    brand.slice(0, 6).map((r) => `id${r.id} ${r.influencer || '?'} ${String(r.name).slice(0, 14)}`).join(', ');
  q(`insert into public.health_alerts(kind, detail) values ('내공구창_브랜드겹침', '${d.split("'").join("''")}');`);
  console.log('⚠ health_alerts 에 남겼다 — 같은 물건이면 손으로 내릴 것');
}

// ⏰ 맘캘 공구·배너가 2일 안에 끝나면 미리 알린다 (2026-10-26 사장님 「상신데 왜 내려갔어 애초에」)
//   상시(always) 공구 3개가 처음 넣은 끝나는 날(10/25)을 그대로 갖고 있어 자정에 일정 카드·메인 배너가 같이 내려갔다.
//   자동으로 늘리지는 않는다(끝나는 날을 일부러 정한 공구도 있다) — 알리기만 하고, 늘릴지는 사장님이 정한다.
try {
  const soon = q(`select g.id, g.name, g.end_date, g.always,
      (select string_agg(b.id::text, ',') from public.banners b where b.active and b.title ilike '%' || split_part(g.name, ' ', 1) || '%'
         and b.show_until is not null and b.show_until < (now() + interval '3 days')) as banners
    from public.gonggu g
    where g.approved and g.insta = 'momcal_'
      and g.end_date between to_char((now() at time zone 'Asia/Seoul')::date, 'YYYY-MM-DD')
                         and to_char((now() at time zone 'Asia/Seoul')::date + 2, 'YYYY-MM-DD')
    order by g.end_date, g.id;`);
  if (soon.length) {
    const d = `맘캘 공구 ${soon.length}건이 2일 안에 내려간다(상시 포함 — 계속 띄우려면 끝나는 날을 늘릴 것): ` +
      soon.slice(0, 8).map((r) => `id${r.id} ${String(r.name).slice(0, 14)} ~${r.end_date}${r.always ? '(상시)' : ''}${r.banners ? ' 배너' + r.banners : ''}`).join(', ');
    console.log('⏰ ' + d);
    if (!DRY) q(`insert into public.health_alerts(kind, detail) values ('내공구_곧내려감', '${d.split("'").join("''")}');`);
  }
} catch (e) { console.log('⏰ 곧 내려감 점검 실패: ' + (e && e.message)); }

try {
  const body = head + (rows.length ? NL + rows.map((r) => `  ${r.kind} id${r.id} ${r.influencer} ${r.name}`).join(NL) : '') + NL;
  appendFileSync(LOG, body);
  const all = readFileSync(LOG, 'utf8').split(NL).filter(Boolean);
  writeFileSync(LOG, all.slice(-300).reverse().join(NL) + NL, 'utf8');
} catch (_) {}
if (!rows.length) console.log('✅ 창 안 위반 0건');
