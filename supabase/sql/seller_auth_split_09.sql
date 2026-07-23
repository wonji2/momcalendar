-- ══════════════════════════════════════════════════════════
--  9단계 — 셀러 비밀번호를 별도 테이블로 분리 (1/2: 복사 + 함수 교체)
--  적용일: 2026-07-23
--
--  배경: sellers 테이블에 공개용 정보(이름·인스타·등급)와 비밀번호가 함께 있었다.
--        2026-07-23 오전, 메인 페이지의 select=* 조회로 셀러 18명의 비밀번호
--        해시가 방문자에게 그대로 내려가고 있던 사고의 원인이 이 구조였다.
--        지금은 컬럼 권한으로 막아뒀지만, 앞으로 누군가 셀러 기능을 추가하며
--        그 규칙을 빠뜨리면 다시 새어나갈 수 있다.
--
--  조치: 비밀번호를 seller_auth 로 옮긴다. 이 테이블은 정책이 하나도 없어
--        anon/authenticated 어느 쪽도 접근할 수 없고, SECURITY DEFINER 함수만
--        읽고 쓴다. 구조적으로 유출될 자리가 없어진다.
--
--  ⚠ 이 파일은 sellers.login_pw 를 지우지 않는다.
--    검증을 통과한 뒤 seller_auth_split_10.sql 에서 지운다.
-- ══════════════════════════════════════════════════════════


-- ── 1) 비밀번호 전용 테이블 ──
create table if not exists public.seller_auth (
  seller_id  bigint primary key references public.sellers(id) on delete cascade,
  login_pw   text not null,
  updated_at timestamptz not null default now()
);

alter table public.seller_auth enable row level security;
revoke all on public.seller_auth from anon, authenticated;
-- 정책 없음 = service_role 과 SECURITY DEFINER 함수만 접근 가능


-- ── 2) 기존 비밀번호 이관 (복사만, 원본은 그대로 둔다) ──
insert into public.seller_auth (seller_id, login_pw)
select id, login_pw from public.sellers where login_pw is not null
on conflict (seller_id) do update set login_pw = excluded.login_pw;


-- ── 3) 로그인 ──
create or replace function public.seller_login(p_insta text, p_pw text)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare r sellers%rowtype; v_hash text; v_token text;
begin
  select * into r from sellers where sellers.login_insta = p_insta;
  if not found then return json_build_object('ok', false, 'msg', 'notfound'); end if;

  select a.login_pw into v_hash from seller_auth a where a.seller_id = r.id;
  if v_hash is null or v_hash <> crypt(p_pw, v_hash) then
    return json_build_object('ok', false, 'msg', 'wrongpw');
  end if;
  if not r.login_active then return json_build_object('ok', false, 'msg', 'pending'); end if;

  -- 약한 비용(00~09)으로 만들어진 해시면 이번 로그인에 조용히 재해시
  if v_hash ~ '^\$2[aby]\$0[0-9]\$' then
    update seller_auth set login_pw = crypt(p_pw, gen_salt('bf', 12)), updated_at = now()
     where seller_id = r.id;
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


-- ── 4) 셀러 가입 ──
create or replace function public.seller_signup(p_insta text, p_pw text, p_name text)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_exists int; v_id bigint;
begin
  if coalesce(trim(p_insta),'') = '' or length(p_pw) < 6 then
    return json_build_object('ok', false, 'msg', 'invalid');
  end if;
  select count(*) into v_exists from sellers where sellers.login_insta = p_insta;
  if v_exists > 0 then return json_build_object('ok', false, 'msg', 'exists'); end if;

  insert into sellers (login_insta, login_active, seller_influencer, seller_insta, name, insta, active)
  values (p_insta, false, coalesce(p_name, p_insta), p_insta, coalesce(p_name, p_insta), p_insta, false)
  returning id into v_id;

  insert into seller_auth (seller_id, login_pw)
  values (v_id, crypt(p_pw, gen_salt('bf', 12)));

  return json_build_object('ok', true);
end;
$$;


-- ── 5) 셀러 본인 비밀번호 변경 ──
create or replace function public.seller_change_pw(p_insta text, p_old text, p_new text)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_id bigint; v_hash text;
begin
  if p_new is null or length(p_new) < 6 then
    return json_build_object('ok', false, 'msg', 'weak');
  end if;

  select id into v_id from sellers where sellers.login_insta = p_insta;
  if v_id is null then return json_build_object('ok', false, 'msg', 'notfound'); end if;

  select a.login_pw into v_hash from seller_auth a where a.seller_id = v_id;
  if v_hash is null or v_hash <> crypt(p_old, v_hash) then
    return json_build_object('ok', false, 'msg', 'wrongpw');
  end if;

  update seller_auth set login_pw = crypt(p_new, gen_salt('bf', 12)), updated_at = now()
   where seller_id = v_id;

  -- 비밀번호를 바꾸면 기존 로그인 세션은 모두 끊는다
  delete from seller_sessions where login_insta = p_insta;
  return json_build_object('ok', true);
end;
$$;


-- ── 6) 관리자: 비밀번호 강제 변경 ──
create or replace function public.admin_reset_pw(p_insta text, p_new text)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_id bigint;
begin
  if not public.is_app_admin() then
    return json_build_object('ok', false, 'msg', 'forbidden');
  end if;
  if p_new is null or length(p_new) < 6 then
    return json_build_object('ok', false, 'msg', 'weak');
  end if;

  select id into v_id from sellers where sellers.login_insta = p_insta;
  if v_id is null then return json_build_object('ok', false, 'msg', 'notfound'); end if;

  insert into seller_auth (seller_id, login_pw)
  values (v_id, crypt(p_new, gen_salt('bf', 12)))
  on conflict (seller_id) do update
    set login_pw = excluded.login_pw, updated_at = now();

  delete from seller_sessions where login_insta = p_insta;
  return json_build_object('ok', true);
end;
$$;


-- ── 7) 관리자: 셀러 생성 ──
create or replace function public.admin_create_seller(p_insta text, p_pw text, p_name text)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_exists int; v_id bigint;
begin
  if not public.is_app_admin() then
    return json_build_object('ok', false, 'msg', 'forbidden');
  end if;
  if coalesce(trim(p_insta),'') = '' or length(p_pw) < 6 then
    return json_build_object('ok', false, 'msg', 'invalid');
  end if;

  select count(*) into v_exists from sellers where sellers.login_insta = p_insta;
  if v_exists > 0 then return json_build_object('ok', false, 'msg', 'exists'); end if;

  insert into sellers (login_insta, login_active, seller_influencer, seller_insta, name, insta, active)
  values (p_insta, true, coalesce(p_name, p_insta), p_insta, coalesce(p_name, p_insta), p_insta, true)
  returning id into v_id;

  insert into seller_auth (seller_id, login_pw)
  values (v_id, crypt(p_pw, gen_salt('bf', 12)));

  return json_build_object('ok', true);
end;
$$;
