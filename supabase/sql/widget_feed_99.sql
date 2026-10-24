-- 앱 홈화면 위젯 데이터 한 번에 (사장님 2026-10-24 "2랑 9 다 … 내가 써보고 결정하게 만들어줘")
--   안드로이드 위젯(android-app/widgets)이 30분마다 부른다. 개인정보 없음(공개 공구·핫딜·세일만). 3KB 안팎.
create or replace function public.widget_feed()
returns json language sql stable security definer set search_path = public as $$
  with d as (select to_char((now() at time zone 'Asia/Seoul')::date,'YYYY-MM-DD') t)
  select json_build_object(
    'today', (select t from d),
    'open_count', (select count(*) from gonggu g, d where g.approved and not g.always and g.open_date = d.t),
    'end_count',  (select count(*) from gonggu g, d where g.approved and not g.always and g.end_date = d.t),
    'mine', coalesce((select json_agg(x) from (
        select g.id, g.name, g.open_date, g.end_date, g.major, g.minor
          from gonggu g, d where g.approved and not g.always and g.insta = 'momcal_' and g.end_date >= d.t
         order by (g.open_date <= d.t), g.open_date, g.id limit 8) x), '[]'::json),
    'today_top', coalesce((select json_agg(x) from (
        select g.id, g.name, g.major, g.minor, coalesce(g.influencer, g.insta) seller
          from gonggu g left join wish_counts_cache w on w.gonggu_id = g.id, d
         where g.approved and not g.always and g.open_date = d.t and coalesce(g.insta,'') <> ''
         order by (g.insta = 'momcal_') desc, coalesce(w.cnt,0) desc, g.id desc limit 6) x), '[]'::json),
    -- 위젯 「전체」 기본 보기 (사장님 2026-10-24 "공구는 맘캘+이웃셀러껀 무조건 상위노출이고 하단엔 인기순"):
    --   오늘 진행 중인 공구 — 맘캘린더·이웃셀러(sellers.is_partner·active·기간 안 = 사이트 loadSellers 와 같은 기준) 먼저, 그 아래 인기순(사이트 「인기」와 같은 클릭 집계 gonggu_click_stats  많이 눌린 순, 같으면 찜 많은 순 — 사장님 2026-10-24 "많이 눌러본 순")
    'feed', coalesce((select json_agg(x) from (
        select g.id, g.name, g.major, g.minor, g.open_date, g.end_date, coalesce(nullif(g.influencer,''), g.insta) seller,
               (g.insta = 'momcal_' or exists (select 1 from sellers s where s.is_partner and s.active
                    and lower(replace(coalesce(s.insta,''),'@','')) = lower(g.insta)
                    and (s.start_date is null or s.start_date::text <= d.t) and (s.end_date is null or s.end_date::text >= d.t))) as partner,
               coalesce(w.cnt,0) wish, coalesce(c.clicks,0) clicks
          from gonggu g left join wish_counts_cache w on w.gonggu_id = g.id
               left join gonggu_click_stats c on c.id = g.id, d
         where g.approved and not g.always and coalesce(g.insta,'') <> '' and g.open_date <= d.t and g.end_date >= d.t
         order by partner desc, (g.insta = 'momcal_') desc, coalesce(c.clicks,0) desc, coalesce(w.cnt,0) desc, g.open_date desc, g.id desc limit 20) x), '[]'::json),
    'hot', coalesce((select json_agg(x) from (
        select h.id, h.title, h.price, h.price_before, h.discount_rate, h.mall
          from hotdeals h where h.created_at > now() - interval '36 hours'
           and (h.expires_at is null or h.expires_at > now())
         order by h.discount_rate desc nulls last, h.id desc limit 6) x), '[]'::json),
    'sale', coalesce((select json_agg(x) from (
        select s.brand, s.title, s.tag, s.start_date, s.end_date
          from sale_events s, d where coalesce(s.end_date, s.start_date) >= d.t and coalesce(s.tag,'') not in ('해외','문센')
         order by s.start_date limit 6) x), '[]'::json)
  );
$$;
grant execute on function public.widget_feed() to anon, authenticated;
