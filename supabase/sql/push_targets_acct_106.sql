-- 오픈·마감 알림 대상을 계정 단위로 (2026-10-26 금붕어 검토: 로그인 손님은 찜 행이 계정의 다른 기기에 있어 앱으로 알림이 안 갔다)
--   wishes_acct = 찜 (공구, 기기) + 같은 계정(member_devices)에 묶인 다른 기기들. 중복 없이. push_targets·_fcm·_ios 가 wishes 대신 읽는다.
create or replace view public.wishes_acct as
  select distinct gonggu_id, device_id from (
    select gonggu_id, device_id from public.wishes
    union all
    select w.gonggu_id, m2.device_id from public.wishes w
      join public.member_devices m1 on m1.device_id = w.device_id
      join public.member_devices m2 on m2.kakao_id = m1.kakao_id) x;
revoke all on public.wishes_acct from anon, authenticated;
CREATE OR REPLACE FUNCTION public.push_targets()
 RETURNS TABLE(device_id text, endpoint text, p256dh text, auth text, gonggu_id bigint, gonggu_name text, seller text, kind text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with t as (select to_char((now() at time zone 'Asia/Seoul')::date, 'YYYY-MM-DD') d)
  select s.device_id, s.endpoint, s.p256dh, s.auth, g.id, g.name, coalesce(g.influencer, g.insta),
         case when g.open_date = t.d then 'open' else 'end' end as kind
  from wishes_acct w   -- 계정의 다른 기기에서 한 찜도 (2026-10-26)
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
CREATE OR REPLACE FUNCTION public.push_targets_fcm()
 RETURNS TABLE(device_id text, fcm_token text, gonggu_id bigint, gonggu_name text, seller text, kind text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with t as (select to_char((now() at time zone 'Asia/Seoul')::date, 'YYYY-MM-DD') d)
  select s.device_id, s.fcm_token, g.id, g.name, coalesce(g.influencer, g.insta),
         case when g.open_date = t.d then 'open' else 'end' end as kind
  from wishes_acct w   -- 계정의 다른 기기에서 한 찜도 (2026-10-26)
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
$function$
;
CREATE OR REPLACE FUNCTION public.push_targets_ios()
 RETURNS TABLE(device_id text, apns_token text, env text, gonggu_id bigint, gonggu_name text, seller text, kind text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with t as (select to_char((now() at time zone 'Asia/Seoul')::date, 'YYYY-MM-DD') d)
  select s.device_id, s.apns_token, s.env, g.id, g.name, coalesce(g.influencer, g.insta),
         case when g.open_date = t.d then 'open_ios' else 'end_ios' end as kind
  from wishes_acct w   -- 계정의 다른 기기에서 한 찜도 (2026-10-26)
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
$function$
;
