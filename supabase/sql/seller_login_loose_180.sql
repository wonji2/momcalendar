-- 셀러 로그인: 아이디의 밑줄(_)·점(.)을 빼먹어도 그런 계정이 딱 하나면 로그인 (사장님 제보 2026-11-23 「momcal로 로그인이 안돼」 —
--   계정은 momcal_, 12:30 에 momcal 로 2번 시도 → notfound). 비밀번호 검사·잠금(10번/15분)은 그대로.
--   ① 정확히 같은 아이디(seller_id_norm)가 있으면 그것 ② 없으면 밑줄·점을 뺀 꼴이 같은 계정이 딱 1개일 때만 그것(2개 이상이면 notfound — 남의 계정으로 새지 않게)
-- 되돌리기: seller_login_normalize_70.sql · security_low_148.sql 의 seller_login 을 다시 실행(① 만 있던 판).
create or replace function public.seller_login(p_insta text, p_pw text)
 returns json
 language plpgsql
 security definer
 set search_path to 'public', 'extensions'
as $function$
declare r sellers%rowtype; v_hash text; v_token text; v_norm text; v_loose text; v_ip text; v_n int;
begin
  v_norm := coalesce(public.seller_id_norm(p_insta), '');
  v_ip := public._req_ip();
  if public._rate_n('login_fail_id', v_norm, 900) >= 10 or public._rate_n('login_fail_ip', v_ip, 900) >= 30 then
    return json_build_object('ok', false, 'msg', 'locked');
  end if;

  select * into r from sellers
   where public.seller_id_norm(sellers.login_insta) = v_norm
   order by sellers.id limit 1;
  if not found and v_norm <> '' then
    v_loose := regexp_replace(v_norm, '[._]', '', 'g');
    if v_loose <> '' then
      select count(*) into v_n from sellers
       where sellers.login_insta is not null and regexp_replace(public.seller_id_norm(sellers.login_insta), '[._]', '', 'g') = v_loose;
      if v_n = 1 then
        select * into r from sellers
         where sellers.login_insta is not null and regexp_replace(public.seller_id_norm(sellers.login_insta), '[._]', '', 'g') = v_loose
         limit 1;
      end if;
    end if;
  end if;
  if r.id is null then
    perform public._rate_hit('login_fail_id', v_norm, 1000000, 900);
    perform public._rate_hit('login_fail_ip', v_ip, 1000000, 900);
    return json_build_object('ok', false, 'msg', 'notfound');
  end if;

  select a.login_pw into v_hash from seller_auth a where a.seller_id = r.id;
  if v_hash is null or v_hash <> crypt(p_pw, v_hash) then
    perform public._rate_hit('login_fail_id', v_norm, 1000000, 900);
    perform public._rate_hit('login_fail_ip', v_ip, 1000000, 900);
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
