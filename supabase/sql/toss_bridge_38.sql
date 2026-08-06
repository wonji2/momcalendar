-- 토스쇼핑 쉐어링크 연동 통로 (사장님 지시 2026-08-06)
--
-- 왜 DB 를 거치나:
--   토스는 '출발지 IP 를 등록한 곳'에서만 호출을 받는다. 등록한 IP 는 3.39.214.69(DB 서버)다.
--   Edge Function 은 나갈 때마다 IP 가 바뀐다(실측: 13.125.193.101 / 3.34.142.106 / 43.201.48.5).
--   그래서 바깥 통신만 DB(pg_net)에 맡긴다. 로직은 Edge Function 이 짠다.
--
-- ⚠ 이 함수는 '아무 주소나' 부르는 통로가 아니다. 토스 도메인만 허용한다.

create table if not exists public.toss_token(
  id           int primary key default 1,
  access_token text not null,
  expires_at   timestamptz not null,
  updated_at   timestamptz not null default now(),
  constraint toss_token_single check (id = 1)
);
alter table public.toss_token enable row level security;
revoke all on table public.toss_token from anon, authenticated;

-- 토스로 나가는 요청을 DB 가 대신 보낸다. 요청 id 를 돌려준다(응답은 비동기).
create or replace function public.toss_http(
  p_method  text,
  p_url     text,
  p_headers jsonb default '{}'::jsonb,
  p_body    text  default null
) returns bigint
language plpgsql
security definer
set search_path = public, net
as $$
declare rid bigint;
begin
  -- 허용 도메인 화이트리스트. 이걸 빼면 임의 주소로 나갈 수 있는 구멍이 된다.
  if p_url !~ '^https://(sharelink|alpha-sharelink)\.toss\.im/'
     and p_url !~ '^https://oauth2(-alpha)?\.cert\.toss\.im/' then
    raise exception '허용되지 않은 주소다: %', left(p_url, 60);
  end if;

  if upper(p_method) = 'GET' then
    select net.http_get(url := p_url, headers := p_headers, timeout_milliseconds := 20000) into rid;
  elsif upper(p_method) = 'POST' then
    select net.http_post(url := p_url, headers := p_headers, body := coalesce(p_body,'')::jsonb,
                         timeout_milliseconds := 20000) into rid;
  else
    raise exception '지원하지 않는 방식이다: %', p_method;
  end if;
  return rid;
end $$;

-- form-urlencoded 로 보내야 하는 토큰 발급용 (jsonb 본문이 아니다)
create or replace function public.toss_http_form(
  p_url  text,
  p_body text
) returns bigint
language plpgsql
security definer
set search_path = public, net
as $$
declare rid bigint;
begin
  if p_url !~ '^https://oauth2(-alpha)?\.cert\.toss\.im/' then
    raise exception '허용되지 않은 주소다: %', left(p_url, 60);
  end if;
  select net.http_post(
    url := p_url,
    headers := jsonb_build_object('Content-Type','application/x-www-form-urlencoded'),
    body := p_body::text,
    timeout_milliseconds := 20000) into rid;
  return rid;
end $$;

-- 응답 읽기
create or replace function public.toss_http_result(p_id bigint)
returns table(status int, content text)
language sql
security definer
set search_path = public, net
as $$
  select status_code, content::text from net._http_response where id = p_id;
$$;

revoke all on function public.toss_http(text,text,jsonb,text)  from public, anon, authenticated;
revoke all on function public.toss_http_form(text,text)         from public, anon, authenticated;
revoke all on function public.toss_http_result(bigint)          from public, anon, authenticated;
grant execute on function public.toss_http(text,text,jsonb,text) to service_role;
grant execute on function public.toss_http_form(text,text)       to service_role;
grant execute on function public.toss_http_result(bigint)        to service_role;

comment on function public.toss_http(text,text,jsonb,text) is
  '토스 API 호출을 DB 가 대신 내보낸다(출발지 IP 고정용). 토스 도메인만 허용.';
