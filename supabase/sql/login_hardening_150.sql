-- 로그인 보강 (2026-11-16 · 사장님 「다해」 — 스레드 @bonaememo 점검표 대조에서 나온 보통 2건)
--  ① member_logout(p_token): 로그아웃 때 서버 세션(member_sessions)을 지운다. 전에는 브라우저 저장값만 지워 토큰이 180일 살아 있었다.
--     토큰 원문을 아는 사람만 그 세션 하나를 지운다(회원번호를 인자로 받지 않는다).
--  ② login_rate_ok(p_ip, p_fn): 로그인 Edge 함수(kakao-auth·naver-auth·apple-auth)가 맨 앞에서 부른다. IP 당 10분 60회.
--     클라우드플레어 워커(api.momcalendar.com 우회로)를 거친 요청은 손님들이 워커 IP 하나로 보이므로 여기서는 세지 않는다.
--     service_role 만 실행(손님이 직접 불러 남의 IP 횟수를 올리지 못하게). 기존 _rate_hit·rate_ctr 재사용(2일 지난 행은 _rate_hit 이 지운다).
--  한도: rate_ctr 행은 (함수·IP·10분 창)마다 1행, 2일 보관 → 하루 로그인 수백 건 기준 수천 행 이하.
create or replace function public.member_logout(p_token text)
 returns json language plpgsql security definer set search_path to 'public', 'extensions'
as $function$
declare n int;
begin
  if coalesce(p_token, '') = '' then return json_build_object('ok', false); end if;
  delete from member_sessions where token_hash = encode(digest(p_token, 'sha256'), 'hex');
  get diagnostics n = row_count;
  return json_build_object('ok', true, 'n', n);
end $function$;
revoke all on function public.member_logout(text) from public;
grant execute on function public.member_logout(text) to anon, authenticated, service_role;

create or replace function public.login_rate_ok(p_ip text, p_fn text)
 returns boolean language plpgsql security definer set search_path to 'public'
as $function$
declare v_ip text := coalesce(nullif(btrim(p_ip), ''), 'none'); v_max int := 60;
begin
  -- 워커(api.momcalendar.com) 경유·IP 모름: 손님 전원이 한 키로 묶인다 → 여기서 세면 한 사람이 그 통을 채워 남의 로그인을 막을 수 있다(검증자 2026-11-16).
  --   그래서 세지 않고 통과시킨다(이 길은 전과 같다). 워커 길의 제한은 워커가 손님 IP 로 따로 건다(남은 일).
  if v_ip like '2a06:98c0:%' or v_ip = 'none' then return true; end if;
  return public._rate_hit('login_' || left(coalesce(p_fn, '?'), 20), v_ip, v_max, 600);
end $function$;
revoke all on function public.login_rate_ok(text, text) from public, anon, authenticated;
grant execute on function public.login_rate_ok(text, text) to service_role;
