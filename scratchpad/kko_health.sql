select (visited_at at time zone 'Asia/Seoul')::date as d,
  count(*) filter (where event_type='kakao_login_start') as start_cnt,
  count(*) filter (where event_type='kakao_login_done')  as done_cnt,
  count(*) filter (where event_type='kakao_login_fail')  as fail_cnt,
  string_agg(distinct event_data,',') filter (where event_type='kakao_login_fail') as fail_paths
from events where event_type like 'kakao_login%'
group by 1 order by 1 desc;
