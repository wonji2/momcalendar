-- error_radar: 로그인 길별 줄 추가 (2026-10-26) — 원본은 error_radar_63.sql
CREATE OR REPLACE FUNCTION public.error_radar()
 RETURNS TABLE(kind text, h1 bigint, h24 bigint, "임계" text, "상태" text, "설명" text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with e as (
    select event_type, event_data, visited_at from events
     where visited_at > now() - interval '24 hours'
       and event_type in ('data_load_fail','data_load_retry_ok','net_fallback','kakao_login_fail','kakao_login_start','kakao_login_done','js_error')
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
      count(*) filter (where event_type='net_fallback' and event_data like '%|http5%' and visited_at > now()-interval '1 hour') s1,
      count(*) filter (where event_type='net_fallback' and event_data like '%|http5%') s24,
      count(*) filter (where event_type='kakao_login_fail' and event_data like '%|%' and event_data not like '%|추정%' and visited_at > now()-interval '1 hour') k1,
      count(*) filter (where event_type='kakao_login_fail' and event_data like '%|%' and event_data not like '%|추정%') k24,
      count(*) filter (where event_type='kakao_login_start') ks24,
      count(*) filter (where event_type='kakao_login_done') kd24,
      count(*) filter (where event_type='js_error' and visited_at > now()-interval '1 hour') j1,
      count(*) filter (where event_type='js_error') j24
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
  ha as (select count(*) n from health_alerts where created_at > now()-interval '24 hours' and kind not like 'radar:%'),
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
$function$
;
