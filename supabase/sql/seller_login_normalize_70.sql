-- 🔴🔴 셀러 로그인: 아이디를 **정규화**해서 찾는다 (사장님 제보 2026-09-30 "리빙유 … 로그인안된대")
--
-- 무엇이 문제였나 (실측)
--   리빙유(id 67 · `tamimamang`)는 DB 가 완벽했다 — 비번 bcrypt 있음 · login_active=true.
--   그런데 `seller_login` 은 `login_insta = p_insta` **정확일치**로 찾는다. 그래서:
--     tamimamang   → wrongpw   (계정은 찾음)
--     Tamimamang   → notfound  ← 대문자
--     @tamimamang  → notfound  ← 셀러가 인스타 아이디를 @ 와 함께 적는 건 아주 흔하다
--     " tamimamang"→ notfound  ← 앞 공백(모바일 자동완성·복붙)
--   셀러 화면엔 「없는 계정」으로 보이니 "승인이 안 된 건가?" 하고 헤맨다.
--   ⚠ 인스타 아이디는 원래 대소문자를 구분하지 않는다. 우리가 구분한 것이 잘못이다.
--
-- 고치는 것
--   · 찾을 때: `@` 제거 · 앞뒤 공백 제거 · **대소문자 무시**
--   · 만들 때(가입·관리자 생성): 같은 규칙으로 **소문자로 저장** — 다음부터 어긋나지 않는다
--   · 중복 검사도 같은 정규화로 — 대소문자만 다른 계정이 두 개 생기지 않게
--   실측 확인: 소문자로 합쳤을 때 충돌하는 아이디는 **없다**(2026-09-30). 안전하게 바꿀 수 있다.
--
-- 🔑 비번 검사가 `login_active` 검사보다 **먼저**라 승인 전 셀러도 `wrongpw` 를 본다.
--    그건 그대로 둔다(비번을 모르는 사람에게 승인 상태를 알려주지 않는 게 맞다).

create or replace function public.seller_id_norm(p text)
returns text language sql immutable as $$
  select lower(btrim(replace(coalesce(p, ''), '@', '')))
$$;

-- ── 로그인 ──
create or replace function public.seller_login(p_insta text, p_pw text)
returns json language plpgsql security definer set search_path to 'public', 'extensions' as $function$
declare r sellers%rowtype; v_hash text; v_token text;
begin
  select * into r from sellers
   where public.seller_id_norm(sellers.login_insta) = public.seller_id_norm(p_insta)
   order by sellers.id limit 1;
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

  return json_build_object('ok', true, 'token', v_token,
    'seller_influencer', r.seller_influencer, 'seller_insta', r.seller_insta, 'login_insta', r.login_insta);
end;
$function$;

-- ── 비밀번호 변경 ──
create or replace function public.seller_change_pw(p_insta text, p_old text, p_new text)
returns json language plpgsql security definer set search_path to 'public', 'extensions' as $function$
declare v_id bigint; v_login text; v_hash text;
begin
  if p_new is null or length(p_new) < 6 then
    return json_build_object('ok', false, 'msg', 'weak');
  end if;

  select id, login_insta into v_id, v_login from sellers
   where public.seller_id_norm(sellers.login_insta) = public.seller_id_norm(p_insta)
   order by id limit 1;
  if v_id is null then return json_build_object('ok', false, 'msg', 'notfound'); end if;

  select a.login_pw into v_hash from seller_auth a where a.seller_id = v_id;
  if v_hash is null or v_hash <> crypt(p_old, v_hash) then
    return json_build_object('ok', false, 'msg', 'wrongpw');
  end if;

  update seller_auth set login_pw = crypt(p_new, gen_salt('bf', 12)), updated_at = now()
   where seller_id = v_id;

  -- 비밀번호를 바꾸면 기존 로그인 세션은 모두 끊는다 (⚠ 실제 저장된 login_insta 로 지운다)
  delete from seller_sessions where login_insta = v_login;
  return json_build_object('ok', true);
end;
$function$;

-- ── 셀러 가입(승인 대기로 생성) ──
create or replace function public.seller_signup(p_insta text, p_pw text, p_name text)
returns json language plpgsql security definer set search_path to 'public', 'extensions' as $function$
declare v_exists int; v_id bigint; v_login text;
begin
  v_login := public.seller_id_norm(p_insta);                     -- 소문자·@없이 저장한다
  if v_login = '' or p_pw is null or length(p_pw) < 6 then
    return json_build_object('ok', false, 'msg', 'invalid');
  end if;
  select count(*) into v_exists from sellers
   where public.seller_id_norm(sellers.login_insta) = v_login;
  if v_exists > 0 then return json_build_object('ok', false, 'msg', 'exists'); end if;

  insert into sellers (login_insta, login_active, seller_influencer, seller_insta, name, insta, active)
  values (v_login, false, coalesce(p_name, v_login), v_login, coalesce(p_name, v_login), v_login, false)
  returning id into v_id;

  insert into seller_auth (seller_id, login_pw) values (v_id, crypt(p_pw, gen_salt('bf', 12)));
  return json_build_object('ok', true);
end;
$function$;

-- ── 관리자가 셀러 계정 만들기 ──
create or replace function public.admin_create_seller(p_insta text, p_pw text, p_name text)
returns json language plpgsql security definer set search_path to 'public', 'extensions' as $function$
declare v_exists int; v_id bigint; v_login text;
begin
  if not public.is_app_admin() then
    return json_build_object('ok', false, 'msg', 'forbidden');
  end if;
  v_login := public.seller_id_norm(p_insta);
  if v_login = '' or p_pw is null or length(p_pw) < 6 then
    return json_build_object('ok', false, 'msg', 'invalid');
  end if;
  select count(*) into v_exists from sellers
   where public.seller_id_norm(sellers.login_insta) = v_login;
  if v_exists > 0 then return json_build_object('ok', false, 'msg', 'exists'); end if;

  insert into sellers (login_insta, login_active, seller_influencer, seller_insta, name, insta, active)
  values (v_login, true, coalesce(p_name, v_login), v_login, coalesce(p_name, v_login), v_login, true)
  returning id into v_id;

  insert into seller_auth (seller_id, login_pw) values (v_id, crypt(p_pw, gen_salt('bf', 12)));
  return json_build_object('ok', true);
end;
$function$;

-- ── 이미 들어간 대문자 아이디를 소문자로 정리 (충돌 없음 확인 후) ──
--    「노댕맘 Nodaeng.m」 하나뿐이었다. 이 셀러도 소문자로 치면 로그인이 안 됐다.
update public.sellers
   set login_insta = public.seller_id_norm(login_insta)
 where coalesce(login_insta,'') <> ''
   and login_insta <> public.seller_id_norm(login_insta);

select count(*) as 정리후_이상한아이디 from public.sellers
 where coalesce(login_insta,'') <> '' and login_insta <> public.seller_id_norm(login_insta);
