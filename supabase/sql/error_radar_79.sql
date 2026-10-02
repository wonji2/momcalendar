-- 오류 레이더 v79 — **PC 디스크 여유 줄 추가** (2026-10-02, 사장님 "넣어둬")
--
-- 왜: 2026-10-02 오전 C 드라이브 여유가 **68KB** 까지 떨어져 `npx`·백업·캡처·원고 저장이 조용히 실패했는데
--     아무도 몰랐다. 그날 10:23 bbhd 회차가 *"여유 15MB, npx 가 용량 부족으로 실패"* 를 **자기 로그에 적었지만
--     그 로그를 읽는 사람이 없었다.** 블로그(njob) 쪽만 5GB 미만일 때 바탕화면에 경고 파일을 남기고 있었고,
--     맘캘 자동화(백업·db_export·SEO 갱신·파싱)에는 디스크를 보는 눈이 **아예 없었다.**
--     → v63 의 설계 그대로, 감시기를 새로 만들지 않고 **이 함수에 줄 하나를 더한다.**
--
-- 어디서 숫자가 오나: 윈도우 예약작업 `momcal-ops-status`(30분) → `tools/daily/ops_status_push.mjs`
--     → `ops_status` 표 (id='pc') 의 `payload->'disk'`. **재는 곳은 그 파일 한 곳뿐이다**(두 군데서 재면 값이 어긋난다).
-- 어떻게 사장님께 닿나: 🔴 이면 `run_error_watch()`(매시 35분) 가 `health_alerts` 에 남기고,
--     윈도우 예약작업 `momcal-error-guard`(매시간) 가 그것을 오늘 카드 알림줄에 쓴다. **새 경보 경로를 만들지 않았다.**
--
-- 🔴 판정에서 가장 중요한 것 = **값이 낡았으면 숫자를 믿지 않는다.**
--     PC 가 꺼진 채 디스크가 차면 `ops_status` 에는 옛 값(여유 많음)이 남아 ✅ 라고 거짓 보고한다.
--     그래서 `updated_at` 이 90분을 넘으면 숫자와 무관하게 ⚠ 로 내리고 설명에 "값이 N분 전 것" 을 적는다.
--     (90분 = ops.html 이 'PC 상태 안 옴' 을 띄우는 기준과 같게 맞췄다)
--
-- 임계를 왜 5GB·15GB 로 잡았나 (실측 근거)
--   · 🔴 **5GB**: 10/2 에 `npx` 가 여유 15MB 에서 깨졌다. SEO 자동갱신은 한 번에 **19,479개 파일**을 쓰고,
--     `db_export` 는 217MB DB 를 표별로 내보내며, work-backup 레포는 10GB 다. 예약작업 **하나가 끝까지 도는 데
--     필요한 최소 바닥**이 5GB 다. 이 아래는 조용히 실패하는 구간이다.
--   · ⚠ **15GB**: 10/2 실측으로 미디어 앱 정리 한 번에 **한 시간 만에 35GB** 가 움직였다. 하루 여유를 주려면
--     경고가 15GB 에서 떠야 한다. (njob 쪽 5GB 기준을 따라한 것이 아니라, 위 두 숫자에서 각각 나온 값이다)
--
-- 왜 C·E 만 보나: 우리 자동화가 쓰는 곳이 그 둘뿐이다 — **C**(레포·work-backup·momcal-ops·임시폴더·Claude 앱),
--   **E**(`E:\njob-temp` 캡처 임시). D 는 옛 시스템 파티션(여유 8GB 로 상시 ⚠ 가 될 뻔했다), F 는 사장님 보관용이다.
--   드라이브가 늘면 아래 `in ('C:','E:')` 한 곳만 고치면 된다. **표시는 전부 하고 판정만 좁힌다.**
--
-- ROLLBACK: 맨 아래. (v63 정의로 되돌아간다)

create or replace function public.error_radar()
returns table(kind text, h1 bigint, h24 bigint, 임계 text, 상태 text, 설명 text)
language sql stable security definer set search_path = public as $$
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
    select '다른 감시기 경보(24h)', n, n, '정보', case when n>0 then '⚠' else '✅' end,
           'login-health·site-health·seo-health·data-health 등이 health_alerts 에 남긴 것. select * from health_alerts order by created_at desc' from ha
  ) t(kind, h1, h24, 임계, 상태, 설명);
$$;
revoke all on function public.error_radar() from public, anon, authenticated;

select * from public.error_radar();

-- ROLLBACK (v63 로 되돌리려면)
--   supabase/sql/error_radar_63.sql 을 다시 실행한다. (v79 는 줄 하나와 CTE 둘만 더한 것이라 그것으로 완전히 되돌아간다)
--   디스크 경보가 남아 있으면: delete from health_alerts where kind = 'radar:PC 디스크 여유(GB)';
