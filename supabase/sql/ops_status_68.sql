-- 운영 현황판(뒷단) 데이터 (2026-09-29, 사장님 "전 라인 다 잘 도는지 검증 가능한 뒷단 웹사이트 — 연결된 모든 채널 포함, 스레드 등등")
--
-- 구조
--   ops_status(id, payload, updated_at) — 이 PC 쪽 상태(예약작업·블로그 마커·스레드·카페·파싱 로그)를 tools/daily/ops_status_push.mjs 가 30분마다 CLI(postgres)로 upsert.
--   ops_status_get() — 관리자(is_app_admin)만. 서버 쪽 상태(pg_cron 실행 기록·오류 레이더·건수)를 그 자리에서 모아 pc 상태와 합쳐 jsonb 로 돌려준다.
--   화면: ops.html (관리자 로그인 → rpc/ops_status_get)
-- ⚠ anon 은 표도 함수도 못 본다(기본 권한 회수 상태 + 명시 grant 는 authenticated 에만). 손님용 아님.
create table if not exists public.ops_status (
  id text primary key,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.ops_status enable row level security;
revoke all on public.ops_status from public, anon, authenticated;

create or replace function public.ops_status_get()
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  v_cron jsonb; v_radar jsonb; v_counts jsonb; v_alerts jsonb; v_pc jsonb; v_pc_at timestamptz; v_edge jsonb; v_bot jsonb;
begin
  if not public.is_app_admin() then raise exception 'forbidden' using errcode = '28000'; end if;
  -- ① pg_cron: 작업별 마지막 실행·상태·24h 실패 수
  select coalesce(jsonb_agg(jsonb_build_object(
      'jobid', j.jobid, 'name', j.jobname, 'schedule', j.schedule, 'active', j.active,
      'last_run', (select to_char(max(start_time) at time zone 'Asia/Seoul','MM-DD HH24:MI') from cron.job_run_details d where d.jobid=j.jobid),
      'last_status', (select status from cron.job_run_details d where d.jobid=j.jobid order by start_time desc limit 1),
      'last_msg', (select left(return_message, 120) from cron.job_run_details d where d.jobid=j.jobid order by start_time desc limit 1),
      'fails24', (select count(*) from cron.job_run_details d where d.jobid=j.jobid and d.status<>'succeeded' and d.start_time>now()-interval '24 hours')
    ) order by j.jobid), '[]'::jsonb) into v_cron from cron.job j;
  -- ② 오류 레이더
  select coalesce(jsonb_agg(jsonb_build_object('상태', r.상태, 'kind', r.kind, 'h1', r.h1, 'h24', r.h24, '임계', r.임계, '설명', r.설명)), '[]'::jsonb) into v_radar from public.error_radar() r;
  -- ③ 건수·최신
  select jsonb_build_object(
    'gonggu_live', (select count(*) from gonggu where approved and end_date >= to_char((now() at time zone 'Asia/Seoul')::date,'YYYY-MM-DD')),
    'gonggu_today_open', (select count(*) from gonggu where approved and open_date = to_char((now() at time zone 'Asia/Seoul')::date,'YYYY-MM-DD')),
    'gonggu_last_insert', (select to_char(max(created_at) at time zone 'Asia/Seoul','MM-DD HH24:MI') from gonggu),
    'gonggu_24h', (select count(*) from gonggu where created_at > now()-interval '24 hours'),
    'hotdeals_live', (select count(*) from hotdeals where expires_at is null or expires_at > now()),
    'hotdeals_today', (select count(*) from hotdeals where deal_day = (now() at time zone 'Asia/Seoul')::date),
    'hotdeals_last_insert', (select to_char(max(created_at) at time zone 'Asia/Seoul','MM-DD HH24:MI') from hotdeals),
    'events_1h', (select count(*) from events where visited_at > now()-interval '1 hour'),
    'events_24h', (select count(*) from events where visited_at > now()-interval '24 hours'),
    'visitors_24h', (select count(*) from visits where visited_at > now()-interval '24 hours'),
    'kakao_bot_24h', (select count(*) from events where event_type='kakao_bot' and visited_at > now()-interval '24 hours'),
    'kakao_bot_last', (select to_char(max(visited_at) at time zone 'Asia/Seoul','MM-DD HH24:MI') from events where event_type='kakao_bot'),
    'login_done_24h', (select count(*) from events where event_type='kakao_login_done' and visited_at > now()-interval '24 hours'),
    'login_fail_24h', (select count(*) from events where event_type='kakao_login_fail' and visited_at > now()-interval '24 hours'),
    'inquiries_open', (select count(*) from inquiries where status='new'),
    'push_subs', (select count(*) from push_subs),
    'banners_active', (select count(*) from banners where active and (show_until is null or show_until > now())),
    'seo_cache_at', (select to_char(updated_at at time zone 'Asia/Seoul','MM-DD HH24:MI') from seo_cache where id=1),
    'click_stats_at', (select to_char(max(updated_at) at time zone 'Asia/Seoul','MM-DD HH24:MI') from gonggu_click_stats),
    'search_stats_at', (select to_char(max(updated_at) at time zone 'Asia/Seoul','MM-DD HH24:MI') from search_trending_stats),
    'site_search_at', (select to_char(max(updated_at) at time zone 'Asia/Seoul','MM-DD HH24:MI') from site_search_stats)
  ) into v_counts;
  -- ④ 최근 감시기 경보 24h
  select coalesce(jsonb_agg(jsonb_build_object('at', to_char(created_at at time zone 'Asia/Seoul','MM-DD HH24:MI'), 'kind', kind, 'msg', left(coalesce(detail::text, ''), 160)) order by created_at desc), '[]'::jsonb)
    into v_alerts from (select * from health_alerts where created_at > now()-interval '24 hours' order by created_at desc limit 40) h;
  -- ⑤ PC 쪽 상태
  select payload, updated_at into v_pc, v_pc_at from ops_status where id='pc';
  return jsonb_build_object('at', to_char(now() at time zone 'Asia/Seoul','YYYY-MM-DD HH24:MI:SS'), 'cron', v_cron, 'radar', v_radar, 'counts', v_counts, 'alerts', v_alerts,
    'pc', coalesce(v_pc, '{}'::jsonb), 'pc_at', to_char(v_pc_at at time zone 'Asia/Seoul','MM-DD HH24:MI'), 'pc_age_min', case when v_pc_at is null then null else round(extract(epoch from (now()-v_pc_at))/60) end);
end $$;
revoke all on function public.ops_status_get() from public, anon;
grant execute on function public.ops_status_get() to authenticated;
select 'ok' as 적용, (select count(*) from public.ops_status) as pc행;
