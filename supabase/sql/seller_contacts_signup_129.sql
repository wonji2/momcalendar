-- 이웃셀러 가입 항목 확장 및 연락처 컬럼 추가 (사장님 지시 2026-10-30)
-- 3개월 30만 / 6개월 50만 / 12개월 90만 유료 홍보 패키지 및 가입 폼 확장

ALTER TABLE public.sellers
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS contact_name text;

DROP FUNCTION IF EXISTS public.seller_signup(text, text, text);

CREATE OR REPLACE FUNCTION public.seller_signup(
  p_insta text,
  p_pw text,
  p_name text,
  p_phone text DEFAULT NULL,
  p_email text DEFAULT NULL,
  p_contact_name text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
declare v_exists int; v_id bigint; v_login text;
begin
  v_login := public.seller_id_norm(p_insta);
  if v_login = '' or p_pw is null or length(p_pw) < 6 then
    return json_build_object('ok', false, 'msg', 'invalid');
  end if;
  select count(*) into v_exists from sellers
   where public.seller_id_norm(sellers.login_insta) = v_login;
  if v_exists > 0 then return json_build_object('ok', false, 'msg', 'exists'); end if;

  insert into sellers (login_insta, login_active, seller_influencer, seller_insta, name, insta, active, phone, email, contact_name)
  values (v_login, false, coalesce(p_name, v_login), v_login, coalesce(p_name, v_login), v_login, false, p_phone, p_email, p_contact_name)
  returning id into v_id;

  insert into seller_auth (seller_id, login_pw) values (v_id, crypt(p_pw, gen_salt('bf', 12)));
  return json_build_object('ok', true);
end;
$function$;

GRANT EXECUTE ON FUNCTION public.seller_signup(text, text, text, text, text, text) TO anon, authenticated, service_role;
