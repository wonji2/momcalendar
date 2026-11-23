-- 핫딜 2단계 판정: 90일 이력 판정 함수 · 매일 재판정 · 차트3 (2026-11-23 ORDER_HOTDEAL_POLCENT §6)
--   is_lowest 는 몰에서 확인한 값(measured)이 7일 이상 쌓이고 평균보다 5% 이상 쌀 때만. 제보가만으로는 올리지 않는다(badge=reported 만).
-- 판정은 한 곳에서. 사이트 카드·차트·(나중에)발송이 같은 값을 본다.
create or replace function public.hotdeal_judge(
  p_key text, p_price int, p_days int default 90, p_min_points int default 7)
returns table(points int, avg_price int, min_price int, drop_pct int,
              is_lowest boolean, basis text, stage text)
language sql stable security definer set search_path = public as $$
  with h as (
    select ph.price, coalesce(ph.src, 'measured') as s
      from public.price_history ph
     where ph.product_id = p_key
       and ph.day >= (now() at time zone 'Asia/Seoul')::date - least(greatest(coalesce(p_days, 90), 7), 180)
       and ph.day <  (now() at time zone 'Asia/Seoul')::date          -- 오늘 값은 비교에서 뺀다
  ), a as (
    select count(*)::int as n,
           round(avg(price))::int as avg_p,
           min(price)::int as min_p,
           count(*) filter (where s = 'measured')::int as nm
      from h
  )
  select a.n,
         a.avg_p,
         a.min_p,
         coalesce(case when a.avg_p > 0 then round((a.avg_p - p_price) * 100.0 / a.avg_p)::int end, 0),
         coalesce(a.n >= p_min_points and a.min_p is not null and p_price <= a.min_p, false),
         case when a.n = 0 then 'none' when a.nm = 0 then 'reported' when a.nm = a.n then 'measured' else 'mixed' end,
         case when a.n = 0 then 'none' when a.n < p_min_points then 'collecting'
              when a.n < 14 then 'provisional' else 'confirmed' end
    from a;
$$;
revoke all on function public.hotdeal_judge(text, int, int, int) from public, anon, authenticated;
grant execute on function public.hotdeal_judge(text, int, int, int) to service_role;

-- 활성 상품 전체를 하루 한 번 다시 판정한다(KST 07:40 = UTC 22:40, 쿠팡 엔진 08:00 전)
create or replace function public.hotdeal_judge_all() returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  with act as (
    select id, product_id, price from public.hotdeals
     where (expires_at is null or expires_at > now()) and price > 0 and product_id is not null
       and coalesce(track, true)
  ), j as (
    select a.id, j.* from act a cross join lateral public.hotdeal_judge(a.product_id, a.price) j
  )
  update public.hotdeals h set
    judge_stage = j.stage, judge_basis = j.basis, avg_price = j.avg_price,
    min_price = j.min_price, drop_pct = j.drop_pct, judge_at = now(),
    is_lowest = (j.is_lowest and j.basis = 'measured' and j.drop_pct >= 5),
    badge = case when j.is_lowest and j.basis = 'measured' and j.drop_pct >= 5 then 'lowest'
                 when j.basis = 'reported' and j.is_lowest then 'reported'
                 when coalesce(j.drop_pct, 0) >= 25 then 'super'
                 when coalesce(j.drop_pct, 0) >= 10 then 'sale' end
  from j where h.id = j.id;
  get diagnostics n = row_count;
  insert into ops_status(id, payload, updated_at) values ('hotdeal-judge', jsonb_build_object('rows', n, 'at', to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI')), now())
    on conflict (id) do update set payload = excluded.payload, updated_at = now();
  return n;
end $$;
revoke all on function public.hotdeal_judge_all() from public, anon, authenticated;
grant execute on function public.hotdeal_judge_all() to service_role;

do $$ begin
  perform cron.unschedule('hotdeal-judge-daily');
exception when others then null; end $$;
select cron.schedule('hotdeal-judge-daily', '40 22 * * *', $c$select public.hotdeal_judge_all()$c$);

-- ⚠ 이름이 chart4 인 까닭: DB 에 hotdeal_chart3(pmin·pmax 를 돌려주는 다른 함수)이 이미 있어 덮지 않았다(오더서는 chart3 로 적혀 있다)
create or replace function public.hotdeal_chart4(pid text, days int default 90)
returns table(day date, price integer, basis text)
language sql stable security definer set search_path = public as $$
  select ph.day, min(ph.price)::int as price,
         case when count(*) filter (where coalesce(ph.src,'measured') = 'measured') > 0 then 'measured' else 'reported' end
    from public.price_history ph
   where (ph.product_key = pid or ph.product_id = pid)
     and ph.day >= (now() at time zone 'Asia/Seoul')::date - least(greatest(coalesce(days, 90), 7), 180)
     and exists (select 1 from public.hotdeals h where h.product_id = pid or h.product_key = pid)
   group by ph.day
   order by ph.day;
$$;
revoke all on function public.hotdeal_chart4(text, int) from public;
grant execute on function public.hotdeal_chart4(text, int) to anon, authenticated;
