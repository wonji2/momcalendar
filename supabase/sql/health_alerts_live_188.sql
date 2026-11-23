-- 경보 화면에는 「지금 살아 있는 고장」만 (사장님 2026-11-23 「고친 경보는 아예 오류 화면에서 안 보이게 해」)
--   전에는 health_alerts 에 「해결됨」이 없어, 고친 뒤에도 24~48시간 내내 같은 경보가 목록에 남았다(소분류필터이탈 66줄 등).
--   ① resolved_at 칸 — 고쳤으면 health_alert_resolve('<종류 앞머리>') 로 닫는다(수리 도구·사람 모두)
--   ② 자동으로 한 일의 기록(품절 내림·보관 정리·자동 삭제·신청 알림)은 고장이 아니다 → 오류 화면에서 뺀다(표에는 남는다)
--   ③ 종류마다 가장 최근 한 줄만 · 감시기가 다시 돌았는데 또 안 울린 것은 뺀다(보통 12시간, 하루 한 번 도는 감시는 26시간)
--   화면: ops_status_get 의 alerts · error_radar 의 「다른 감시기 경보」 가 이 함수를 본다.
alter table public.health_alerts add column if not exists resolved_at timestamptz;
create index if not exists health_alerts_kind_created_idx on public.health_alerts (kind, created_at desc);

create or replace function public.health_alert_is_info(k text) returns boolean language sql immutable as $$
  select k in ('핫딜품절내림','핫딜정리','핫딜자동만료','events_보관정리','visits_보관정리','공구완전중복자동삭제',
               '이웃셀러배너교체','이웃셀러신청','hotdeal:지름알림:시작','무료플랜_DB크기')
      or k like 'radar:%'
$$;

create or replace function public.health_alerts_live(p_hours integer default 24)
returns table(id bigint, kind text, detail text, created_at timestamptz, n integer)
language sql stable security definer set search_path = public as $$
  with x as (
    select h.id, h.kind, h.detail::text as detail, h.created_at, h.resolved_at,
           row_number() over (partition by h.kind order by h.created_at desc) as rn,
           count(*) over (partition by h.kind)::int as n
      from health_alerts h
     where h.created_at > now() - make_interval(hours => greatest(1, least(coalesce(p_hours, 24), 168)))
  )
  select x.id, x.kind, x.detail, x.created_at, x.n
    from x
   where x.rn = 1 and x.resolved_at is null and not public.health_alert_is_info(x.kind)
     and x.created_at > now() - case
           when x.kind in ('date:파서','date:마감=오픈','date:달력정확도','accuracy_monthly_due','한사람두계정','중복공구','ig-ai:정확도','date_audit_review')
             then interval '26 hours' else interval '12 hours' end
   order by x.created_at desc;
$$;
revoke all on function public.health_alerts_live(integer) from public, anon, authenticated;
grant execute on function public.health_alerts_live(integer) to service_role;

-- 고친 뒤 닫기: 종류가 이 글자로 시작하는 열린 경보를 전부 닫는다. 같은 고장이 다시 나면 새 줄이 생겨 다시 보인다.
create or replace function public.health_alert_resolve(p_kind_prefix text) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if coalesce(p_kind_prefix, '') = '' then return 0; end if;
  update health_alerts set resolved_at = now() where resolved_at is null and kind like replace(replace(p_kind_prefix, '%', '\%'), '_', '\_') || '%';
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.health_alert_resolve(text) from public, anon, authenticated;
grant execute on function public.health_alert_resolve(text) to service_role;

-- 현황판·오류 레이더가 위 함수를 보게
CREATE OR REPLACE FUNCTION public.ops_status_get()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_cron jsonb; v_radar jsonb; v_counts jsonb; v_alerts jsonb; v_pc jsonb; v_pc_at timestamptz; v_edge jsonb; v_bot jsonb;
  v_free jsonb; v_db numeric; v_grow numeric;
