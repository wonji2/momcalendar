-- 검증자 지적 반영 (2026-11-12 밤)
-- ① 키워드 핫딜 발송 대상 함수 2개를 익명 키로 부를 수 있었다(기기 번호·푸시 토큰·키워드가 보임).
--    rls_audit_140.sql 에 revoke 가 적혀 있었지만 운영 ACL 은 PUBLIC 실행 허용이었다. 발송기(Edge, service_role)와 pg_cron(postgres)만 부르면 된다.
revoke all on function public.kw_push_targets_ios() from public, anon, authenticated;
revoke all on function public.kw_push_targets_fcm() from public, anon, authenticated;
grant execute on function public.kw_push_targets_ios() to service_role;
grant execute on function public.kw_push_targets_fcm() to service_role;
revoke all on function public._push_quiet(jsonb) from public, anon, authenticated;
grant execute on function public._push_quiet(jsonb) to service_role;

-- ② 닉네임 규칙: 밑줄을 받지 않는다(안내 문구 「한글 · 영문 · 숫자」와 같게, 금지어 사이에 밑줄을 끼우는 길도 같이 막힘) · 금지어 보강
create or replace function public.member_set_nickname(p_token text, p_nick text)
returns json language plpgsql security definer set search_path to 'public' as $f$
declare kid text; v text; n int;
begin
  kid := _member_from_token(p_token);
  if kid is null then return json_build_object('ok', false, 'reason', 'auth'); end if;
  v := btrim(coalesce(p_nick, ''));
  if char_length(v) < 2 or char_length(v) > 10 then return json_build_object('ok', false, 'reason', 'len'); end if;
  if v !~ '^[가-힣A-Za-z0-9]+$' then return json_build_object('ok', false, 'reason', 'chars'); end if;
  if lower(v) ~ '(맘캘|momcal|관리자|운영자|운영진|방장|매니저|스탭|스태프|admin|official|manager|staff)' then return json_build_object('ok', false, 'reason', 'reserved'); end if;
  update members set nick_custom = v, nick_changed_at = now(), updated_at = now() where kakao_id = kid;
  get diagnostics n = row_count;
  if n = 0 then return json_build_object('ok', false, 'reason', 'auth'); end if;
  return json_build_object('ok', true, 'nickname', v);
end $f$;

-- 확인
select p.proname, has_function_privilege('anon', p.oid, 'execute') as anon_can, has_function_privilege('service_role', p.oid, 'execute') as service_can, p.prosecdef
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in ('kw_push_targets_ios','kw_push_targets_fcm','live_push_targets','live_push_targets_fcm','push_targets','push_targets_ios','push_targets_fcm','sale_push_targets','sale_push_targets_fcm','notice_targets','_push_quiet','member_set_nickname','member_profile','push_set_prefs')
order by 1;
