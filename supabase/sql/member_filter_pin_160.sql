-- 160 — 공구 분류 필터 고정(계정 기준) (사장님 2026-11-18 「호갱노노처럼 필터 고정 한번 해두면 앱 껐다 켜도 대분류 소분류 선택한 것만 · 저장은 로그인대로」)
--   회원 1명당 1줄: 고정한 대분류 + 소분류 여러 개. 로그인 토큰으로만 읽고 쓴다(기기와 무관 → 폰을 바꿔도 따라온다).
--   한도: 회원 수만큼만 늘어난다(1줄 약 100바이트) — LONG_TERM_REGISTER 에 적을 만큼 크지 않다.
--   되돌리기: drop trigger member_filter_pin_cleanup on members; drop function _member_filter_pin_cleanup(); drop function member_filter_get(text); drop function member_filter_set(text,text,text[]); drop table member_filter_pin;
create table if not exists public.member_filter_pin (
  kakao_id   text primary key,
  major      text not null,
  minors     text[] not null default '{}',
  updated_at timestamptz not null default now()
);
alter table public.member_filter_pin enable row level security;
revoke all on table public.member_filter_pin from anon, authenticated;

create or replace function public.member_filter_get(p_token text)
returns json language plpgsql stable security definer set search_path = public as $$
declare v_kid text; r member_filter_pin;
begin
  if p_token is null or p_token = '' then return json_build_object('ok', false, 'msg', 'login'); end if;
  v_kid := _member_from_token(p_token);
  if v_kid is null then return json_build_object('ok', false, 'msg', 'login'); end if;
  select * into r from member_filter_pin where kakao_id = v_kid;
  if not found then return json_build_object('ok', true, 'pinned', false); end if;
  return json_build_object('ok', true, 'pinned', true, 'major', r.major, 'minors', to_json(r.minors));
end $$;

-- p_major 가 null·빈 값·'전체' 면 고정을 푼다
create or replace function public.member_filter_set(p_token text, p_major text, p_minors text[] default '{}')
returns json language plpgsql security definer set search_path = public as $$
declare v_kid text; v_min text[];
begin
  if p_token is null or p_token = '' then return json_build_object('ok', false, 'msg', 'login'); end if;
  v_kid := _member_from_token(p_token);
  if v_kid is null then return json_build_object('ok', false, 'msg', 'login'); end if;
  if p_major is null or btrim(p_major) = '' or p_major = '전체' then
    delete from member_filter_pin where kakao_id = v_kid;
    return json_build_object('ok', true, 'pinned', false);
  end if;
  if length(p_major) > 20 then return json_build_object('ok', false, 'msg', 'bad'); end if;
  -- 보낸 순서 그대로(겹친 것만 뺀다) — 순서가 바뀌면 다른 기기에서 단추 이름(「A 외 1」)이 달라진다
  v_min := coalesce(array(select t.m from unnest(coalesce(p_minors, '{}')) with ordinality t(m, o) where t.m is not null and length(t.m) between 1 and 30 group by t.m order by min(t.o) limit 30), '{}');
  insert into member_filter_pin(kakao_id, major, minors, updated_at) values (v_kid, p_major, v_min, now())
  on conflict (kakao_id) do update set major = excluded.major, minors = excluded.minors, updated_at = now();
  return json_build_object('ok', true, 'pinned', true, 'major', p_major, 'minors', to_json(v_min));
end $$;

revoke all on function public.member_filter_get(text) from public;
revoke all on function public.member_filter_set(text, text, text[]) from public;
grant execute on function public.member_filter_get(text) to anon, authenticated;
grant execute on function public.member_filter_set(text, text, text[]) to anon, authenticated;

-- 탈퇴하면 같이 지운다(탈퇴 함수 member_delete_account 는 건드리지 않고, 회원 줄이 지워질 때 따라 지우는 방아쇠로)
create or replace function public._member_filter_pin_cleanup() returns trigger language plpgsql security definer set search_path = public as $$
begin delete from member_filter_pin where kakao_id = old.kakao_id; return old; end $$;
revoke all on function public._member_filter_pin_cleanup() from public, anon, authenticated;
drop trigger if exists member_filter_pin_cleanup on public.members;
create trigger member_filter_pin_cleanup after delete on public.members for each row execute function public._member_filter_pin_cleanup();
