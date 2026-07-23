-- ══════════════════════════════════════════════════════════
--  RLS 정리 2단계 — 셀러 페이지(register.html) 쓰기 경로 교체
--  적용일: 2026-07-23
--
--  배경: register.html 이 공개 키로 gonggu 를 직접 수정·삭제하고 있어서
--        "누구나 수정/삭제 가능" 정책(allow_update / allow_delete)을 열어둬야 했다.
--        → 아무나 전체 공구를 지우거나 조작할 수 있는 상태.
--
--  해결: 로그인 시 세션 토큰을 발급하고, 모든 셀러 작업을 SECURITY DEFINER
--        함수로만 처리한다. 함수 안에서 "이 공구가 그 셀러 것인지" 검증한다.
--        그 뒤 gonggu 의 공개 쓰기 정책을 전부 제거한다.
--
--  ⚠ open_date / end_date 는 TEXT('YYYY-MM-DD') 다. date 로 캐스팅하지 말 것.
-- ══════════════════════════════════════════════════════════


-- ── 1) 세션 테이블 (anon·authenticated 모두 접근 불가, 함수만 사용) ──
create table if not exists public.seller_sessions (
  token_hash        text primary key,
  login_insta       text not null,
  seller_insta      text,
  seller_influencer text,
  created_at        timestamptz not null default now(),
  last_seen_at      timestamptz not null default now(),
  expires_at        timestamptz not null
);

alter table public.seller_sessions enable row level security;
revoke all on public.seller_sessions from anon, authenticated;
create index if not exists seller_sessions_expires_idx on public.seller_sessions (expires_at);


-- ── 2) 토큰 → 셀러 확인 (만료 검사 포함) ──
create or replace function public._seller_from_token(p_token text)
returns table (login_insta text, seller_insta text, seller_influencer text)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_hash text;
begin
  -- 토큰은 32바이트를 hex 로 만든 64자
  if p_token is null or length(p_token) <> 64 then return; end if;
  v_hash := encode(digest(p_token, 'sha256'), 'hex');

  update seller_sessions s set last_seen_at = now()
   where s.token_hash = v_hash and s.expires_at > now();

  return query
    select s.login_insta, s.seller_insta, s.seller_influencer
      from seller_sessions s
     where s.token_hash = v_hash and s.expires_at > now();
end;
$$;

revoke execute on function public._seller_from_token(text) from public, anon, authenticated;


-- ── 3) 로그인: 토큰 발급 + 약한 해시 자동 승급 ──
--    기존 해시가 cost 6($2a$06$) 이라 유출 시 취약했다. 로그인할 때마다 cost 12 로 다시 저장.
create or replace function public.seller_login(p_insta text, p_pw text)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare r sellers%rowtype; v_token text;
begin
  select * into r from sellers where sellers.login_insta = p_insta;
  if not found then return json_build_object('ok', false, 'msg', 'notfound'); end if;
  if r.login_pw is null or r.login_pw <> crypt(p_pw, r.login_pw) then
    return json_build_object('ok', false, 'msg', 'wrongpw');
  end if;
  if not r.login_active then return json_build_object('ok', false, 'msg', 'pending'); end if;

  -- 약한 비용(00~09)으로 만들어진 해시면 이번 로그인에 조용히 재해시
  if r.login_pw ~ '^\$2[aby]\$0[0-9]\$' then
    update sellers set login_pw = crypt(p_pw, gen_salt('bf', 12)) where id = r.id;
  end if;

  delete from seller_sessions where expires_at < now();

  v_token := encode(gen_random_bytes(32), 'hex');
  insert into seller_sessions (token_hash, login_insta, seller_insta, seller_influencer, expires_at)
  values (encode(digest(v_token, 'sha256'), 'hex'),
          r.login_insta, r.seller_insta, r.seller_influencer,
          now() + interval '30 days');

  return json_build_object(
    'ok', true,
    'token', v_token,
    'seller_influencer', r.seller_influencer,
    'seller_insta', r.seller_insta,
    'login_insta', r.login_insta
  );
end;
$$;


-- ── 4) 가입: 새 비밀번호는 cost 12 로 ──
create or replace function public.seller_signup(p_insta text, p_pw text, p_name text)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_exists int;
begin
  if coalesce(trim(p_insta),'') = '' or length(p_pw) < 6 then
    return json_build_object('ok', false, 'msg', 'invalid');
  end if;
  select count(*) into v_exists from sellers where sellers.login_insta = p_insta;
  if v_exists > 0 then return json_build_object('ok', false, 'msg', 'exists'); end if;

  insert into sellers (login_insta, login_pw, login_active, seller_influencer, seller_insta, name, insta, active)
  values (p_insta, crypt(p_pw, gen_salt('bf', 12)), false,
          coalesce(p_name, p_insta), p_insta, coalesce(p_name, p_insta), p_insta, false);
  return json_build_object('ok', true);
end;
$$;


-- ── 5) 로그아웃 ──
create or replace function public.seller_logout(p_token text)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if p_token is not null and length(p_token) = 64 then
    delete from seller_sessions where token_hash = encode(digest(p_token, 'sha256'), 'hex');
  end if;
  return json_build_object('ok', true);
end;
$$;


-- ── 6) 내 공구 목록 ──
create or replace function public.seller_list_gonggu(p_token text)
returns setof public.gonggu
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_login text; v_insta text; v_infl text; v_handle text;
begin
  select t.login_insta, t.seller_insta, t.seller_influencer
    into v_login, v_insta, v_infl
    from _seller_from_token(p_token) t;
  if v_login is null then raise exception 'unauthorized' using errcode = '28000'; end if;

  v_handle := replace(coalesce(nullif(v_insta,''), v_login), '@', '');
  return query
    select * from gonggu g
     where g.insta = v_handle
     order by g.open_date desc
     limit 2000;
