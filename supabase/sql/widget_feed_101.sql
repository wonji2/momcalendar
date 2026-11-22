-- 위젯 v5 — 나만의 캘린더 (사장님 2026-10-24 "내찜보기 위젯 이어야지 나만의 캘린더 만드는거니까" · "찜연결도 다 해놔")
--   위젯은 자기 번호(widget_id, 폰에서 만든 무작위 값)만 안다. 사이트 찜은 브라우저의 mc_did(기기 번호)에 붙어 있다.
--   → 위젯에서 앱(사이트)을 열 때 ?wdid=<widget_id> 를 붙이고, 사이트가 앱 안(referrer android-app://com.wantsb.momcalendar)일 때만
--     widget_bind(widget_id, mc_did) 를 부른다. widget_feed(p_widget) 가 그 짝으로 내 찜(공구·세일)을 돌려준다.
--   개인 데이터는 그 위젯 번호를 아는 폰에만 간다(번호는 위젯 밖으로 안 나간다). 표는 손님이 직접 못 읽는다(RPC 만).
--   99 판(widget_feed())을 대신한다 — 인자 없이 부르는 옛 앱(v3)도 그대로 돈다(p_widget 기본값 null).

create table if not exists public.widget_link (
  widget_id  text primary key,
  device_id  text not null,
  updated_at timestamptz not null default now()
);
alter table public.widget_link enable row level security;
revoke all on public.widget_link from anon, authenticated;

create or replace function public.widget_bind(p_widget text, p_device text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if p_widget is null or p_widget !~ '^w[A-Za-z0-9]{15,40}$' then return false; end if;
  if p_device is null or p_device !~ '^[A-Za-z0-9_-]{8,64}$' then return false; end if;
  insert into widget_link(widget_id, device_id) values (p_widget, p_device)
  on conflict (widget_id) do update set device_id = excluded.device_id, updated_at = now();
  return true;
end $$;
grant execute on function public.widget_bind(text, text) to anon, authenticated;

drop function if exists public.widget_feed();
create or replace function public.widget_feed(p_widget text default null)
returns json language sql stable security definer set search_path = public as $$
  with d as (select to_char((now() at time zone 'Asia/Seoul')::date,'YYYY-MM-DD') t,
                    to_char((now() at time zone 'Asia/Seoul')::date + 35,'YYYY-MM-DD') t35),
       dev as (select l.device_id from widget_link l where p_widget is not null and l.widget_id = p_widget),
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
        select g.id, g.name, g.major, g.open_date, g.end_date, coalesce(nullif(g.influencer,''), g.insta) seller,
               (g.insta = 'momcal_') as partner
          from wishes w join gonggu g on g.id = w.gonggu_id, d
         where w.device_id = (select device_id from dev)
           and g.approved and not g.always and g.end_date >= d.t and g.open_date <= d.t35
         order by g.open_date, g.id limit 40) x), '[]'::json),
    'sale_wish', coalesce((select json_agg(x) from (
        select s.id, s.brand, s.title, s.start_date, s.end_date
          from sale_wishes w join sale_events s on s.id = w.sale_id, d
         where w.device_id = (select device_id from dev) and w.wish and coalesce(s.approved, true)
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
$$;
grant execute on function public.widget_feed(text) to anon, authenticated;
notify pgrst, 'reload schema';
