-- admin_home_get: 고장 자동 수리기 결과(autofix) 추가 · DB 한도 500MB→8192MB(Pro, 2026-11-19 밤) — 원본 admin_home_115.sql (2026-11-20)
CREATE OR REPLACE FUNCTION public.admin_home_get()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_kpi jsonb; v_todo jsonb; v_free jsonb; v_rep jsonb; v_rep_at timestamptz; v_pc_at timestamptz; v_radar jsonb; v_db numeric; v_grow numeric; v_fix jsonb; v_fix_at timestamptz;
begin
  if not public.is_app_admin() then raise exception 'forbidden' using errcode = '28000'; end if;

  with e as (
    select event_type, (visited_at > now() - interval '24 hours') cur
      from events where visited_at > now() - interval '48 hours'
       and event_type in ('card_click','hotdeal_open','hotdeal_go','banner_click','sellerbanner_click','search','wish_add','share_click','kakao_login_start','kakao_login_done','pwa_install','push_on')
  ), v as (
    select anonymous_id, (visited_at > now() - interval '24 hours') cur from visits where visited_at > now() - interval '48 hours'
  )
  select jsonb_build_object(
    'cur', (select coalesce(jsonb_object_agg(event_type, n), '{}'::jsonb) from (select event_type, count(*) n from e where cur group by 1) x),
    'prev', (select coalesce(jsonb_object_agg(event_type, n), '{}'::jsonb) from (select event_type, count(*) n from e where not cur group by 1) x),
    'visits', (select count(*) from v where cur), 'visits_prev', (select count(*) from v where not cur),
    'people', (select count(distinct anonymous_id) from v where cur), 'people_prev', (select count(distinct anonymous_id) from v where not cur)
  ) into v_kpi;

  select jsonb_build_object(
    'inq_new', (select count(*) from inquiries where status = 'new'),
    'inq_oldest_days', (select floor(extract(epoch from now() - min(created_at)) / 86400)::int from inquiries where status = 'new'),
    'seller_auth', (select count(*) from sellers where login_insta is not null and login_active = false)
  ) into v_todo;

  v_db := round(pg_database_size(current_database()) / 1048576.0, 1);
  select round((
      -- 행 크기는 통계값(reltuples)으로 — 표 전체 count(*) 는 0.8초+, 정리 직후엔 시간 제한(8초)에 걸렸다(2026-10-26 23:30 500)
      (select count(*) from events where visited_at > now()-interval '7 days') * (pg_total_relation_size('events')::numeric / greatest((select reltuples::numeric from pg_class where oid='public.events'::regclass),1))
    + (select count(*) from visits where visited_at > now()-interval '7 days') * (pg_total_relation_size('visits')::numeric / greatest((select reltuples::numeric from pg_class where oid='public.visits'::regclass),1))
    ) / 7 / 1048576.0, 2) into v_grow;
  v_free := jsonb_build_object('db_mb', v_db, 'db_limit', 8192, 'grow_mb', v_grow,
    'days_left', case when v_grow > 0 then floor((8192 - v_db) / v_grow)::int else null end,
    'events_mb', round(pg_total_relation_size('events') / 1048576.0, 1));

  select payload, updated_at into v_rep, v_rep_at from ops_status where id = 'report';
  select updated_at into v_pc_at from ops_status where id = 'pc';
  select payload, updated_at into v_fix, v_fix_at from ops_status where id = 'red-autofix';   -- 고장 자동 수리기(red_autofix.mjs, 2026-11-20)
  -- 「처리함」(radar_ack_117): 처리 뒤 새로 안 생겼으면 acked=true — 화면은 빨강 대신 「처리함」으로 보인다
  select coalesce(jsonb_agg(to_jsonb(r) || jsonb_build_object(
      'acked', (a.kind is not null and a.acked_at > now() - interval '24 hours'
                and coalesce(r.h24, 0) <= coalesce(a.h24_at_ack, 0)
                and not (now() - a.acked_at > interval '1 hour' and coalesce(r.h1, 0) > 0)),
      'acked_at', to_char(a.acked_at at time zone 'Asia/Seoul', 'MM-DD HH24:MI'))), '[]'::jsonb)
    into v_radar from public.error_radar() r left join public.radar_ack a on a.kind = r.kind;

  return jsonb_build_object(
    'at', to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI'),
    'kpi', v_kpi, 'todo', v_todo, 'free', v_free, 'radar', v_radar,
    'report', coalesce(v_rep, '{}'::jsonb),
    'autofix', coalesce(v_fix, '{}'::jsonb) || jsonb_build_object('age_min', case when v_fix_at is null then null else round(extract(epoch from now() - v_fix_at) / 60)::int end),
    'report_age_min', case when v_rep_at is null then null else round(extract(epoch from now() - v_rep_at) / 60)::int end,
    'pc_age_min', case when v_pc_at is null then null else round(extract(epoch from now() - v_pc_at) / 60)::int end);
end $function$
;