end;
$$;


-- ── 7) 공구 등록 (항상 approved=false, 셀러명은 서버가 강제) ──
create or replace function public.seller_add_gonggu(p_token text, p_rows jsonb)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_login text; v_insta text; v_infl text; v_handle text; v_cnt int;
begin
  select t.login_insta, t.seller_insta, t.seller_influencer
    into v_login, v_insta, v_infl
    from _seller_from_token(p_token) t;
  if v_login is null then raise exception 'unauthorized' using errcode = '28000'; end if;

  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    return json_build_object('ok', false, 'msg', 'empty');
  end if;
  if jsonb_array_length(p_rows) > 50 then
    return json_build_object('ok', false, 'msg', 'toomany');
  end if;

  v_handle := replace(coalesce(nullif(v_insta,''), v_login), '@', '');

  insert into gonggu (name, major, minor, open_date, end_date, color, pay_link, insta, influencer, approved)
  select left(trim(x->>'name'), 120),
         left(x->>'major', 40),
         left(x->>'minor', 40),
         x->>'open_date',
         nullif(x->>'end_date', ''),
         left(x->>'color', 20),
         nullif(left(x->>'pay_link', 500), ''),
         v_handle,
         coalesce(nullif(v_infl,''), v_login),
         false
    from jsonb_array_elements(p_rows) x
   where coalesce(trim(x->>'name'), '') <> ''
     and (x->>'open_date') ~ '^\d{4}-\d{2}-\d{2}$'
     and (coalesce(x->>'end_date','') = '' or (x->>'end_date') ~ '^\d{4}-\d{2}-\d{2}$');

  get diagnostics v_cnt = row_count;
  return json_build_object('ok', true, 'count', v_cnt);
end;
$$;


-- ── 8) 공구 수정 (본인 것만, 수정하면 다시 승인대기) ──
create or replace function public.seller_update_gonggu(p_token text, p_id bigint, p_body jsonb)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_login text; v_insta text; v_infl text; v_handle text; v_cnt int;
begin
  select t.login_insta, t.seller_insta, t.seller_influencer
    into v_login, v_insta, v_infl
    from _seller_from_token(p_token) t;
  if v_login is null then raise exception 'unauthorized' using errcode = '28000'; end if;

  if (p_body->>'open_date') !~ '^\d{4}-\d{2}-\d{2}$' then
    return json_build_object('ok', false, 'msg', 'baddate');
  end if;
  if coalesce(p_body->>'end_date','') <> '' and (p_body->>'end_date') !~ '^\d{4}-\d{2}-\d{2}$' then
    return json_build_object('ok', false, 'msg', 'baddate');
  end if;
  if coalesce(trim(p_body->>'name'), '') = '' then
    return json_build_object('ok', false, 'msg', 'noname');
  end if;

  v_handle := replace(coalesce(nullif(v_insta,''), v_login), '@', '');

  -- insta / influencer / id 는 절대 바뀌지 않는다
  update gonggu g
     set name      = left(trim(p_body->>'name'), 120),
         major     = left(p_body->>'major', 40),
         minor     = left(p_body->>'minor', 40),
         open_date = p_body->>'open_date',
         end_date  = nullif(p_body->>'end_date', ''),
         color     = left(p_body->>'color', 20),
         pay_link  = nullif(left(p_body->>'pay_link', 500), ''),
         approved  = false
   where g.id = p_id
     and g.insta = v_handle;

  get diagnostics v_cnt = row_count;
  if v_cnt = 0 then return json_build_object('ok', false, 'msg', 'notyours'); end if;
  return json_build_object('ok', true);
end;
$$;


-- ── 9) 공구 삭제 (본인 것만) ──
create or replace function public.seller_delete_gonggu(p_token text, p_id bigint)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_login text; v_insta text; v_infl text; v_handle text; v_cnt int;
begin
  select t.login_insta, t.seller_insta, t.seller_influencer
    into v_login, v_insta, v_infl
    from _seller_from_token(p_token) t;
  if v_login is null then raise exception 'unauthorized' using errcode = '28000'; end if;

  v_handle := replace(coalesce(nullif(v_insta,''), v_login), '@', '');

  delete from gonggu g where g.id = p_id and g.insta = v_handle;
  get diagnostics v_cnt = row_count;
  if v_cnt = 0 then return json_build_object('ok', false, 'msg', 'notyours'); end if;
  return json_build_object('ok', true);
end;
$$;


-- ── 10) 실행 권한: 셀러 페이지(anon)만 호출 ──
revoke execute on function public.seller_list_gonggu(text)             from public;
revoke execute on function public.seller_add_gonggu(text, jsonb)       from public;
revoke execute on function public.seller_update_gonggu(text, bigint, jsonb) from public;
revoke execute on function public.seller_delete_gonggu(text, bigint)   from public;
revoke execute on function public.seller_logout(text)                  from public;

grant execute on function public.seller_list_gonggu(text)              to anon, authenticated;
grant execute on function public.seller_add_gonggu(text, jsonb)        to anon, authenticated;
grant execute on function public.seller_update_gonggu(text, bigint, jsonb) to anon, authenticated;
grant execute on function public.seller_delete_gonggu(text, bigint)    to anon, authenticated;
grant execute on function public.seller_logout(text)                   to anon, authenticated;
