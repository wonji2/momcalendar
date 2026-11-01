-- events 보관 정책 — 무료 플랜 DB 500MB 대응 (사장님 결정 2026-09-29 "무료 플랜으로")
--
-- 왜: events 가 122MB 로 DB 의 절반이고 9월에만 366,225행이 쌓였다(8월의 3.2배). 이 속도면 하루 +2.7MB,
--     visits·visitors 까지 더하면 월 +100MB — 217MB 에서 시작해 **약 2.5개월 뒤 500MB(읽기 전용)** 에 닿는다.
-- 규칙(사장님 "한 번 호출하면 전부 저장" 과 충돌하지 않게): **지우기 전에 두 가지를 남긴다**
--   ① 원본 행은 work-backup/db-export/events_<월>.jsonl 에 그대로 (tools/daily/db_export.mjs)
--   ② 날짜·종류별 건수는 events_daily 에 영구 보관 → 옛 기간 추이 그래프는 계속 나온다
-- 그 다음에야 raw 행을 지운다. **내보내기가 따라잡은 id 까지만** 지운다(p_max_id) — 안 내보낸 행은 절대 안 지운다.

create table if not exists public.events_daily (
  day date not null,
  event_type text not null,
  n integer not null,
  primary key (day, event_type)
);
revoke all on table public.events_daily from public, anon, authenticated;

-- 날짜·종류별 건수 적재(같은 날을 다시 돌려도 안전 — 덮어쓴다). 오늘 것은 아직 안 끝났으니 안 담는다
create or replace function public.events_rollup(p_before date default null)
returns integer language plpgsql security definer set search_path = public as $$
declare v_cut date := coalesce(p_before, (now() at time zone 'Asia/Seoul')::date); v_n integer;
begin
  insert into events_daily(day, event_type, n)
  select (visited_at at time zone 'Asia/Seoul')::date d, event_type, count(*)
    from events where (visited_at at time zone 'Asia/Seoul')::date < v_cut
    group by 1, 2
  on conflict (day, event_type) do update set n = excluded.n;
  get diagnostics v_n = row_count; return v_n;
end $$;
revoke all on function public.events_rollup(date) from public, anon, authenticated;

-- 오래된 raw 행 삭제. **반드시** ① 롤업이 그 날짜까지 있고 ② 내보내기가 그 id 까지 끝났을 때만 지운다.
-- p_max_id = work-backup/db-export/_watermarks.json 의 events 값. 안 주면 아무것도 안 지운다.
create or replace function public.events_purge(p_keep_days integer default 120, p_max_id bigint default null, p_apply boolean default false)
returns text language plpgsql security definer set search_path = public as $$
declare v_cut timestamptz; v_cutday date; v_n bigint; v_roll bigint; v_del bigint := 0;
begin
  if p_max_id is null then return '🔴 p_max_id(내보내기 물높이) 없이는 아무것도 지우지 않는다'; end if;
  v_cut := now() - make_interval(days => p_keep_days);
  v_cutday := (v_cut at time zone 'Asia/Seoul')::date;
  select count(*) into v_n from events where visited_at < v_cut and id <= p_max_id;
  select count(*) into v_roll from events_daily where day < v_cutday;
  if v_roll = 0 and v_n > 0 then return format('🔴 롤업 먼저: events_daily 에 %s 이전 자료가 없다', v_cutday); end if;
  if p_apply then
    delete from events where visited_at < v_cut and id <= p_max_id;
    get diagnostics v_del = row_count;
    insert into health_alerts(kind, detail) values ('events_보관정리', format('%s일 이전 %s행 삭제(내보낸 id %s 까지)', p_keep_days, v_del, p_max_id));
  end if;
  return format('%s일 이전·내보낸 id %s 까지 대상 %s행%s', p_keep_days, p_max_id, v_n,
    case when p_apply then format(' → %s행 삭제됨', v_del) else ' (시험만 함 — 지우려면 p_apply=true)' end);
end $$;
revoke all on function public.events_purge(integer, bigint, boolean) from public, anon, authenticated;

-- ⚠ 이 파일의 events_rollup·events_purge 는 2026-09-29 저녁 retention_fix_72.sql 로 **덮어써졌다**(경계일 요약이 덮이는 결함).
--    지금 서버에 있는 것은 72 판이다. 이 파일은 표 정의(events_daily)와 이력용으로만 본다.
-- 롤업 크론은 72 에서 KST 04:10 으로 옮겼다(정리 작업 05:20 과 겹치지 않게)
select cron.unschedule(jobid) from cron.job where jobname = 'events-rollup';
select cron.schedule('events-rollup', '20 20 * * *', $$select public.events_rollup()$$);

select public.events_rollup() as 롤업행수;
select public.events_purge(120, null, false) as 삭제시험;
