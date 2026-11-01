-- 안드로이드 웹뷰 앱 알림 대상 (2026-10-26) — 웹푸시 함수(push_targets·sale_push_targets·live_push_targets)와 **같은 규칙**,
--   받는 곳만 push_subs(웹푸시) → push_fcm(FCM 토큰). 기록 표(push_log·sale_push_log·live_push_log)와 kind 도 웹과 같다
--   → 같은 기기에 같은 알림이 두 번 가지 않는다(웹뷰 앱엔 웹푸시가 없어 기기 번호가 겹치지 않는다).
--   발송: Edge send-fcm-push?mode=open|sale|live (pg_cron). 손님(anon)은 못 부른다.
create or replace function public.push_targets_fcm()
returns table(device_id text, fcm_token text, gonggu_id bigint, gonggu_name text, seller text, kind text)
language sql stable set search_path to 'public' as $$
  with t as (select to_char((now() at time zone 'Asia/Seoul')::date, 'YYYY-MM-DD') d)
  select s.device_id, s.fcm_token, g.id, g.name, coalesce(g.influencer, g.insta),
         case when g.open_date = t.d then 'open' else 'end' end as kind
  from wishes w
  join push_fcm s on s.device_id = w.device_id
  join gonggu   g on g.id        = w.gonggu_id
  cross join t
  where g.approved = true
    and (g.open_date = t.d or g.end_date = t.d)
    and s.fail_count < 5
    and coalesce((s.prefs->>'gonggu')::boolean, true)
    and not exists (select 1 from push_log l
                    where l.device_id = s.device_id and l.gonggu_id = g.id
                      and l.kind = case when g.open_date = t.d then 'open' else 'end' end);
$$;

create or replace function public.sale_push_targets_fcm()
returns table(device_id text, fcm_token text, sale_id bigint, brand text, title text, kind text)
language sql stable security definer set search_path to 'public' as $$
  with t as (select to_char((now() at time zone 'Asia/Seoul')::date, 'YYYY-MM-DD') d)
  select s.device_id, s.fcm_token, e.id, e.brand, e.title, 'start'::text as kind
  from sale_wishes w
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
$$;

create or replace function public.live_push_targets_fcm()
returns table(device_id text, fcm_token text, show_id bigint, title text, channel_name text, start_at timestamptz)
language sql stable security definer set search_path to 'public' as $$
  select s.device_id, s.fcm_token, l.id, l.title, l.channel_name, l.start_at
  from live_wishes w
  join push_fcm   s on s.device_id = w.device_id
  join live_shows l on l.id = w.show_id
  where l.start_at > now() and l.start_at <= now() + interval '12 minutes'
    and s.fail_count < 5
    and coalesce((s.prefs->>'sale')::boolean, true)
    and not exists (select 1 from live_push_log g where g.device_id = s.device_id and g.show_id = l.id);
$$;

-- 죽은 토큰(앱 삭제 등): 5 를 더해 바로 대상에서 뺀다 — 앱을 다시 켜면 push_fcm_upsert 가 0 으로 되돌린다
create or replace function public.push_fcm_fail(p_token text)
returns void language sql set search_path to 'public' as $$
  update push_fcm set fail_count = fail_count + 5 where fcm_token = p_token;
$$;

revoke all on function public.push_targets_fcm() from public, anon, authenticated;
revoke all on function public.sale_push_targets_fcm() from public, anon, authenticated;
revoke all on function public.live_push_targets_fcm() from public, anon, authenticated;
revoke all on function public.push_fcm_fail(text) from public, anon, authenticated;
