-- 지름알림 수집 감시 (2026-11-18) — 수집기(tools/daily/baby_hotdeal_auto.py collect_from_jirum_alarm)가 회차마다 ops_status 'jirum-collect' 를 쓴다.
--   ① 6시간 넘게 성공 기록이 없거나 ② 성공으로 찍히는데 24시간 동안 한 건도 등록이 없으면(형식이 반만 바뀌어 전부 건너뛰는 경우) 관리자 「고장 난 것」에 올린다.
--   PC 와 무관한 서버 크론. 11-02~11-18 16일 동안 403 인데 아무도 몰랐던 사고의 재발 방지.
select cron.unschedule('jirum-collect-watch') where exists (select 1 from cron.job where jobname = 'jirum-collect-watch');
select cron.schedule('jirum-collect-watch', '27 */3 * * *', $w$
  insert into public.health_alerts (kind, detail)
  select 'hotdeal:지름알림', x.msg
  from (
    select case
      when not exists (select 1 from public.ops_status where id = 'jirum-collect' and updated_at > now() - interval '6 hours' and coalesce((payload->>'ok')::boolean, false))
        then '지름알림 수집이 6시간 넘게 성공 기록을 남기지 않았다 — ops_status jirum-collect · 깃허브 hotdeal-cloud 실행 로그의 [source:jirum] 줄'
      when exists (select 1 from public.ops_status where id = 'jirum-collect'
                    and (coalesce(payload->>'last_reg','') = '' or (payload->>'last_reg')::timestamptz < now() - interval '24 hours')
                    and not exists (select 1 from public.hotdeals where product_id like 'jirum\_%' and created_at > now() - interval '24 hours'))
           and exists (select 1 from public.ops_status where id = 'jirum-state' and updated_at < now() - interval '0 seconds'
                        and (select min(created_at) from public.health_alerts where kind = 'hotdeal:지름알림:시작') < now() - interval '24 hours')
        then '지름알림 수집은 도는데 24시간 동안 등록이 0건이다 — 상세 형식이 바뀌었는지 볼 것(ops_status jirum-collect 의 skip 사유)'
    end as msg
  ) x
  where x.msg is not null
    and not exists (select 1 from public.health_alerts where kind = 'hotdeal:지름알림' and created_at > now() - interval '6 hours');
$w$);
-- 가동 시각 표식(「24시간 등록 0건」 판정이 가동 첫날에 울리지 않게)
insert into public.health_alerts (kind, detail)
select 'hotdeal:지름알림:시작', '지름알림 RSS 수집 가동(2026-11-18) — 경보 아님, 감시 기준 시각'
where not exists (select 1 from public.health_alerts where kind = 'hotdeal:지름알림:시작');
