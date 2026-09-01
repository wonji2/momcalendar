-- 아이폰 앱 푸시(APNs) 기반 — 2026-09-01
--
-- 왜 새 표인가: 지금 웹푸시(push_subs) 로 55명이 실제로 알림을 받고 있다.
-- 그 표·RPC·엣지함수를 건드리면 그 55명이 조용히 끊긴다.
-- 그래서 아이폰 토큰은 옆에 따로 쌓고, 보내는 함수도 따로 둔다.
--
-- 웹푸시와 다른 점
--   웹  : endpoint + p256dh + auth (브라우저가 만든 구독)
--   앱  : APNs 디바이스 토큰 한 줄 (애플이 발급)

create table if not exists public.push_ios (
  device_id   text primary key,                 -- 사이트의 mc_did (앱 웹뷰도 같은 키를 쓴다)
  apns_token  text not null,                    -- 애플이 준 디바이스 토큰 (기기·앱 재설치마다 바뀐다)
  env         text not null default 'prod',     -- 'dev'(TestFlight 이전) / 'prod'(스토어 배포)
  bundle_id   text not null default 'com.wontsbe.momcalendar',
  ua          text,
  created_at  timestamptz not null default now(),
  last_ok     timestamptz,
  fail_count  integer not null default 0,
  notice_ok   boolean not null default true     -- 공지 알림 수신 동의
);

comment on table public.push_ios is '아이폰 앱 APNs 토큰. 손님 키로는 못 읽고 못 쓴다(서버 함수 전용).';

-- 같은 토큰이 다른 기기 행에 남아 있으면 남의 폰으로 알림이 간다 → 토큰은 유일해야 한다
create unique index if not exists push_ios_token_uk on public.push_ios (apns_token);

alter table public.push_ios enable row level security;
-- 정책을 만들지 않는다 = service_role(엣지함수)만 접근. 경쟁사·손님 모두 읽기 불가.
revoke all on public.push_ios from anon, authenticated;

-- ── 오늘 오픈하는 찜 공구 → 보낼 대상 (push_targets 의 아이폰 판) ──────────
create or replace function public.push_targets_ios()
returns table(device_id text, apns_token text, env text,
              gonggu_id bigint, gonggu_name text, seller text)
language sql stable
set search_path to 'public'
as $$
  select s.device_id, s.apns_token, s.env,
         g.id, g.name, coalesce(g.influencer, g.insta)
  from wishes w
  join push_ios s on s.device_id = w.device_id
  join gonggu   g on g.id        = w.gonggu_id
  where g.approved = true
    and g.open_date = to_char((now() at time zone 'Asia/Seoul')::date, 'YYYY-MM-DD')
    and s.fail_count < 5                        -- 계속 실패하는 죽은 토큰 제외
    and not exists (                            -- 이미 보낸 건 제외
      select 1 from push_log l
      where l.device_id = s.device_id
        and l.gonggu_id = g.id
        and l.kind      = 'open_ios'            -- 웹푸시('open')와 칸을 나눈다
    );
$$;

revoke all on function public.push_targets_ios() from anon, authenticated, public;

-- ── 실패 카운트 (404/410 = 토큰 죽음) ─────────────────────────────────────
create or replace function public.push_ios_fail(p_token text)
returns void language sql
set search_path to 'public'
as $$
  update push_ios set fail_count = fail_count + 1 where apns_token = p_token;
$$;

revoke all on function public.push_ios_fail(text) from anon, authenticated, public;

-- ── 토큰 저장 (엣지함수 save-ios-token 이 부른다) ─────────────────────────
create or replace function public.push_ios_upsert(
  p_device text, p_token text, p_env text default 'prod', p_ua text default null)
returns void language sql
set search_path to 'public'
as $$
  -- 같은 토큰이 다른 기기에 붙어 있으면 먼저 떼어낸다 (기기 초기화·양도 대비)
  delete from push_ios where apns_token = p_token and device_id <> p_device;
  insert into push_ios (device_id, apns_token, env, ua)
  values (p_device, p_token, coalesce(p_env,'prod'), p_ua)
  on conflict (device_id) do update
    set apns_token = excluded.apns_token,
        env        = excluded.env,
        ua         = coalesce(excluded.ua, push_ios.ua),
        fail_count = 0,
        last_ok    = null;
$$;

revoke all on function public.push_ios_upsert(text,text,text,text) from anon, authenticated, public;
