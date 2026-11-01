-- 안드로이드 웹뷰 앱(Capacitor) 알림 토큰 — FCM (2026-10-26)
--   아이폰(push_ios·push_ios_upsert)과 같은 모양. 웹뷰엔 웹푸시가 없어서(TWA 때는 크롬 웹푸시) 앱 알림으로 받는다.
--   쓰기는 Edge 함수 save-fcm-token 만(서비스 키). 손님(anon)은 못 읽고 못 쓴다 — 보안 기준선(security_lockdown_66)과 같다.
--   발송 함수는 Firebase 프로젝트(서비스 계정 키)가 생긴 뒤에 만든다. 그 전엔 행이 쌓이기만 한다.
--   한도(LONG_TERM_REGISTER): 기기당 1행, 앱 설치 수만큼 — 1만 대여도 수 MB.
create table if not exists public.push_fcm (
  device_id  text primary key,
  fcm_token  text not null,
  ua         text,
  created_at timestamptz not null default now(),
  last_ok    timestamptz,
  fail_count integer not null default 0,
  notice_ok  boolean not null default true,
  prefs      jsonb not null default '{"sale": true, "event": true, "gonggu": true, "hotdeal": true}'::jsonb
);
create unique index if not exists push_fcm_token_uk on public.push_fcm (fcm_token);
alter table public.push_fcm enable row level security;
revoke all on public.push_fcm from anon, authenticated;

create or replace function public.push_fcm_upsert(p_device text, p_token text, p_ua text default null)
returns void
language sql
set search_path to 'public'
as $$
  -- 같은 토큰이 다른 기기에 붙어 있으면 먼저 떼어낸다 (기기 초기화·양도 대비)
  delete from push_fcm where fcm_token = p_token and device_id <> p_device;
  insert into push_fcm (device_id, fcm_token, ua)
  values (p_device, p_token, p_ua)
  on conflict (device_id) do update
    set fcm_token  = excluded.fcm_token,
        ua         = coalesce(excluded.ua, push_fcm.ua),
        fail_count = 0,
        last_ok    = null;
$$;
revoke all on function public.push_fcm_upsert(text, text, text) from public, anon, authenticated;
