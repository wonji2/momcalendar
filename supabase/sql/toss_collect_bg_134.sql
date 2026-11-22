-- 토스 하루특가 수집 크론을 bg=1 로 부른다 (2026-11-18)
--   크론(pg_net) → toss-sync → 다시 pg_net → 토스 구조라 함수가 응답을 기다리면 서로 막혀 「응답 없음」으로 끝났다.
--   9/22 이후 자동 등록 0건. bg=1 이면 함수가 바로 응답하고 뒤에서 수집한다. 결과는 ops_status 'toss-collect'.
--   비밀값은 기존 크론 명령에 든 것을 그대로 둔다(여기 적지 않는다).
do $$ declare j bigint; c text; begin
  select jobid, command into j, c from cron.job where jobname = 'toss-hotdeal';
  if j is null then raise exception 'toss-hotdeal 크론이 없다'; end if;
  if c like '%mode=collect&bg=1%' then return; end if;
  if c not like '%toss-sync?mode=collect''%' then raise exception '명령 꼴이 다르다'; end if;
  perform cron.alter_job(j, command := replace(c, 'toss-sync?mode=collect''', 'toss-sync?mode=collect&bg=1'''));
end $$;

-- 수집이 36시간 넘게 결과를 못 남기거나 실패로 끝나면 관리자 「고장 난 것」에 올린다
select cron.unschedule('toss-collect-watch') where exists (select 1 from cron.job where jobname = 'toss-collect-watch');
select cron.schedule('toss-collect-watch', '40 3 * * *', $w$
  insert into public.health_alerts (kind, detail)
  select '핫딜:토스수집', '토스 하루특가 수집이 36시간 넘게 결과를 남기지 않았거나 실패로 끝났다 — ops_status toss-collect · 함수 toss-sync?mode=collect'
  where not exists (select 1 from public.ops_status
                     where id = 'toss-collect' and updated_at > now() - interval '36 hours'
                       and coalesce((payload->>'ok')::boolean, false));
$w$);
