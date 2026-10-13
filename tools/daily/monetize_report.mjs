// 💰 수익 동선 성적표 — 노출(imp) → 클릭 → 추정 수익. 어느 면이 돈이 되는지 숫자로 본다 (2026-10-13 사장님 "결과까지 분석")
//   node tools/daily/monetize_report.mjs [일수=7]
//   읽는 것: events(imp·hotdeal_open·mall_search_go·sale_go·sale_band_click·sale_bell_add·search), revenue_daily(쿠팡 정산)
//   추정 수익: 쿠팡 클릭당 정산(실측)만 쓴다. 링크프라이스·토스는 정산 API 가 없어(토스 OpenAPI ACCESS_DENIED) 클릭 수만 낸다.
//   면(surface): strip_home · strip_sale · mall_block · mall_block_empty · sale_band  (test.html 의 mcImpObserve)
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const DAYS = Number(process.argv[2] || 7);
const CLI = process.env.SUPABASE_CLI || 'C:/Users/FAMILY/supabase-cli/supabase.exe';
function q(sql) {
  fs.writeFileSync('scratchpad/_monetize.sql', sql);
  for (let i = 0; i < 3; i++) {
    try {
      const out = execFileSync(CLI, ['db', 'query', '--linked', '--file', 'scratchpad/_monetize.sql', '--output-format', 'json'], { encoding: 'utf8', timeout: 100000, maxBuffer: 1 << 26 });
      return JSON.parse(out.slice(out.indexOf('{'))).rows || [];
    } catch { /* 재시도 */ }
  }
  throw new Error('SQL 실패');
}
const since = `visited_at > now() - interval '${DAYS} days'`;
const J = (col) => `case when event_data ~ '^\\s*\\{' then event_data::jsonb ->> '${col}' end`;
const rows = q(`
select 'imp' k, event_data a, count(*)::text n from public.events where event_type='imp' and ${since} group by 2
union all
select 'strip_click', coalesce(nullif(${J('s')},''),'?'), count(*)::text from public.events where event_type='hotdeal_open' and ${J('from')}='strip' and ${since} group by 2
union all
select 'hotdeal_all', coalesce(nullif(${J('s')},''),'?'), count(*)::text from public.events where event_type in ('hotdeal_open','hotdeal_go') and ${since} group by 2
union all
select 'mall_go', split_part(event_data,'|',1), count(*)::text from public.events where event_type='mall_search_go' and ${since} group by 2
union all
select 'sale_go', case when event_data like '%|aff' then 'aff' else 'plain' end, count(*)::text from public.events where event_type='sale_go' and ${since} group by 2
union all
select 'one', event_type, count(*)::text from public.events where event_type in ('sale_band_click','sale_bell_add','sale_bell_del') and ${since} group by 2
union all
select 'trip_go', split_part(event_data,'|',1) || '|' || split_part(event_data,'|',2), count(*)::text from public.events where event_type='trip_go' and ${since} group by 2
union all
select 'search', case when event_data ~ '^\\s*\\{' and (event_data::jsonb->>'n')::int = 0 then 'zero' else 'hit' end, count(*)::text from public.events where event_type='search' and ${since} group by 2
union all
select 'tabs', event_data, count(*)::text from public.events where event_type='content_tab' and ${since} group by 2
union all
select 'coupang_rev', 'commission_per_click', round(sum(commission)::numeric / nullif(sum(clicks),0), 1)::text from public.revenue_daily where source='coupang' and day > current_date - 60
union all
select 'coupang_rev', 'commission_sum', coalesce(sum(commission),0)::text from public.revenue_daily where source='coupang' and day > current_date - ${DAYS};
`);
const g = (k) => rows.filter((r) => r.k === k).map((r) => [r.a, Number(r.n)]);
const m = (k) => Object.fromEntries(g(k));
const imp = m('imp'), tabs = m('tabs'), search = m('search'), one = m('one');
const stripClicks = g('strip_click'), stripTotal = stripClicks.reduce((s, [, n]) => s + n, 0);
const mallGo = g('mall_go'), mallTotal = mallGo.reduce((s, [, n]) => s + n, 0);
const sale = m('sale_go');
const perClick = Number((rows.find((r) => r.k === 'coupang_rev' && r.a === 'commission_per_click') || {}).n || 0);
const pct = (a, b) => (b ? (a / b * 100).toFixed(1) + '%' : '—');
const out = [];
out.push(`💰 수익 동선 성적표 — 최근 ${DAYS}일 (${new Date().toISOString().slice(0, 16)}Z)`);
out.push('');
out.push('면(surface)                노출   클릭   CTR');
const impStripHome = imp.strip_home || 0, impStripSale = imp.strip_sale || 0;
out.push(`  홈 핫딜 스트립        ${String(impStripHome).padStart(6)} ${String(stripTotal).padStart(6)}  ${pct(stripTotal, impStripHome + impStripSale)}  (홈+세일탭 합산 클릭)`);
out.push(`  세일탭 핫딜 스트립    ${String(impStripSale).padStart(6)}`);
const impMall = (imp.mall_block || 0) + (imp.mall_block_empty || 0);
out.push(`  쇼핑몰 최저가 블록    ${String(impMall).padStart(6)} ${String(mallTotal).padStart(6)}  ${pct(mallTotal, impMall)}  (결과 없음 노출 ${imp.mall_block_empty || 0})`);
out.push(`  홈 세일 띠            ${String(imp.sale_band || 0).padStart(6)} ${String(one.sale_band_click || 0).padStart(6)}  ${pct(one.sale_band_click || 0, imp.sale_band || 0)}`);
out.push('');
const tripGo = g('trip_go'), tripTotal = tripGo.reduce((s, [, n]) => s + n, 0), impTrip = (imp.trip_home || 0) + (imp.trip_sale || 0);
out.splice(out.length - 1, 0, `  나들이 특가 블록      ${String(impTrip).padStart(6)} ${String(tripTotal).padStart(6)}  ${pct(tripTotal, impTrip)}  (홈 ${imp.trip_home || 0} · 세일탭 ${imp.trip_sale || 0})`);
out.push('스트립 클릭 소스: ' + (stripClicks.map(([s, n]) => `${s} ${n}`).join(' · ') || '(없음)'));
out.push('나들이 클릭(머천트|키워드): ' + (tripGo.map(([s, n]) => `${s} ${n}`).join(' · ') || '(없음)'));
out.push('쇼핑몰 클릭: ' + (mallGo.map(([s, n]) => `${s} ${n}`).join(' · ') || '(없음)'));
out.push(`세일탭 카드 클릭: 수익링크 ${sale.aff || 0} · 일반 ${sale.plain || 0} · 알림 켬 ${one.sale_bell_add || 0}`);
out.push(`탭 이동: 공구 ${tabs.gonggu || 0} · 핫딜 ${tabs.hotdeal || 0} · 세일 ${tabs.sale || 0}`);
out.push(`검색: 결과 있음 ${search.hit || 0} · 공구 0건 ${search.zero || 0} (${pct(search.zero || 0, (search.hit || 0) + (search.zero || 0))})`);
out.push('');
const coupangStrip = (stripClicks.find(([s]) => s === 'coupang' || s === 'goldbox') || [0, 0])[1];
out.push(`쿠팡 클릭당 정산(최근 60일 실측): ${perClick || '—'}원`);
out.push(`스트립 쿠팡 클릭 ${coupangStrip}건 × ${perClick || '?'}원 ≈ ${Math.round(coupangStrip * perClick).toLocaleString()}원 (최소 추정 — 토스·링크프라이스·쇼핑몰 정산은 API 로 못 받아 제외)`);
const txt = out.join('\n');
console.log(txt);
fs.writeFileSync('scratchpad/monetize_report.txt', txt + '\n');
