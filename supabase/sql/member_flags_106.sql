-- 회원 계정에 남기는 작은 「봤음」 표시 (사장님 2026-10-25 「로그인한 사람은 계정에 봤음 기록해서 다른 브라우저에서도 안 뜨게」)
--   첫 실행 소개(온보딩)를 카톡 인앱에서 본 회원이 사파리·크롬에서 로그인한 채 들어오면 다시 안 뜨게 한다.
--   브라우저마다 저장소가 따로라 로그인 안 한 손님은 알 방법이 없다 — 회원만 해당.
--   표시 이름은 정해 둔 것만 받는다(아무 문자열이나 쌓이지 않게): onb_web(웹) · onb_app(안드로이드·아이폰 앱 — 앱은 처음 깔면 또 보여 주므로 따로 센다)
--   RLS on + 정책 없음 = 아래 SECURITY DEFINER 함수로만 읽고 쓴다(member_sessions 와 같은 방식). 토큰은 _member_from_token 이 확인.
--   회원 탈퇴(members 행 삭제) 때 같이 지워진다 — 트리거.

create table if not exists public.member_flags (
  kakao_id text not null,
  flag     text not null,
  at       timestamptz not null default now(),
  primary key (kakao_id, flag)
);
alter table public.member_flags enable row level security;
revoke all on public.member_flags from anon, authenticated;

create or replace function public.member_flag_list(p_token text)
returns json language plpgsql stable security definer set search_path = public, extensions as $$
declare kid text;
begin
  kid := _member_from_token(p_token);
  if kid is null then return json_build_object('ok', false, 'error', 'login_required'); end if;
  return json_build_object('ok', true, 'flags', coalesce((select json_agg(flag order by flag) from member_flags where kakao_id = kid), '[]'::json));
end $$;

create or replace function public.member_flag_set(p_token text, p_flag text)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare kid text;
begin
  if p_flag not in ('onb_web', 'onb_app') then return json_build_object('ok', false, 'error', 'bad_flag'); end if;
  kid := _member_from_token(p_token);
  if kid is null then return json_build_object('ok', false, 'error', 'login_required'); end if;
  insert into member_flags (kakao_id, flag) values (kid, p_flag) on conflict do nothing;
  return json_build_object('ok', true);
end $$;

revoke all on function public.member_flag_list(text) from public;
revoke all on function public.member_flag_set(text, text) from public;
grant execute on function public.member_flag_list(text) to anon, authenticated;
grant execute on function public.member_flag_set(text, text) to anon, authenticated;

create or replace function public._member_flags_on_member_delete()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from member_flags where kakao_id = old.kakao_id;
  return old;
end $$;
drop trigger if exists member_flags_cleanup on public.members;
create trigger member_flags_cleanup after delete on public.members
  for each row execute function public._member_flags_on_member_delete();
