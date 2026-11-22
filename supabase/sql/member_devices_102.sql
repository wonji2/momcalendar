-- 로그인하면 찜이 합쳐진다 (사장님 2026-10-25 "로그인도 한번하면 어디서 접속하든 거기로 바로 열리게 해야지")
--   실측: 사장님 폰 한 대에 카톡 인앱(찜 10)·삼성 인터넷(찜 2, 앱(TWA)도 이 저장소)·크롬(찜 14)이 따로 놀았다.
--   찜(wishes)·세일찜(sale_wishes)은 기기 번호(mc_did)에만 붙어 있었기 때문.
--   → member_devices: 로그인한 계정 ↔ 그 계정으로 쓴 기기들. 토큰을 같이 보내면 그 계정의 모든 기기 찜을 한 목록으로 돌려준다.
--   토큰 없이 부르는 옛 화면(라이브 index.html)·비로그인 손님은 전과 똑같이 그 기기 것만.
--   위젯(widget_feed)은 연결된 기기가 어느 계정에 묶여 있으면 그 계정 전체 찜을 보여준다.

create table if not exists public.member_devices (
  kakao_id  text not null,
  device_id text not null,
  linked_at timestamptz not null default now(),
  primary key (kakao_id, device_id)
);
create index if not exists member_devices_device_idx on public.member_devices(device_id);
alter table public.member_devices enable row level security;
revoke all on public.member_devices from anon, authenticated;

-- 이 기기와 같은 계정에 묶인 기기 전부(자기 자신 포함). 토큰이 맞으면 이 기기를 그 계정에 묶는다.
create or replace function public._wish_devices(p_device text, p_token text)
returns text[] language plpgsql security definer set search_path = public as $$
declare v_kid text;
begin
  if p_device is null or p_device !~ '^[A-Za-z0-9_-]{8,64}$' then return array[]::text[]; end if;
  if p_token is not null and p_token <> '' then
    v_kid := _member_from_token(p_token);
    if v_kid is not null then
      insert into member_devices(kakao_id, device_id) values (v_kid, p_device)
      on conflict (kakao_id, device_id) do nothing;
      return array(select device_id from member_devices where kakao_id = v_kid);
    end if;
  end if;
  return array[p_device];
end $$;
revoke all on function public._wish_devices(text, text) from anon, authenticated;

drop function if exists public.wish_list(text);
create or replace function public.wish_list(p_device text, p_token text default null)
returns table(gonggu_id bigint) language plpgsql security definer set search_path = public as $$
begin
  if p_device is null or p_device !~ '^[A-Za-z0-9_-]{8,64}$' then return; end if;
  return query select distinct w.gonggu_id from wishes w where w.device_id = any(_wish_devices(p_device, p_token));
end $$;
grant execute on function public.wish_list(text, text) to anon, authenticated;

drop function if exists public.wish_toggle(text, bigint, boolean);
create or replace function public.wish_toggle(p_device text, p_gonggu bigint, p_on boolean, p_token text default null)
returns json language plpgsql security definer set search_path = public as $$
declare v_cnt int; v_devs text[];
begin
  if p_device is null or p_device !~ '^[A-Za-z0-9_-]{8,64}$' then
    return json_build_object('ok', false, 'msg', 'baddevice');
  end if;
  if p_gonggu is null then return json_build_object('ok', false, 'msg', 'badid'); end if;
  v_devs := _wish_devices(p_device, p_token);
  if p_on then
    select count(*) into v_cnt from wishes where device_id = p_device;   -- 한 기기당 상한(무한 삽입 방지)
    if v_cnt >= 500 then return json_build_object('ok', false, 'msg', 'limit'); end if;
    insert into wishes (device_id, gonggu_id) values (p_device, p_gonggu)
    on conflict (device_id, gonggu_id) do nothing;
  else
    delete from wishes where device_id = any(v_devs) and gonggu_id = p_gonggu;   -- 계정의 다른 기기에서 한 찜도 같이 푼다
  end if;
  return json_build_object('ok', true);
end $$;
grant execute on function public.wish_toggle(text, bigint, boolean, text) to anon, authenticated;

drop function if exists public.sale_wish_list(text);
create or replace function public.sale_wish_list(p_device text, p_token text default null)
returns table(sale_id bigint, wish boolean, bell boolean) language sql security definer set search_path = public as $$
  select w.sale_id, bool_or(w.wish), bool_or(w.bell)
    from sale_wishes w where w.device_id = any(_wish_devices(p_device, p_token))
   group by w.sale_id;
$$;
grant execute on function public.sale_wish_list(text, text) to anon, authenticated;

drop function if exists public.sale_wish_set(text, bigint, boolean, boolean);
create or replace function public.sale_wish_set(p_device text, p_sale bigint, p_wish boolean, p_bell boolean, p_token text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_devs text[];
begin
  if coalesce(length(p_device),0) < 8 or p_sale is null then return; end if;
  if not exists (select 1 from sale_events where id = p_sale) then return; end if;
  v_devs := _wish_devices(p_device, p_token);
  if not coalesce(p_wish,false) and not coalesce(p_bell,false) then
    delete from sale_wishes where device_id = any(v_devs) and sale_id = p_sale;
  else
    -- 계정의 다른 기기에 같은 세일 줄이 있으면 그 표시도 맞춘다(한쪽만 남아 bool_or 로 되살아나지 않게)
    update sale_wishes set wish = coalesce(p_wish,false), bell = coalesce(p_bell,false)
     where device_id = any(v_devs) and device_id <> p_device and sale_id = p_sale;
    insert into sale_wishes(device_id, sale_id, wish, bell)
    values (p_device, p_sale, coalesce(p_wish,false), coalesce(p_bell,false))
    on conflict (device_id, sale_id) do update set wish = excluded.wish, bell = excluded.bell;
  end if;
end $$;
grant execute on function public.sale_wish_set(text, bigint, boolean, boolean, text) to anon, authenticated;

-- 라방 찜도 같은 방식
drop function if exists public.live_wish_list(text);
create or replace function public.live_wish_list(p_device text, p_token text default null)
returns table(show_id bigint) language sql security definer set search_path = public as $$
  select distinct w.show_id from live_wishes w
   where w.device_id = any(_wish_devices(p_device, p_token)) and coalesce(w.start_at, now()) > now() - interval '2 hours';
$$;
grant execute on function public.live_wish_list(text, text) to anon, authenticated;

drop function if exists public.live_wish_set(text, bigint, boolean);
create or replace function public.live_wish_set(p_device text, p_show bigint, p_on boolean, p_token text default null)
returns void language plpgsql security definer set search_path = public as $$
declare st timestamptz; v_devs text[];
begin
  if coalesce(length(p_device),0) < 8 or p_show is null then return; end if;
  v_devs := _wish_devices(p_device, p_token);
  if not coalesce(p_on,false) then delete from live_wishes where device_id = any(v_devs) and show_id = p_show; return; end if;
  select start_at into st from live_shows where id = p_show;
  if st is null then return; end if;   -- 없는 방송 번호는 받지 않는다
  insert into live_wishes(device_id, show_id, start_at) values (p_device, p_show, st)
  on conflict (device_id, show_id) do update set start_at = excluded.start_at;
end $$;
grant execute on function public.live_wish_set(text, bigint, boolean, text) to anon, authenticated;

-- 위젯: 계정 전체 찜 (widget_feed_101 에서 dev → dv 만 바꿈)
create or replace function public.widget_feed(p_widget text default null)
returns json language sql stable security definer set search_path = public as $$
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
$$;
grant execute on function public.widget_feed(text) to anon, authenticated;

notify pgrst, 'reload schema';
