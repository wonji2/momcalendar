-- 통합 지표 웹 카드 넓히기 (2026-11-25) — 28일·7일 활성 사용자·7일 신규·평균 참여 시간. 원판 supabase/sql/analytics_daily_183.sql 의 analytics_overview 에 줄만 더했다(나머지 그대로)
CREATE OR REPLACE FUNCTION public.analytics_overview(p_days integer DEFAULT 28)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  d0 date := (now() at time zone 'Asia/Seoul')::date;
  p  integer := greatest(1, least(coalesce(p_days, 28), 120));
  v_web jsonb; v_and jsonb; v_ios jsonb; v_cvr jsonb;
begin
  if not public.is_app_admin() then raise exception 'forbidden' using errcode = '28000'; end if;

  -- ① 웹 (GA4)
  select jsonb_build_object(
    'd1',       coalesce((select value from analytics_daily where source='ga4' and metric='active_users' and dim='' and day = d0 - 1), 0),
    'd2',       coalesce((select value from analytics_daily where source='ga4' and metric='active_users' and dim='' and day = d0 - 2), 0),
    'users7',   coalesce((select sum(value) from analytics_daily where source='ga4' and metric='active_users' and dim='' and day > d0 - 8 and day <= d0 - 1), 0),
    'views7',   coalesce((select sum(value) from analytics_daily where source='ga4' and metric='page_views'  and dim='' and day > d0 - 8 and day <= d0 - 1), 0),
    -- 2026-11-25: GA4 「사용자」 보고서 값 — 28일·7일 활성 사용자(마지막 날 값), 7일 신규 사용자, 7일 평균 참여 시간(초 = 참여 시간 합 ÷ 활성 사용자 합). 값이 없으면 null(0 으로 채우지 않는다)
    'a28',      (select value from analytics_daily where source='ga4' and metric='active_28d' and dim='' and day <= d0 - 1 order by day desc limit 1),
    'a28_prev', (select value from analytics_daily where source='ga4' and metric='active_28d' and dim='' and day <= d0 - 8 order by day desc limit 1),
    'a7',       (select value from analytics_daily where source='ga4' and metric='active_7d'  and dim='' and day <= d0 - 1 order by day desc limit 1),
    'new7',     (select sum(value) from analytics_daily where source='ga4' and metric='new_users' and dim='' and day > d0 - 8 and day <= d0 - 1),
    'eng7',     (select round(sum(e.value) / nullif(sum(u.value), 0)) from analytics_daily e join analytics_daily u on u.day = e.day and u.source='ga4' and u.metric='active_users' and u.dim=''
                  where e.source='ga4' and e.metric='engagement_sec' and e.dim='' and e.day > d0 - 8 and e.day <= d0 - 1),
    'series28', coalesce((select jsonb_agg(jsonb_build_object('day', day, 'v', value) order by day)
                            from analytics_daily where source='ga4' and metric='active_28d' and dim='' and day > d0 - p), '[]'::jsonb),
    'series',   coalesce((select jsonb_agg(jsonb_build_object('day', day, 'v', value) order by day)
                            from analytics_daily where source='ga4' and metric='active_users' and dim='' and day > d0 - p), '[]'::jsonb),
    'channels', coalesce((select jsonb_agg(jsonb_build_object('dim', replace(dim,'channel:',''), 'v', v) order by v desc)
                            from (select dim, sum(value) v from analytics_daily
                                   where source='ga4' and metric='sessions' and dim like 'channel:%' and day > d0 - p
                                   group by dim order by 2 desc limit 6) t), '[]'::jsonb),
    'ai',       coalesce((select jsonb_agg(jsonb_build_object('dim', replace(dim,'source:',''), 'v', v) order by v desc)
                            from (select dim, sum(value) v from analytics_daily
                                   where source='ga4' and metric='sessions' and dim like 'source:%' and day > d0 - p
                                   group by dim order by 2 desc limit 6) t), '[]'::jsonb)
  ) into v_web;

  -- ② 안드로이드 (Play 벌크)
  select jsonb_build_object(
    'installs28', coalesce((select sum(value) from analytics_daily where source='play' and metric='device_installs'   and dim='' and day > d0 - p), 0),
    'uninst28',   coalesce((select sum(value) from analytics_daily where source='play' and metric='device_uninstalls' and dim='' and day > d0 - p), 0),
    'last_day',   (select max(day) from analytics_daily where source='play'),
    'last_active',(select value from analytics_daily where source='play' and metric='active_device_installs' and dim=''
                    order by day desc limit 1),
    'series',     coalesce((select jsonb_agg(jsonb_build_object('day', day, 'v', value) order by day)
                              from analytics_daily where source='play' and metric='device_installs' and dim='' and day > d0 - 62), '[]'::jsonb)
  ) into v_and;

  -- ③ 애플 (App Store Connect)
  select jsonb_build_object(
    'first28', coalesce((select sum(value) from analytics_daily where source='apple' and metric='downloads' and dim='type:first'      and day > d0 - p), 0),
    'redl28',  coalesce((select sum(value) from analytics_daily where source='apple' and metric='downloads' and dim='type:redownload' and day > d0 - p), 0),
    'imp28',   coalesce((select sum(value) from analytics_daily where source='apple' and metric='impressions' and dim='' and day > d0 - p), 0),
    'ppv28',   coalesce((select sum(value) from analytics_daily where source='apple' and metric='page_views'  and dim='' and day > d0 - p), 0),
    'impu28',  coalesce((select sum(value) from analytics_daily where source='apple' and metric='impressions_unique' and dim='' and day > d0 - p), 0),  -- 전환율 분모(고유 노출) — 화면이 (최초+재다운로드)÷고유노출 을 계산한다
    'last_day',(select max(day) from analytics_daily where source='apple'),
    'series',  coalesce((select jsonb_agg(jsonb_build_object('day', day, 'v', value) order by day)
                           from analytics_daily where source='apple' and metric='downloads' and dim='type:first' and day > d0 - p), '[]'::jsonb),
    'rank',    (select payload -> 'chart_rank' from analytics_manual where id='app_store')
  ) into v_ios;

  -- ④ 웹→앱 전환 (참고치 — 정확한 퍼널이 아니다. 화면에도 그렇게 적는다)
  select jsonb_build_object(
    'cta28',    coalesce((select sum(value) from analytics_daily where source='ga4' and metric='app_cta' and day > d0 - p), 0),
    'cta_d1',   (select sum(value) from analytics_daily where source='ga4' and metric='app_cta' and day = d0 - 1),   -- 전일 대비용(값이 없으면 null — 0 으로 채우지 않는다)
    'cta_d2',   (select sum(value) from analytics_daily where source='ga4' and metric='app_cta' and day = d0 - 2),
    'dl28',     coalesce((select sum(value) from analytics_daily where source='apple' and metric='downloads' and dim='type:first' and day > d0 - p), 0)
              + coalesce((select sum(value) from analytics_daily where source='play'  and metric='device_installs' and day > d0 - p), 0)
  ) into v_cvr;

  return jsonb_build_object(
    'ok', true, 'today', d0, 'days', p,
    'web', v_web, 'android', v_and, 'apple', v_ios, 'cvr', v_cvr,
    'manual', coalesce((select jsonb_object_agg(id, jsonb_build_object('as_of', as_of, 'payload', payload)) from analytics_manual), '{}'::jsonb),
    'meta', coalesce((select jsonb_agg(jsonb_build_object('source', source, 'status', status, 'note', note,
                                                          'last_ok_at', to_char(last_ok_at at time zone 'Asia/Seoul','MM-DD HH24:MI'),
                                                          'last_try_at', to_char(last_try_at at time zone 'Asia/Seoul','MM-DD HH24:MI'))
                            order by source) from analytics_meta), '[]'::jsonb),
    'served_at', to_char(now() at time zone 'Asia/Seoul','YYYY-MM-DD HH24:MI')
  );
end $function$;
revoke all on function public.analytics_overview(integer) from public, anon;
grant execute on function public.analytics_overview(integer) to authenticated;
