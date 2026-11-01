-- 검증자 지적 반영 (2026-10-26 밤)
-- ① 웹 푸시(push_targets)는 계정 단위를 되돌린다 — 한 폰의 크롬·삼성·PWA 구독마다 같은 알림이 중복으로 갔다. 계정 단위는 앱(FCM·iOS)으로만.
-- ② 세일·라방 앱 푸시도 계정 단위(sale_wishes_acct·live_wishes_acct) — 공구와 맞춘다.
-- ③ 찜 옮기기는 기기번호를 주소에 싣지 않는다 → 10분짜리 일회용 표(wish_move_ticket) 를 싣고, 앱이 그 표로 옮긴다(wish_move_claim). wish_move 는 손님이 직접 못 부르게.
--    옮긴 수는 실제로 새로 들어간 줄만 센다(겹쳐서 버린 줄 제외). 상한을 넘으면 아무것도 지우지 않는다.
CREATE OR REPLACE FUNCTION public.push_targets()
 RETURNS TABLE(device_id text, endpoint text, p256dh text, auth text, gonggu_id bigint, gonggu_name text, seller text, kind text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with t as (select to_char((now() at time zone 'Asia/Seoul')::date, 'YYYY-MM-DD') d)
  select s.device_id, s.endpoint, s.p256dh, s.auth, g.id, g.name, coalesce(g.influencer, g.insta),
         case when g.open_date = t.d then 'open' else 'end' end as kind
  from wishes w
  join push_subs s on s.device_id = w.device_id
  join gonggu    g on g.id        = w.gonggu_id
  cross join t
  where g.approved = true
    and (g.open_date = t.d or g.end_date = t.d)
    and s.fail_count < 5
    and coalesce((s.prefs->>'gonggu')::boolean, true)
    and not exists (select 1 from push_log l
                    where l.device_id = s.device_id and l.gonggu_id = g.id
                      and l.kind = case when g.open_date = t.d then 'open' else 'end' end);
$function$
;
create or replace view public.sale_wishes_acct as
  select sale_id, device_id, bool_or(wish) wish, bool_or(bell) bell from (
    select sale_id, device_id, wish, bell from public.sale_wishes
    union all
    select w.sale_id, m2.device_id, w.wish, w.bell from public.sale_wishes w
      join public.member_devices m1 on m1.device_id = w.device_id
      join public.member_devices m2 on m2.kakao_id = m1.kakao_id) x group by 1,2;
create or replace view public.live_wishes_acct as
  select distinct show_id, device_id from (
    select show_id, device_id from public.live_wishes
    union all
    select w.show_id, m2.device_id from public.live_wishes w
      join public.member_devices m1 on m1.device_id = w.device_id
      join public.member_devices m2 on m2.kakao_id = m1.kakao_id) x;
revoke all on public.sale_wishes_acct, public.live_wishes_acct from anon, authenticated;
CREATE OR REPLACE FUNCTION public.sale_push_targets_fcm()
 RETURNS TABLE(device_id text, fcm_token text, sale_id bigint, brand text, title text, kind text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with t as (select to_char((now() at time zone 'Asia/Seoul')::date, 'YYYY-MM-DD') d)
  select s.device_id, s.fcm_token, e.id, e.brand, e.title, 'start'::text as kind
  from sale_wishes_acct w   -- 계정의 다른 기기 찜도 (2026-10-26)
  join push_fcm    s on s.device_id = w.device_id
  join sale_events e on e.id = w.sale_id
  cross join t
  where w.bell
    and e.approved
    and s.fail_count < 5
    and coalesce((s.prefs->>'sale')::boolean, true)
    and e.start_date = t.d
    and not exists (select 1 from sale_push_log l
                    where l.device_id = s.device_id and l.sale_id = e.id and l.kind = 'start');
$function$
;
CREATE OR REPLACE FUNCTION public.live_push_targets_fcm()
 RETURNS TABLE(device_id text, fcm_token text, show_id bigint, title text, channel_name text, start_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select s.device_id, s.fcm_token, l.id, l.title, l.channel_name, l.start_at
  from live_wishes_acct w   -- 계정의 다른 기기 찜도 (2026-10-26)
  join push_fcm   s on s.device_id = w.device_id
  join live_shows l on l.id = w.show_id
  where l.start_at > now() and l.start_at <= now() + interval '12 minutes'
    and s.fail_count < 5
    and coalesce((s.prefs->>'sale')::boolean, true)
    and not exists (select 1 from live_push_log g where g.device_id = s.device_id and g.show_id = l.id);
$function$
;
create table if not exists public.wish_move_tickets (
  token text primary key, device_id text not null, expires_at timestamptz not null default now() + interval '10 minutes');
alter table public.wish_move_tickets enable row level security;
revoke all on public.wish_move_tickets from anon, authenticated;

create or replace function public.wish_move_ticket(p_from text)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare t text;
begin
  if p_from is null or p_from !~ '^[A-Za-z0-9_-]{8,64}$' then return null; end if;
  delete from wish_move_tickets where expires_at < now();
  t := encode(gen_random_bytes(12), 'hex');
  insert into wish_move_tickets(token, device_id) values (t, p_from);
  return t;
end $$;
grant execute on function public.wish_move_ticket(text) to anon, authenticated;

create or replace function public.wish_move(p_from text, p_to text)
returns json language plpgsql security definer set search_path = public as $$
declare g int := 0; s int := 0; l int := 0;
begin
  if p_from is null or p_to is null or p_from = p_to
     or p_from !~ '^[A-Za-z0-9_-]{8,64}$' or p_to !~ '^[A-Za-z0-9_-]{8,64}$' then return json_build_object('ok', false); end if;
  if (select count(*) from wishes where device_id = p_from) > 500
     or (select count(*) from sale_wishes where device_id = p_from) > 300
     or (select count(*) from live_wishes where device_id = p_from) > 300 then return json_build_object('ok', false, 'msg', 'too_many'); end if;
  with ins as (insert into wishes(device_id, gonggu_id) select p_to, gonggu_id from wishes where device_id = p_from
               on conflict (device_id, gonggu_id) do nothing returning 1) select count(*) into g from ins;
  delete from wishes where device_id = p_from;
  with ins as (insert into sale_wishes(device_id, sale_id, wish, bell) select p_to, sale_id, wish, bell from sale_wishes where device_id = p_from
               on conflict (device_id, sale_id) do update set wish = sale_wishes.wish or excluded.wish, bell = sale_wishes.bell or excluded.bell returning 1) select count(*) into s from ins;
  delete from sale_wishes where device_id = p_from;
  with ins as (insert into live_wishes(device_id, show_id, start_at) select p_to, show_id, start_at from live_wishes where device_id = p_from
               on conflict (device_id, show_id) do nothing returning 1) select count(*) into l from ins;
  delete from live_wishes where device_id = p_from;
  return json_build_object('ok', true, 'gonggu', g, 'sale', s, 'live', l);
end $$;
revoke execute on function public.wish_move(text, text) from anon, authenticated, public;

create or replace function public.wish_move_claim(p_token text, p_to text)
returns json language plpgsql security definer set search_path = public as $$
declare d text;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{24}$' then return json_build_object('ok', false); end if;
  delete from wish_move_tickets where token = p_token and expires_at > now() returning device_id into d;   -- 한 번 쓰면 끝
  if d is null then return json_build_object('ok', false, 'msg', 'expired'); end if;
  return wish_move(d, p_to);
end $$;
grant execute on function public.wish_move_claim(text, text) to anon, authenticated;
notify pgrst, 'reload schema';
