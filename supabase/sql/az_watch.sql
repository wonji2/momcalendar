-- 라이브 A-Z 자동감시 (사장님 지시 2026-08-12)
-- "내가 말한 항목만 실측하지말고 라이브가 정상인지 모든걸 전부다 a부터 z까지 매일매일 훑어야"
--
-- 구조: pg_net 은 비동기라 두 단계로 돈다.
--   az_fire()  06:20 KST — 라이브에 실제 HTTP 요청 16발을 쏘고 req_id 를 az_pending 에 적어둔다
--   az_check() 06:35 KST — 응답을 대조해 상태코드·내용표식이 어긋나면 health_alerts 에 남긴다
-- 결과는 전부 health_alerts 한 곳으로 모인다(세션 시작 때 보는 그 테이블).

create table if not exists public.az_pending (
  probe text primary key,
  req_id bigint not null,
  expect_status int not null default 200,
  must_contain text,          -- 응답 본문에 반드시 있어야 하는 표식 (null 이면 상태코드만)
  must_not text,              -- 있으면 안 되는 표식 (깨진 글자 등)
  fired_at timestamptz not null default now()
);
alter table public.az_pending enable row level security;

create or replace function public.az_fire()
returns int language plpgsql security definer set search_path = public as $$
declare
  ua jsonb := jsonb_build_object('User-Agent','Mozilla/5.0 (azwatch; momcalendar)');
  k  text  := 'sb_publishable_u4hR4mdNTSss3kdjFH6R5Q_iuJ2MuGE';
  p  record; c int := 0;
begin
  for p in
    select * from (values
      -- (이름, URL, 기대상태, 필수표식, 금지표식)
      ('홈',          'https://momcalendar.com/?az=1',                       200, '맘캘린더',      'ë¦¬ë¹'),
      ('테스트페이지', 'https://momcalendar.com/test.html?az=1',              200, 'noindex',      null),   -- noindex 빠지면 구글에 샌다
      ('약관',        'https://momcalendar.com/privacy.html',                200, null,           null),
      ('카드생성기',   'https://momcalendar.com/reelcard.html?az=1',          200, 'trimToFit',    null),   -- 저장 잘림 방지 코드 생존
      ('서비스워커',   'https://momcalendar.com/sw.js',                       200, null,           null),
      ('매니페스트',   'https://momcalendar.com/manifest.json',               200, 'start_url',    null),
      ('앱아이콘',     'https://momcalendar.com/momcal-appicon.png',          200, null,           null),
      ('사이트맵',     'https://momcalendar.com/sitemap.xml',                 200, 'sitemapindex', null),
      ('robots',      'https://momcalendar.com/robots.txt',                  200, 'Sitemap:',     null),
      ('브랜드페이지', 'https://momcalendar.com/g/%EB%AC%B4%EC%95%84%EC%8A%A4.html', 200, '무아스 공구', 'ë¦¬ë¹'),
      ('셀러허브',     'https://momcalendar.com/%EA%B3%B5%EA%B5%AC%EC%85%80%EB%9F%AC.html', 200, null, null),
      ('REST공구',    'https://hycaqsqeogjtbscmzrtm.supabase.co/rest/v1/gonggu?select=id\&approved=eq.true\&limit=1\&apikey='||'sb_publishable_u4hR4mdNTSss3kdjFH6R5Q_iuJ2MuGE', 200, '"id"', null),
      ('REST핫딜',    'https://hycaqsqeogjtbscmzrtm.supabase.co/rest/v1/hotdeals?select=id\&limit=1\&apikey='||'sb_publishable_u4hR4mdNTSss3kdjFH6R5Q_iuJ2MuGE', 200, '"id"', null),
      -- 토스 함수 생존 확인: mode=health 는 토스 API 왕복(실측 25초)이라 오탐원 → 외부 왕복 없는 400 응답으로 확인
      ('엣지토스',    'https://hycaqsqeogjtbscmzrtm.supabase.co/functions/v1/toss-sync?mode=ping', 400, 'health / best / link', null),
      ('엣지쿠팡차단', 'https://hycaqsqeogjtbscmzrtm.supabase.co/functions/v1/coupang-hotdeal', 401, null, null), -- 시크릿 없이 401 이어야 정상
      -- pg_net 은 리다이렉트를 끝까지 따라감 → 최종 200 + 본문 kakao + KOE 없음이 정상 서명 (실측 2026-08-12)
      ('카카오인가',   'https://kauth.kakao.com/oauth/authorize?client_id=04a73b2b11a54e8c11be73309e1b217c\&redirect_uri=https%3A%2F%2Fmomcalendar.com%2F\&response_type=code', 200, 'kakao', 'KOE')
    ) v(probe, url, es, mc, mn)
  loop
    insert into az_pending(probe, req_id, expect_status, must_contain, must_not)
    values (p.probe,
            net.http_get(url := replace(p.url, '\&', '&'), headers := ua, timeout_milliseconds := 20000),
            p.es, p.mc, p.mn)
    on conflict (probe) do update
      set req_id = excluded.req_id, expect_status = excluded.expect_status,
          must_contain = excluded.must_contain, must_not = excluded.must_not, fired_at = now();
    c := c + 1;
  end loop;
  return c;
