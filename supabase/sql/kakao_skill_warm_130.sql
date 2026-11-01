-- 맘캘봇(kakao-skill) 예열 — 5분마다 가벼운 질문 한 번 (2026-11-01)
--   왜: 손님이 없던 09:22 에 첫 질문 둘이 4.2초를 넘겨 「스킬 오류」. 함수가 잠들었다 깨는 비용(콜드스타트)을 손님이 치르지 않게 서버가 5분마다 깨워 둔다.
--   uid BOTWARM 은 로봇(BOT…)이라 학습·통계에서 빠진다. 하루 288회, events 행 288개(롤업·정리 크론이 치운다).
select cron.unschedule(jobid) from cron.job where jobname = 'kakao-skill-warm';
select cron.schedule('kakao-skill-warm', '*/5 * * * *', $$
  select net.http_post(
    url     := 'https://hycaqsqeogjtbscmzrtm.supabase.co/functions/v1/kakao-skill',
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body    := '{"userRequest":{"utterance":"오늘 공구","user":{"id":"BOTWARM"}}}'::jsonb,
    timeout_milliseconds := 8000
  );
$$);
