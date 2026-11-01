-- 세일 알림: 시작 전 = 시작일 아침, 이미 시작 = 마감 하루 전 아침 (사장님 2026-10-13 "찜이 아니고 알림 받기")
--  · sale_push_targets 가 kind('start'|'end') 를 돌려준다 — sale_push_log 의 (device,sale,kind) 로 종류별 1번씩만
--  · 돌려주는 칸이 바뀌면 create or replace 가 안 된다 — 먼저 지운다(85번 함수를 이 파일이 대체한다)
drop function if exists public.sale_push_targets();
create or replace function public.sale_push_targets()
returns table(device_id text, endpoint text, p256dh text, auth text, sale_id bigint, brand text, title text, kind text)
language sql stable security definer set search_path = public as $$
  with t as (select to_char((now() at time zone 'Asia/Seoul')::date, 'YYYY-MM-DD') d,
                    to_char((now() at time zone 'Asia/Seoul')::date + 1, 'YYYY-MM-DD') d1)
  select s.device_id, s.endpoint, s.p256dh, s.auth, e.id, e.brand, e.title,
         case when e.start_date = t.d then 'start' else 'end' end as kind
  from sale_wishes w
  join push_subs  s on s.device_id = w.device_id
  join sale_events e on e.id = w.sale_id
  cross join t
  where w.bell
    and e.approved
    and s.fail_count < 5
    and ( e.start_date = t.d                                  -- 오늘 시작
          or (e.end_date <> '' and e.end_date = t.d1 and e.start_date < t.d) )  -- 이미 시작했고 내일이 마지막 날
    and not exists (select 1 from sale_push_log l
                    where l.device_id = s.device_id and l.sale_id = e.id
                      and l.kind = case when e.start_date = t.d then 'start' else 'end' end);
$$;
revoke all on function public.sale_push_targets() from public, anon, authenticated;
grant execute on function public.sale_push_targets() to service_role;
notify pgrst, 'reload schema';
select count(*) as targets_now from public.sale_push_targets();
