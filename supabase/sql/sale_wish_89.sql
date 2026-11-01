-- 세일 알림은 **오픈 첫날 아침에만** (사장님 2026-10-14 "세일 알림 울리는거 오픈 첫날만 알림 받기로 해 지금 진행중인건 알림 없애")
--  · 86번의 「이미 시작했고 내일이 마지막 날 → 마감 하루 전 알림(kind='end')」 을 없앤다. 돌려주는 칸은 그대로라 create or replace 로 된다.
--  · 이미 시작한 세일에 켜져 있던 종(bell)은 끈다 — 화면에서도 종 버튼이 사라지므로 켜진 채 남으면 끌 길이 없다(찜 행은 지우지 않는다).
--  되돌리기: supabase/sql/sale_wish_86.sql 재실행.
create or replace function public.sale_push_targets()
returns table(device_id text, endpoint text, p256dh text, auth text, sale_id bigint, brand text, title text, kind text)
language sql stable security definer set search_path = public as $$
  with t as (select to_char((now() at time zone 'Asia/Seoul')::date, 'YYYY-MM-DD') d)
  select s.device_id, s.endpoint, s.p256dh, s.auth, e.id, e.brand, e.title, 'start'::text as kind
  from sale_wishes w
  join push_subs  s on s.device_id = w.device_id
  join sale_events e on e.id = w.sale_id
  cross join t
  where w.bell
    and e.approved
    and s.fail_count < 5
    and e.start_date = t.d                                    -- 오늘 시작하는 것만
    and not exists (select 1 from sale_push_log l
                    where l.device_id = s.device_id and l.sale_id = e.id and l.kind = 'start');
$$;
revoke all on function public.sale_push_targets() from public, anon, authenticated;
grant execute on function public.sale_push_targets() to service_role;

with u as (
  update sale_wishes w set bell = false
  from sale_events e
  where e.id = w.sale_id and w.bell
    and e.start_date <= to_char((now() at time zone 'Asia/Seoul')::date, 'YYYY-MM-DD')
  returning w.sale_id)
select (select count(*) from u) as bells_turned_off, (select count(*) from public.sale_push_targets()) as targets_now;
notify pgrst, 'reload schema';