begin
  if not public.is_app_admin() then raise exception 'forbidden' using errcode = '28000'; end if;
  -- ① pg_cron: 작업별 마지막 실행·상태·24h 실패 수
  select coalesce(jsonb_agg(jsonb_build_object(
      'jobid', j.jobid, 'name', j.jobname, 'schedule', j.schedule, 'active', j.active,
      'last_run', (select to_char(max(start_time) at time zone 'Asia/Seoul','MM-DD HH24:MI') from cron.job_run_details d where d.jobid=j.jobid),
      'last_status', (select status from cron.job_run_details d where d.jobid=j.jobid order by start_time desc limit 1),
      'last_msg', (select left(return_message, 120) from cron.job_run_details d where d.jobid=j.jobid order by start_time desc limit 1),
      'fails24', (select count(*) from cron.job_run_details d where d.jobid=j.jobid and d.status='failed' and d.start_time>now()-interval '24 hours')
    ) order by j.jobid), '[]'::jsonb) into v_cron from cron.job j;
  -- ①-b http 호출형 크론이 부른 엣지 함수의 응답 코드 24h — 함수가 죽어도 pg_cron 은 succeeded 라 여기서만 보인다 (검증 지적 2026-09-29: 24h 에 500·401·429×16 이 숨어 있었다)
  select coalesce(jsonb_agg(jsonb_build_object('status', s, 'n', n) order by s), '[]'::jsonb) into v_edge
    from (select status_code s, count(*) n from net._http_response where created > now()-interval '24 hours' group by 1) x;
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
    -- 로봇(uid=BOT…: bot_guard·bot_learn·현황판 probe)은 뺀다 — 검증 실측 24h 5,518 중 5,431 이 로봇이었다
    'kakao_bot_24h', (select count(*) from events where event_type='kakao_bot' and visited_at > now()-interval '24 hours' and event_data !~ 'uid=BOT[A-Z]'),
    'kakao_bot_robot_24h', (select count(*) from events where event_type='kakao_bot' and visited_at > now()-interval '24 hours' and event_data ~ 'uid=BOT[A-Z]'),
    'kakao_bot_last', (select to_char(max(visited_at) at time zone 'Asia/Seoul','MM-DD HH24:MI') from events where event_type='kakao_bot' and event_data !~ 'uid=BOT[A-Z]'),
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
    into v_alerts from (select * from public.health_alerts_live(24) order by created_at desc limit 40) h;   -- 2026-11-23: 살아 있는 고장만(고친 것·자동 작업 기록은 뺀다)
  -- ⑤ PC 쪽 상태
  -- ④-2 무료 플랜 여유 (2026-09-29 사장님 결정) — DB 500MB 를 넘으면 읽기 전용이 된다. 남은 날은 최근 7일 증가 속도 기준
  select round(pg_database_size(current_database())/1048576.0,1) into v_db;
  select round((
      (select count(*) from events where visited_at > now()-interval '7 days') * (pg_total_relation_size('events')::numeric / greatest((select count(*) from events),1))
    + (select count(*) from visits where visited_at > now()-interval '7 days') * (pg_total_relation_size('visits')::numeric / greatest((select count(*) from visits),1))
    + (select count(*) from visitors where visited_at > now()-interval '7 days') * (pg_total_relation_size('visitors')::numeric / greatest((select count(*) from visitors),1))
    ) / 7 / 1048576.0, 2) into v_grow;
  select jsonb_build_object('db_mb', v_db, 'db_limit', 500, 'grow_mb', v_grow,
    'days_left', case when v_grow > 0 then floor((500 - v_db) / v_grow)::integer else null end,
    'storage_mb', (select round(coalesce(sum((metadata->>'size')::bigint),0)/1048576.0,1) from storage.objects),
    'events_rows', (select count(*) from events), 'rollup_days', (select count(*) from events_daily)) into v_free;

  select payload, updated_at into v_pc, v_pc_at from ops_status where id='pc';
  return jsonb_build_object('at', to_char(now() at time zone 'Asia/Seoul','YYYY-MM-DD HH24:MI:SS'), 'cron', v_cron, 'http24', v_edge, 'radar', v_radar, 'free', v_free, 'counts', v_counts, 'alerts', v_alerts,
    'pc', coalesce(v_pc, '{}'::jsonb), 'pc_at', to_char(v_pc_at at time zone 'Asia/Seoul','MM-DD HH24:MI'), 'pc_age_min', case when v_pc_at is null then null else round(extract(epoch from (now()-v_pc_at))/60) end);
