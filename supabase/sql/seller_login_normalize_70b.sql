-- 🔧 admin_reset_pw 도 아이디를 정규화한다 (2026-09-30 · 70 의 빠진 조각)
--   사장님이 셀러 비번을 재설정할 때 `@tamimamang` 이나 대문자로 치면 「notfound」가 되던 것.
--   ⚠ 세션 삭제도 **실제 저장된 login_insta** 로 해야 한다 — 입력값으로 지우면 안 지워진다.
create or replace function public.admin_reset_pw(p_insta text, p_new text)
returns json language plpgsql security definer set search_path to 'public', 'extensions' as $function$
declare v_id bigint; v_login text;
begin
  if not public.is_app_admin() then
    return json_build_object('ok', false, 'msg', 'forbidden');
  end if;
  if p_new is null or length(p_new) < 6 then
    return json_build_object('ok', false, 'msg', 'weak');
  end if;

  select id, login_insta into v_id, v_login from sellers
   where public.seller_id_norm(sellers.login_insta) = public.seller_id_norm(p_insta)
   order by id limit 1;
  if v_id is null then return json_build_object('ok', false, 'msg', 'notfound'); end if;

  insert into seller_auth (seller_id, login_pw)
  values (v_id, crypt(p_new, gen_salt('bf', 12)))
  on conflict (seller_id) do update
    set login_pw = excluded.login_pw, updated_at = now();

  delete from seller_sessions where login_insta = v_login;
  return json_build_object('ok', true);
end;
$function$;
