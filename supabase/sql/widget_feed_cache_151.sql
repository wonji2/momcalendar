-- widget_feed 미리 계산 (2026-11-16 · 사장님 「이어서 잡아」)
--   문제: 부를 때마다 공구·찜 수·클릭 통계·핫딜 클릭(이벤트 3일)을 통째로 다시 계산 → 따뜻할 때 0.37초, 무료 Nano DB 가 바쁘거나 식으면 anon 3초 제한을 넘어 500(live_smoke 에서 하루 2번).
--   방법: 모두에게 같은 부분(연결 안 된 위젯의 결과)을 widget_feed_cache 한 줄에 pg_cron 이 5분마다 계산해 둔다.
--         widget_feed 는 그 줄을 꺼내 주고, 연결된 위젯(p_widget)이면 그 기기의 찜 두 목록만 그 자리에서 붙인다.
--         보관분이 없거나 20분 넘게 낡았거나 날짜가 바뀌었으면 예전 계산(_widget_feed_live)으로 그대로 답한다 → 크론이 멈춰도 결과는 같다.
--   _widget_feed_live = 고치기 전 widget_feed 본문 그대로(이름만 바꿈).
--   한도: 표 1줄(수 KB) · 크론 1개 추가(5분, 실행 0.4초) — DB 크기·전송량 영향 없음.
CREATE OR REPLACE FUNCTION public._widget_feed_live(p_widget text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with d as (select to_char((now() at time zone 'Asia/Seoul')::date,'YYYY-MM-DD') t,
                    to_char((now() at time zone 'Asia/Seoul')::date + 35,'YYYY-MM-DD') t35),
       dev as (select l.device_id from widget_link l where p_widget is not null and l.widget_id = p_widget),
       -- 그 기기가 로그인 계정에 묶여 있으면 계정의 모든 기기(member_devices, 102)
       dv as (select array(select d.device_id from dev d
                           union select m2.device_id from member_devices m1 join member_devices m2 on m2.kakao_id = m1.kakao_id
                            where m1.device_id in (select device_id from dev)) ds),
       -- 핫딜 인기 = 사이트에서 연 수·간 수(최근 3일). event_data 는 글자라 숫자만 뽑는다(깨진 줄이 있어도 위젯이 안 죽게)
       hc as (select substring(e.event_data from '"id":\s*([0-9]{1,12})')::bigint hid, count(*) c
                from events e where e.event_type in ('hotdeal_open','hotdeal_go') and e.visited_at > now() - interval '3 days'
               group by 1)
  select json_build_object(
    'today', (select t from d),
    'linked', exists (select 1 from dev),
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
    -- 「전체」: 오늘 진행 중 공구 — 맘캘린더·이웃셀러 먼저, 그 아래 많이 눌린 순(사장님 2026-10-24). 상시 공구는 뺀다.
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
    -- 「내 찜」 공구: 그 기기의 찜 중 아직 안 끝났고 35일 안에 열리는 것(상시 제외)
    'wish', coalesce((select json_agg(x) from (
        select distinct g.id, g.name, g.major, g.open_date, g.end_date, coalesce(nullif(g.influencer,''), g.insta) seller,
               (g.insta = 'momcal_') as partner
          from wishes w join gonggu g on g.id = w.gonggu_id, d
         where w.device_id = any((select ds from dv)::text[])
           and g.approved and not g.always and g.end_date >= d.t and g.open_date <= d.t35
         order by g.open_date, g.id limit 40) x), '[]'::json),
    'sale_wish', coalesce((select json_agg(x) from (
        select distinct s.id, s.brand, s.title, s.start_date, s.end_date
          from sale_wishes w join sale_events s on s.id = w.sale_id, d
         where w.device_id = any((select ds from dv)::text[]) and w.wish and coalesce(s.approved, true)
           and coalesce(s.end_date, s.start_date) >= d.t and s.start_date <= d.t35
         order by s.start_date, s.id limit 20) x), '[]'::json),
    -- 핫딜: 많이 눌린 순(사장님 2026-10-24 "핫딜탭도 많이 눌린순"), 같으면 할인 큰 순
    'hot', coalesce((select json_agg(x) from (
        select h.id, h.title, h.price, h.price_before, h.discount_rate, h.mall, coalesce(hc.c,0) clicks
          from hotdeals h left join hc on hc.hid = h.id
         where h.created_at > now() - interval '36 hours'
           and (h.expires_at is null or h.expires_at > now())
         order by coalesce(hc.c,0) desc, h.discount_rate desc nulls last, h.id desc limit 15) x), '[]'::json),
    'sale', coalesce((select json_agg(x) from (
        select s.id, s.brand, s.title, s.tag, s.start_date, s.end_date
          from sale_events s, d where coalesce(s.end_date, s.start_date) >= d.t and coalesce(s.approved, true)
           and coalesce(s.tag,'') not in ('해외','문센')
         order by s.start_date limit 12) x), '[]'::json)
  );
$function$;
revoke all on function public._widget_feed_live(text) from public, anon, authenticated;

create table if not exists public.widget_feed_cache (k int primary key default 1 check (k = 1), body jsonb not null, at timestamptz not null default now());
alter table public.widget_feed_cache enable row level security;
revoke all on public.widget_feed_cache from anon, authenticated;

create or replace function public.widget_feed_refresh() returns void language sql security definer set search_path to 'public' as $f$
  insert into widget_feed_cache(k, body, at) values (1, public._widget_feed_live(null)::jsonb, now())
  on conflict (k) do update set body = excluded.body, at = excluded.at;
$f$;
revoke all on function public.widget_feed_refresh() from public, anon, authenticated;

create or replace function public.widget_feed(p_widget text default null::text)
returns json language plpgsql stable security definer set search_path to 'public' as $f$
declare c jsonb; t text := to_char((now() at time zone 'Asia/Seoul')::date,'YYYY-MM-DD');
        t35 text := to_char((now() at time zone 'Asia/Seoul')::date + 35,'YYYY-MM-DD'); ds text[];
begin
  select body into c from widget_feed_cache where k = 1 and at > now() - interval '20 minutes' and body->>'today' = t;
  if c is null then return public._widget_feed_live(p_widget); end if;
  if p_widget is null or not exists (select 1 from widget_link l where l.widget_id = p_widget) then return c::json; end if;
  select array(select l.device_id from widget_link l where l.widget_id = p_widget
               union select m2.device_id from member_devices m1 join member_devices m2 on m2.kakao_id = m1.kakao_id
                where m1.device_id in (select l.device_id from widget_link l where l.widget_id = p_widget)) into ds;
  return (c || jsonb_build_object(
    'linked', true,
    'wish', coalesce((select jsonb_agg(x) from (
        select distinct g.id, g.name, g.major, g.open_date, g.end_date, coalesce(nullif(g.influencer,''), g.insta) seller,
               (g.insta = 'momcal_') as partner
          from wishes w join gonggu g on g.id = w.gonggu_id
         where w.device_id = any(ds)
           and g.approved and not g.always and g.end_date >= t and g.open_date <= t35
         order by g.open_date, g.id limit 40) x), '[]'::jsonb),
    'sale_wish', coalesce((select jsonb_agg(x) from (
        select distinct s.id, s.brand, s.title, s.start_date, s.end_date
          from sale_wishes w join sale_events s on s.id = w.sale_id
         where w.device_id = any(ds) and w.wish and coalesce(s.approved, true)
           and coalesce(s.end_date, s.start_date) >= t and s.start_date <= t35
         order by s.start_date, s.id limit 20) x), '[]'::jsonb)))::json;
end $f$;
grant execute on function public.widget_feed(text) to anon, authenticated;

select public.widget_feed_refresh();
select cron.unschedule('widget-feed-cache') where exists (select 1 from cron.job where jobname = 'widget-feed-cache');
select cron.schedule('widget-feed-cache', '2-59/5 * * * *', $c$select public.widget_feed_refresh()$c$);
