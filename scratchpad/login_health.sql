-- 🔴 매 작업 시작 전 무조건 먼저 실행 (사장님 지시 2026-08-05)
--    미완료가 1건이라도 있으면 그 자리에서 원인부터 잡는다.
select (visited_at at time zone 'Asia/Seoul')::date d,
  count(*) filter (where event_type='kakao_login_start') 시작,
  count(*) filter (where event_type='kakao_login_done')  완료,
  count(*) filter (where event_type='kakao_login_fail')  실패확정,
  count(*) filter (where event_type='kakao_login_start')
    - count(*) filter (where event_type='kakao_login_done') as 미완료,
  case when count(*) filter (where event_type='kakao_login_start') > 0
    then round(count(*) filter (where event_type='kakao_login_done')::numeric*100
             / count(*) filter (where event_type='kakao_login_start'),1) end as 성공률,
  string_agg(distinct coalesce(nullif(event_data,''),'(구버전)'),',')
    filter (where event_type='kakao_login_start') as 환경
from events where event_type like 'kakao_login%'
group by 1 order by 1 desc limit 7;