end $function$;

CREATE OR REPLACE FUNCTION public.error_radar()
 RETURNS TABLE(kind text, h1 bigint, h24 bigint, "임계" text, "상태" text, "설명" text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with e as (
    select event_type, event_data, visited_at from events
     where visited_at > now() - interval '24 hours'
       and event_type in ('data_load_fail','data_load_retry_ok','net_fallback','kakao_login_fail','kakao_login_start','kakao_login_done','js_error','app_crash')
       and coalesce(event_data,'') not like '%Claude/%'          -- 내 브라우저 검증 제외
  ),
  c as (
    select
      count(*) filter (where event_type='data_load_fail' and visited_at > now()-interval '1 hour') f1,
      count(*) filter (where event_type='data_load_fail') f24,
      count(*) filter (where event_type='data_load_retry_ok' and visited_at > now()-interval '1 hour') r1,
      count(*) filter (where event_type='data_load_retry_ok') r24,
      count(*) filter (where event_type='net_fallback' and visited_at > now()-interval '1 hour') n1,
      count(*) filter (where event_type='net_fallback') n24,
      count(*) filter (where event_type='net_fallback' and event_data like '%|http5%' and not (event_data like '%|/rest/v1/events|%' and extract(dow from visited_at at time zone 'UTC')=6 and (visited_at at time zone 'UTC')::time between '19:10' and '19:30') and visited_at > now()-interval '1 hour') s1,
      count(*) filter (where event_type='net_fallback' and event_data like '%|http5%' and not (event_data like '%|/rest/v1/events|%' and extract(dow from visited_at at time zone 'UTC')=6 and (visited_at at time zone 'UTC')::time between '19:10' and '19:30')) s24,
      count(*) filter (where event_type='kakao_login_fail' and event_data like '%|%' and event_data not like '%|추정%' and not (event_data like '%|network|%' and exists (select 1 from e d where d.event_type='kakao_login_done' and d.visited_at >= e.visited_at and d.visited_at <= e.visited_at + interval '2 minutes' and left(split_part(d.event_data,'d=',2),8) = left(split_part(e.event_data,'d=',2),8))) and visited_at > now()-interval '1 hour') k1,   -- 2026-11-12: network 실패 뒤 2분 안에 같은 기기가 로그인 완료한 건(재시도 성공)은 확정실패가 아니다
      count(*) filter (where event_type='kakao_login_fail' and event_data like '%|%' and event_data not like '%|추정%' and not (event_data like '%|network|%' and exists (select 1 from e d where d.event_type='kakao_login_done' and d.visited_at >= e.visited_at and d.visited_at <= e.visited_at + interval '2 minutes' and left(split_part(d.event_data,'d=',2),8) = left(split_part(e.event_data,'d=',2),8)))) k24,
      count(*) filter (where event_type='kakao_login_start') ks24,
      count(*) filter (where event_type='kakao_login_done') kd24,
      count(*) filter (where event_type='js_error' and visited_at > now()-interval '1 hour') j1,
      count(*) filter (where event_type='js_error') j24,
      count(*) filter (where event_type='app_crash' and event_data not like '%crashTest%' and event_data not like '%sdk_gphone%' and event_data not like '%Simulator%' and visited_at > now()-interval '1 hour') a1,
      count(*) filter (where event_type='app_crash' and event_data not like '%crashTest%' and event_data not like '%sdk_gphone%' and event_data not like '%Simulator%') a24
    from e
  ),
  -- 🔑 로그인을 들어온 길별로(앱·카톡 인앱·PWA·웹) — 합계만 보면 한 길이 0% 여도 묻힌다 (2026-10-26 아이폰 앱 0/10 이 하루 종일 안 보였다)
  --    시작(kakao_login_start 'app|d=xxxxxxxx')과 완료(kakao_login_done '|d=xxxxxxxx')를 기기 번호 앞 8자리로 짝짓는다
  lp as (
    select coalesce(substring(s.event_data from '^([a-z]+)|'),'?') path, count(*) starts,
           count(*) filter (where exists (select 1 from e d where d.event_type='kakao_login_done'
                    and d.event_data like '%d=' || substring(s.event_data from 'd=([0-9a-f]{8})') || '%' and d.visited_at >= s.visited_at)) dones
      from e s where s.event_type='kakao_login_start' and s.event_data ~ 'd=[0-9a-f]{8}'
     group by 1
  ),
  lpx as (
    select count(*) filter (where starts>=3 and dones::numeric/starts < 0.3) bad,
           string_agg(format('%s %s/%s', path, dones, starts), ' · ' order by starts desc) txt
      from lp
  ),
  st as (select round(extract(epoch from (now()-max(updated_at)))/60)::bigint stale_min from gonggu_click_stats),
  st2 as (select round(extract(epoch from (now()-max(updated_at)))/60)::bigint stale_min from search_trending_stats),
  ha as (select count(*) n from public.health_alerts_live(24)),   -- 2026-11-23: 살아 있는 고장 종류 수(전에는 고친 것·자동 작업 기록까지 줄 수로 셌다)
  -- 디스크 (2026-10-02) — 서브쿼리로 뽑아 ops_status 에 'pc' 행이 없어도 **줄이 사라지지 않게** 한다(값만 NULL).
  ds as (
    select
      (select payload->'disk' from ops_status where id='pc') d,
      (select round(extract(epoch from (now()-updated_at))/60)::bigint from ops_status where id='pc') age_min
  ),
  dsx as (
    select
      age_min,
      -- 판정값: 우리가 쓰는 드라이브 중 가장 모자란 것 하나 (jsonb_array_elements(NULL) 은 0행 → min() = NULL)
      (select min((x->>'free_gb')::numeric) from jsonb_array_elements(coalesce(d,'[]'::jsonb)) x
        where x->>'drive' in ('C:','E:')) min_free,
      -- 표시값: 전부
      (select string_agg(format('%s %sGB/%sGB', x->>'drive', x->>'free_gb', x->>'total_gb'), ' · ' order by x->>'drive')
        from jsonb_array_elements(coalesce(d,'[]'::jsonb)) x) all_str
    from ds
  )
  select * from (
    select '빈화면(data_load_fail)'::text, f1, f24, '1h≥3 또는 24h≥15'::text,
           case when f1>=3 or f24>=15 then '🔴' else '✅' end,
           '캐시 없는 기기가 두 길 다 실패해 목록을 못 본 것. 09-24 자동 재시도 배포 후엔 재시도로살림 쪽으로 옮겨가야 정상'::text from c
    union all
    select '재시도로살림(retry_ok)', r1, r24, '정보', '✅', '한 번 실패했다가 2·6초 뒤 재시도로 살아난 방문. 빈화면 대비 이 수가 커야 재시도가 일한다' from c
    union all
    select '우회로(net_fallback)', n1, n24, '1h≥5', case when n1>=5 then '🔴' else '✅' end,
           'supabase.co 실패 → api.momcalendar.com 성공. 손님은 정상 화면. 갑자기 늘면 supabase 쪽 장애' from c
    union all
    select '우회로 중 서버5xx', s1, s24, '24h≥1', case when s24>=1 then '🔴' else '✅' end,
           '우리 서버가 낸 5xx (statement timeout 등). 1건이라도 원인을 찾는다 — event_data 4번째 칸이 요청 경로' from c
    union all
    select '로그인 확정실패', k1, k24, '1h≥2 또는 24h 완료율<70%',
           case when k1>=2 or (ks24>=5 and kd24::numeric/ks24 < 0.7) then '🔴' else '✅' end,
           format('24h 시작 %s · 완료 %s. KOE320 은 성공 직후 옛 ?code 재진입(장애 아님)', ks24, kd24) from c
    union all
    select 'JS오류(js_error)', j1, j24, '1h≥5', case when j1>=5 then '🔴' else '✅' end,
           '🛟 v4 부터 기록(window.onerror). "Script error." 는 외부 스크립트 잡음 — 문구별로 세어 임계를 다시 잡는다' from c
    union all
    select '앱 강제종료(app_crash)', a1, a24, '24h≥1', case when a24>=1 then '🔴' else '✅' end,
           '손님 폰에서 앱이 죽은 기록(다음 실행 때 도착). select event_data from events where event_type=''app_crash'' order by id desc — trace 에 원인 줄' from c
    union all
    select '클릭통계 갱신 지연(분)', stale_min, stale_min, '≤30', case when stale_min>30 then '🔴' else '✅' end,
           'pg_cron 30 이 10분마다 채운다. 멈추면 500 은 안 나지만 TOP100 이 옛 숫자에 멈춘다' from st
    union all
    select '검색인기 갱신 지연(분)', stale_min, stale_min, '≤30', case when stale_min>30 then '🔴' else '✅' end,
           'pg_cron search-trending-stats 가 10분마다 채운다(search_trending_64). 멈추면 500 은 안 나지만 검색어 칩이 옛것에 멈춘다' from st2
    union all
    -- 🖥 PC 디스크 여유 (2026-10-02 신설). h1·h24 칸에는 건수가 아니라 **C·E 중 최소 여유 GB** 가 들어간다.
    select 'PC 디스크 여유(GB)',
           coalesce(round(min_free),0)::bigint, coalesce(round(min_free),0)::bigint,
           'C·E 중 최소 5GB 미만 🔴 · 15GB 미만 ⚠',
           case when min_free is null or age_min is null or age_min > 90 then '⚠'
                when min_free < 5  then '🔴'
                when min_free < 15 then '⚠'
                else '✅' end,
           case when min_free is null or age_min is null
                  then '값이 없다 — 예약작업 momcal-ops-status(30분) 가 새 푸셔(ops_status_push.mjs ⑦ 디스크)로 돌았는지 본다'
                when age_min > 90
                  then format('값이 %s분 전 것이라 믿을 수 없다(PC 가 꺼졌거나 momcal-ops-status 가 죽었다). 마지막 값: %s', age_min, all_str)
                else format('%s · %s분 전 값. 자동화가 쓰는 C(레포·백업·임시폴더)와 E(njob-temp) 만 판정하고 D·F 는 표시만 한다. 5GB 미만이면 백업·db_export·SEO 갱신이 조용히 실패한다', all_str, age_min)
           end
    from dsx
    union all
    select '로그인 길별(완료/시작)', bad, null::bigint, '한 길이라도 시작≥3 인데 완료<30%',
           case when bad>0 then '🔴' else '✅' end,
           '24h ' || coalesce(txt,'시작 없음') || ' — app=아이폰·안드 앱, inapp=카톡·인스타, pwa=홈화면, web=브라우저' from lpx
    union all
    select '다른 감시기 경보(24h)', n, n, '정보', case when n>0 then '⚠' else '✅' end,
           'login-health·site-health·seo-health·data-health 등이 health_alerts 에 남긴 것. select * from health_alerts order by created_at desc' from ha
  ) t(kind, h1, h24, 임계, 상태, 설명);
$function$;
