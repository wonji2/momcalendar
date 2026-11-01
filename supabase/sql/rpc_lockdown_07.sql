-- ══════════════════════════════════════════════════════════
--  RLS 정리 7단계 — 함수 실행 권한 잠금
--  적용일: 2026-07-23
--
--  🔴 발견한 문제
--     admin_reset_pw(셀러 비밀번호 강제 변경)와 admin_create_seller 가
--     SECURITY DEFINER 인데 anon 에게도 EXECUTE 권한이 있었다.
--     → 공개 키만으로 아무 셀러의 비밀번호를 바꿔 계정을 탈취할 수 있었다.
--       (실제로 anon 호출이 200 으로 실행되는 것을 확인함)
--
--  추가 조치
--     · SECURITY DEFINER 함수에 search_path 고정 (search_path 하이재킹 방지)
--     · 비밀번호 해시 비용을 6 → 12 로 상향
-- ══════════════════════════════════════════════════════════


-- ── 1) 관리자 전용 함수: 내부에서 관리자 확인 + 실행권한 회수 ──
create or replace function public.admin_reset_pw(p_insta text, p_new text)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if not public.is_app_admin() then
    return json_build_object('ok', false, 'msg', 'forbidden');
  end if;
  if p_new is null or length(p_new) < 6 then
    return json_build_object('ok', false, 'msg', 'weak');
  end if;

  update sellers set login_pw = crypt(p_new, gen_salt('bf', 12))
   where login_insta = p_insta;
  if not found then return json_build_object('ok', false, 'msg', 'notfound'); end if;
  return json_build_object('ok', true);
end;
$$;

create or replace function public.admin_create_seller(p_insta text, p_pw text, p_name text)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_exists int;
begin
  if not public.is_app_admin() then
    return json_build_object('ok', false, 'msg', 'forbidden');
  end if;
  if coalesce(trim(p_insta),'') = '' or length(p_pw) < 6 then
    return json_build_object('ok', false, 'msg', 'invalid');
  end if;

  select count(*) into v_exists from sellers where login_insta = p_insta;
  if v_exists > 0 then return json_build_object('ok', false, 'msg', 'exists'); end if;

  insert into sellers (login_insta, login_pw, login_active, seller_influencer, seller_insta, name, insta, active)
  values (p_insta, crypt(p_pw, gen_salt('bf', 12)), true,
          coalesce(p_name, p_insta), p_insta, coalesce(p_name, p_insta), p_insta, true);
  return json_build_object('ok', true);
end;
$$;

revoke execute on function public.admin_reset_pw(text, text)            from public, anon;
revoke execute on function public.admin_create_seller(text, text, text) from public, anon;
grant  execute on function public.admin_reset_pw(text, text)            to authenticated;
grant  execute on function public.admin_create_seller(text, text, text) to authenticated;


-- ── 2) 셀러 본인 비밀번호 변경: 기존 비밀번호 확인이 있으므로 anon 유지 ──
--    search_path 고정 + 해시 비용 상향만 적용
create or replace function public.seller_change_pw(p_insta text, p_old text, p_new text)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare r sellers%rowtype;
begin
  if p_new is null or length(p_new) < 6 then
    return json_build_object('ok', false, 'msg', 'weak');
  end if;
  select * into r from sellers where login_insta = p_insta;
  if not found then return json_build_object('ok', false, 'msg', 'notfound'); end if;
  if r.login_pw is null or r.login_pw <> crypt(p_old, r.login_pw) then
    return json_build_object('ok', false, 'msg', 'wrongpw');
  end if;

  update sellers set login_pw = crypt(p_new, gen_salt('bf', 12)) where login_insta = p_insta;
  -- 비밀번호를 바꾸면 기존 로그인 세션은 모두 끊는다
  delete from seller_sessions where login_insta = p_insta;
  return json_build_object('ok', true);
end;
$$;

revoke execute on function public.seller_change_pw(text, text, text) from public;
grant  execute on function public.seller_change_pw(text, text, text) to anon, authenticated;


-- ── 3) 푸시 대상 조회 함수: Edge Function(service_role) 만 ──
revoke execute on function public.push_targets()   from public, anon, authenticated;
revoke execute on function public.notice_targets() from public, anon, authenticated;
grant  execute on function public.push_targets()   to service_role;
grant  execute on function public.notice_targets() to service_role;


-- ── 4) 내부 유틸 함수: 외부 호출 불필요 ──
revoke execute on function public.mc_cleanname(text) from public, anon, authenticated;
alter  function public.mc_cleanname(text) set search_path = public;


-- ── 5) 나머지 SECURITY DEFINER 함수 search_path 고정 ──
alter function public.gonggu_click_counts(integer, integer) set search_path = public;
alter function public.seller_login(text, text)              set search_path = public, extensions;
alter function public.seller_signup(text, text, text)       set search_path = public, extensions;
