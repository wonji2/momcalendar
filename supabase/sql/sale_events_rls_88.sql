-- sale_events: 손님(anon)에게는 approved=true 행만 보인다 (2026-10-13 자동 수집기 도입)
--  자동 수집(sale-collect)은 approved=false 로 후보를 쌓는다. 화면 코드가 필터를 빠뜨려도 새지 않게 DB 에서 막는다.
--  service_role(Edge Function·크론)은 RLS 를 건너뛰므로 영향 없음.
alter table public.sale_events enable row level security;
drop policy if exists sale_events_public_read on public.sale_events;
create policy sale_events_public_read on public.sale_events for select to anon, authenticated using (approved = true);
grant select on public.sale_events to anon, authenticated;
notify pgrst, 'reload schema';
select relrowsecurity as rls_on, (select count(*) from public.sale_events) as total_as_postgres from pg_class where oid = 'public.sale_events'::regclass;
