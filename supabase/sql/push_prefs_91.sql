-- 알림 세분화 (사장님 2026-10-23 앱 디벨롭 결정): 알림은 찜만 · 종류별 끄고 켜기(공구/핫딜/세일/이벤트) · 문구 앞에 [오늘 오픈]/[오늘 마감]
--  · push_subs(웹푸시)·push_ios(아이폰) 에 prefs jsonb — 기본 전부 켬
--  · push_set_prefs(device, prefs): 손님이 설정 시트에서 바꾼다 (anon 허용, 자기 device_id 행만)
--  · push_targets()/push_targets_ios(): 오늘 오픈 + 오늘 마감 두 종류(kind) · prefs.gonggu 가 false 면 제외
--  · sale_push_targets(): prefs.sale 이 false 면 제외
alter table public.push_subs add column if not exists prefs jsonb not null default '{"gonggu":true,"hotdeal":true,"sale":true,"event":true}'::jsonb;
alter table public.push_ios  add column if not exists prefs jsonb not null default '{"gonggu":true,"hotdeal":true,"sale":true,"event":true}'::jsonb;

create or replace function public.push_set_prefs(p_device text, p_prefs jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v jsonb;
begin
  if p_device is null or length(p_device) < 8 or length(p_device) > 80 then return '{"ok":false}'::jsonb; end if;
  -- 네 키만 받는다 (그 밖의 키·거대한 값은 버린다)
  v := jsonb_build_object(
    'gonggu',  coalesce((p_prefs->>'gonggu')::boolean,  true),
    'hotdeal', coalesce((p_prefs->>'hotdeal')::boolean, true),
    'sale',    coalesce((p_prefs->>'sale')::boolean,    true),
    'event',   coalesce((p_prefs->>'event')::boolean,   true));
  update public.push_subs set prefs = v where device_id = p_device;
  update public.push_ios  set prefs = v where device_id = p_device;
  return jsonb_build_object('ok', true, 'prefs', v);
end $$;
grant execute on function public.push_set_prefs(text, jsonb) to anon, authenticated;

-- 웹푸시 대상: 오늘 오픈(kind=open) + 오늘 마감(kind=end)
drop function if exists public.push_targets();
create or replace function public.push_targets()
returns table(device_id text, endpoint text, p256dh text, auth text, gonggu_id bigint, gonggu_name text, seller text, kind text)
language sql stable set search_path to 'public' as $$
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
$$;

-- 아이폰 대상: 같은 두 종류 (kind=open_ios / end_ios)
drop function if exists public.push_targets_ios();
create or replace function public.push_targets_ios()
returns table(device_id text, apns_token text, env text, gonggu_id bigint, gonggu_name text, seller text, kind text)
language sql stable set search_path to 'public' as $$
  with t as (select to_char((now() at time zone 'Asia/Seoul')::date, 'YYYY-MM-DD') d)
  select s.device_id, s.apns_token, s.env, g.id, g.name, coalesce(g.influencer, g.insta),
         case when g.open_date = t.d then 'open_ios' else 'end_ios' end as kind
  from wishes w
  join push_ios s on s.device_id = w.device_id
  join gonggu   g on g.id        = w.gonggu_id
  cross join t
  where g.approved = true
    and (g.open_date = t.d or g.end_date = t.d)
    and s.fail_count < 5
    and coalesce((s.prefs->>'gonggu')::boolean, true)
    and not exists (select 1 from push_log l
                    where l.device_id = s.device_id and l.gonggu_id = g.id
                      and l.kind = case when g.open_date = t.d then 'open_ios' else 'end_ios' end);
$$;

-- 세일 알림: prefs.sale 존중
create or replace function public.sale_push_targets()
returns table(device_id text, endpoint text, p256dh text, auth text, sale_id bigint, brand text, title text, kind text)
language sql stable security definer set search_path to 'public' as $$
  with t as (select to_char((now() at time zone 'Asia/Seoul')::date, 'YYYY-MM-DD') d)
  select s.device_id, s.endpoint, s.p256dh, s.auth, e.id, e.brand, e.title, 'start'::text as kind
  from sale_wishes w
  join push_subs  s on s.device_id = w.device_id
  join sale_events e on e.id = w.sale_id
  cross join t
  where w.bell
    and e.approved
    and s.fail_count < 5
    and coalesce((s.prefs->>'sale')::boolean, true)
    and e.start_date = t.d
    and not exists (select 1 from sale_push_log l
                    where l.device_id = s.device_id and l.sale_id = e.id and l.kind = 'start');
$$;
select 'ok' as done, (select count(*) from push_subs) web_subs, (select count(*) from push_ios) ios_subs;
