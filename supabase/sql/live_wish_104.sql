-- 라방 알림도 기기의 「세일 알림」 설정을 따른다 (검증자 2026-10-24: 「전체 알림」을 꺼도 라방 알림은 나갔다 — sale·공구 대상 함수는 prefs 를 보는데 라방만 안 봤다)
--  세일/라방은 한 탭이라 'sale' 키를 같이 쓴다. 되돌리기: live_wish_103.sql 의 함수 정의 재실행
create or replace function public.live_push_targets()
returns table(device_id text, endpoint text, p256dh text, auth text, show_id bigint, title text, channel_name text, start_at timestamptz)
language sql stable security definer set search_path = public as $$
  select s.device_id, s.endpoint, s.p256dh, s.auth, l.id, l.title, l.channel_name, l.start_at
  from live_wishes w
  join push_subs  s on s.device_id = w.device_id
  join live_shows l on l.id = w.show_id
  where l.start_at > now() and l.start_at <= now() + interval '12 minutes'
    and s.fail_count < 5
    and coalesce((s.prefs->>'sale')::boolean, true)
    and not exists (select 1 from live_push_log g where g.device_id = s.device_id and g.show_id = l.id);
$$;
revoke all on function public.live_push_targets() from public, anon, authenticated;
grant execute on function public.live_push_targets() to service_role;
select position('prefs' in pg_get_functiondef('public.live_push_targets'::regproc)) > 0 as has_prefs;
