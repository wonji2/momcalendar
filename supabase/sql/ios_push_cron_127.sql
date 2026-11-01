-- 아이폰 앱 오픈 알림 예약 (2026-10-27, 아직 적용 전 — 사장님 확인 뒤)
--   send-open-push-ios 함수는 있었는데(selftest·dry 정상) 부르는 pg_cron 이 없어 push_log 에 ios 가 한 번도 없었다.
--   안드(fcm-open-push 00:01 UTC = 09:01 KST)와 같은 꼴로, 1분 뒤 02 분에. 비밀값은 공개 레포에 적지 않으려고 fcm-open-push 의 명령을 그대로 복사해 주소·대상 함수만 바꾼다.
select cron.schedule(
  'ios-open-push',
  '2 0 * * *',
  replace(
    replace((select command from cron.job where jobname = 'fcm-open-push'),
            'send-fcm-push?mode=open', 'send-open-push-ios'),
    'push_targets_fcm()', 'push_targets_ios()')
);
select jobname, schedule, position('send-open-push-ios' in command) > 0 as ok from cron.job where jobname = 'ios-open-push';
