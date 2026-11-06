-- 회원별 「한 번만 띄우는 팝업」 본 기록 (사장님 2026-11-06)
--   앱에서 닫은 출석 이벤트 팝업이 카톡 인앱으로 들어오니 또 떴다 — 닫은 기록이 그 브라우저 localStorage 에만 있어서.
--   로그인한 사람은 서버에 남겨 앱·카톡·크롬 어디서든 한 번만 뜨게 한다. 이번 달 이미 출석한 사람에게는 안 띄운다.
--   크기: 회원 × 달 1행(키 20자 안팎) — 1년에 수만 행, 수 MB 미만(LONG_TERM_REGISTER 한 줄).
create table if not exists member_popup_seen(
  kakao_id text not null,
  pop_key  text not null,
  seen_at  timestamptz not null default now(),
  primary key (kakao_id, pop_key)
);
alter table member_popup_seen enable row level security;
revoke all on member_popup_seen from anon, authenticated;

-- 출석 팝업을 띄워도 되는지: 이미 닫았거나(seen) 이번 달 출석 기록이 있으면(attended_month) 안 띄운다
create or replace function member_att_pop_check(p_token text, p_key text)
returns json language plpgsql security definer set search_path = public as $$
declare kid text; d date;
begin
  kid := _member_from_token(p_token);
  if kid is null then return json_build_object('ok', false, 'error', 'login_required'); end if;
  d := (now() at time zone 'Asia/Seoul')::date;
  return json_build_object('ok', true,
    'seen', exists(select 1 from member_popup_seen where kakao_id = kid and pop_key = p_key),
    'attended_month', exists(select 1 from attendance where kakao_id = kid
                              and day >= date_trunc('month', d)::date and day <= d));
end $$;

-- 팝업을 닫았다고 남긴다 (키는 영문·숫자·_- 40자까지)
create or replace function member_popup_mark(p_token text, p_key text)
returns json language plpgsql security definer set search_path = public as $$
declare kid text;
begin
  kid := _member_from_token(p_token);
  if kid is null then return json_build_object('ok', false, 'error', 'login_required'); end if;
  if p_key is null or p_key !~ '^[A-Za-z0-9_-]{1,40}$' then return json_build_object('ok', false, 'error', 'bad_key'); end if;
  insert into member_popup_seen (kakao_id, pop_key) values (kid, p_key) on conflict do nothing;
  return json_build_object('ok', true);
end $$;

grant execute on function member_att_pop_check(text, text) to anon, authenticated;
grant execute on function member_popup_mark(text, text)    to anon, authenticated;

select 'ok' as result;
