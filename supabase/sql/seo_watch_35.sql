-- SEO 자동 갱신 파이프라인 감시 (사장님 지시 2026-08-05: 오류는 제보받지 말고 먼저 찾는다)
--
-- 이 파이프라인은 조용히 망가질 수 있다. 그게 제일 위험하다.
--   · pg_cron 'seo-refresh' 가 죽으면 → 캐시가 어제 것 → 매일 어제 페이지를 다시 만든다
--   · GitHub Actions 가 죽으면 → 페이지가 굳는다
-- 둘 다 화면에 아무 표시가 안 난다. 그래서 캐시 나이를 감시한다.

create or replace function public.check_seo_health()
returns table(kind text, level text, msg text, n int)
language plpgsql
security definer
set search_path = public
as $$
declare
  age_min int;
  brands  int;
begin
  select round(extract(epoch from (now() - updated_at))/60)::int
    into age_min from public.seo_cache where id = 1;

  if age_min is null then
    kind:='seo'; level:='bad'; msg:='검색 노출 데이터 캐시가 아예 없다'; n:=0;
    return next; return;
  end if;

  -- 새벽 4:20 에 갱신되므로 정상이면 최대 24시간+α. 30시간을 넘으면 크론이 멎은 것이다.
  if age_min > 1800 then
    kind:='seo'; level:='bad';
    msg:='검색 노출 데이터가 ' || (age_min/60) || '시간째 갱신되지 않았다 (seo-refresh 크론 확인)';
    n:=age_min/60; return next;
  elsif age_min > 1560 then
    kind:='seo'; level:='warn';
    msg:='검색 노출 데이터가 ' || (age_min/60) || '시간 지났다';
    n:=age_min/60; return next;
  end if;

  -- 집계가 반쯤 깨져 빈 데이터가 캐시에 들어가면 페이지가 통째로 사라진다(실제로 당했다)
  select jsonb_array_length(data->'brands') into brands from public.seo_cache where id = 1;
  if coalesce(brands,0) < 100 then
    kind:='seo'; level:='bad';
    msg:='검색 노출 데이터의 브랜드가 ' || coalesce(brands,0) || '개뿐이다 (집계가 깨졌다)';
    n:=coalesce(brands,0); return next;
  end if;
end $$;

revoke all on function public.check_seo_health() from public, anon, authenticated;
grant execute on function public.check_seo_health() to service_role;

-- 기존 사이트 감시(run_site_watch)가 매시간 15분에 돌면서 함께 쌓도록 얹는다.
create or replace function public.run_seo_watch()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare r record; c int := 0;
begin
  for r in select * from public.check_seo_health() loop
    insert into public.site_alerts(kind, level, msg, n) values (r.kind, r.level, r.msg, r.n);
    c := c + 1;
  end loop;
  return c;
end $$;
revoke all on function public.run_seo_watch() from public, anon, authenticated;
grant execute on function public.run_seo_watch() to service_role;

select cron.unschedule(jobid) from cron.job where jobname = 'seo-health';
select cron.schedule('seo-health', '25 * * * *', $$select public.run_seo_watch();$$);

select * from public.check_seo_health();
