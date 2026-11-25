-- 되돌리기: 2026-11-25 이전 seller_signup 그대로
CREATE OR REPLACE FUNCTION public.seller_signup(p_insta text, p_pw text, p_name text, p_phone text DEFAULT NULL::text, p_email text DEFAULT NULL::text, p_contact_name text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$ declare v_exists int; v_id bigint; v_login text; begin v_login := public.seller_id_norm(p_insta); if v_login = '' or p_pw is null or length(p_pw) < 6 then return json_build_object('ok', false, 'msg', 'invalid'); end if; select count(*) into v_exists from sellers where public.seller_id_norm(sellers.login_insta) = v_login; if v_exists > 0 then return json_build_object('ok', false, 'msg', 'exists'); end if; insert into sellers (login_insta, login_active, seller_influencer, seller_insta, name, insta, active, phone, email, contact_name) values (v_login, false, coalesce(p_name, v_login), v_login, coalesce(p_name, v_login), v_login, false, p_phone, p_email, p_contact_name) returning id into v_id; insert into seller_auth (seller_id, login_pw) values (v_id, crypt(p_pw, gen_salt('bf', 12))); return json_build_object('ok', true); end; $function$
;
