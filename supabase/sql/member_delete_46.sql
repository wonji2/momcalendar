-- 회원 탈퇴 (계정 삭제) — 애플 App Store 필수 요건 5.1.1(v)
--   "계정 생성을 지원하는 앱은 앱 안에서 계정 삭제를 제공해야 한다"
--   앱을 내지 않더라도 필요하다: 개인정보처리방침에 수집 항목을 적어두고
--   삭제 수단이 없는 것은 그 자체로 문제 소지가 있다.
--
-- 지우는 것: 회원 정보 · 출석 · 당첨 기록(연락처 포함) · 캘린더 내보낸 기록 · 로그인 세션
-- ⚠ 찜(wishes)·푸시구독(push_subs)은 **기기(device_id) 기준**이라 회원과 별개다.
--    로그인 없이도 쓰는 기능이라 함께 지우면 "탈퇴했더니 찜이 다 사라졌다" 가 된다.
--    대신 그 기기의 것을 지울지 선택할 수 있게 p_wipe_device 를 둔다(기본 false).
create or replace function public.member_delete_account(p_token text, p_wipe_device boolean default false)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_kakao text; v_dev text; v_n int; v_w int := 0;
begin
  -- ⚠ _member_from_token 은 kakao_id 를 text 로 바로 돌려준다 (테이블이 아니다)
  v_kakao := _member_from_token(p_token);
  select m.device_id into v_dev from members m where m.kakao_id = v_kakao;
  if v_kakao is null then raise exception 'unauthorized' using errcode = '28000'; end if;

  delete from attendance_winners where kakao_id = v_kakao;   -- 연락처가 들어있다. 반드시 먼저
  delete from attendance        where kakao_id = v_kakao;
  delete from member_ics        where kakao_id = v_kakao;
  delete from member_sessions   where kakao_id = v_kakao;    -- 모든 기기 로그아웃
  delete from members           where kakao_id = v_kakao;
  get diagnostics v_n = row_count;

  if p_wipe_device and coalesce(v_dev,'') <> '' then
    delete from wishes where device_id = v_dev;
    get diagnostics v_w = row_count;
    delete from push_subs where device_id = v_dev;
  end if;

  return json_build_object('ok', true, 'deleted', v_n, 'wishes_deleted', v_w);
end $$;

revoke execute on function public.member_delete_account(text, boolean) from public;
grant  execute on function public.member_delete_account(text, boolean) to anon, authenticated;