end $$;

create or replace function public.az_check()
returns int language plpgsql security definer set search_path = public as $$
declare p record; resp record; bad int := 0; n int;
begin
  for p in select * from az_pending loop
    select status_code, left(coalesce(content,''), 500000) as body, error_msg, timed_out
      into resp from net._http_response where id = p.req_id;
    if not found then
      insert into health_alerts(kind, detail) values ('AZ:'||p.probe, '응답 없음(pg_net 유실)'); bad := bad + 1;
    elsif resp.timed_out then
      insert into health_alerts(kind, detail) values ('AZ:'||p.probe, '타임아웃'); bad := bad + 1;
    elsif resp.error_msg is not null then
      insert into health_alerts(kind, detail) values ('AZ:'||p.probe, '오류: '||left(resp.error_msg,120)); bad := bad + 1;
    elsif resp.status_code is distinct from p.expect_status then
      insert into health_alerts(kind, detail) values ('AZ:'||p.probe, '상태 '||resp.status_code||' (기대 '||p.expect_status||')'); bad := bad + 1;
    elsif p.must_contain is not null and position(p.must_contain in resp.body) = 0 then
      insert into health_alerts(kind, detail) values ('AZ:'||p.probe, '표식 없음: '||p.must_contain); bad := bad + 1;
    elsif p.must_not is not null and position(p.must_not in resp.body) > 0 then
      insert into health_alerts(kind, detail) values ('AZ:'||p.probe, '금지표식 발견: '||p.must_not); bad := bad + 1;
    end if;
  end loop;
  delete from az_pending;

  -- 덤: 지난 24시간 크론 실패도 여기서 잡는다 (어느 크론이든 죽으면 보인다)
  select count(*) into n from cron.job_run_details
   where status = 'failed' and start_time > now() - interval '24 hours';
  if n > 0 then
    insert into health_alerts(kind, detail)
    select 'AZ:크론실패', j.jobname || ' ×' || count(*)
    from cron.job_run_details d join cron.job j using (jobid)
    where d.status = 'failed' and d.start_time > now() - interval '24 hours'
    group by j.jobname;
    bad := bad + n;
  end if;
  return bad;
end $$;

revoke all on function public.az_fire()  from public, anon, authenticated;
revoke all on function public.az_check() from public, anon, authenticated;

-- 매일 06:20 발사 → 06:35 대조 (data-health 06:10 과 같은 아침 묶음)
select cron.schedule('az-fire',  '20 21 * * *', 'select public.az_fire()');
select cron.schedule('az-check', '35 21 * * *', 'select public.az_check()');
