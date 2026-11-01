-- 회원 탈퇴 때 계정↔기기 연결(member_devices, 102)도 지운다 — 102 를 만들며 빠뜨렸다(2026-10-25 탈퇴 점검 중 발견)
create or replace function public.member_delete_account(p_token text, p_wipe_device boolean DEFAULT false)
 returns json language plpgsql security definer set search_path to 'public', 'extensions'
as $function$
declare v_kakao text; v_dev text; v_n int; v_w int := 0; v_q int := 0;
begin
  -- ⚠ _member_from_token 은 kakao_id 를 text 로 바로 돌려준다 (테이블이 아니다)
  v_kakao := _member_from_token(p_token);
  if v_kakao is null then raise exception 'unauthorized' using errcode = '28000'; end if;
  select m.device_id into v_dev from members m where m.kakao_id = v_kakao;

  delete from attendance_winners where kakao_id = v_kakao;   -- 연락처가 들어있다. 반드시 먼저
  delete from attendance where kakao_id = v_kakao;
  delete from member_ics where kakao_id = v_kakao;
  delete from member_devices where kakao_id = v_kakao;       -- 계정↔기기 연결(찜 합치기) 2026-10-25
  delete from member_sessions where kakao_id = v_kakao;      -- 모든 기기 로그아웃
  update inquiries set kakao_id = null, nickname = null, device_id = null where kakao_id = v_kakao;   -- 2026-10-15 익명화
  get diagnostics v_q = row_count;
  delete from members where kakao_id = v_kakao;
  get diagnostics v_n = row_count;

  if p_wipe_device and coalesce(v_dev,'') <> '' then
    delete from wishes where device_id = v_dev;
    get diagnostics v_w = row_count;
    delete from push_subs where device_id = v_dev;
  end if;

  return json_build_object('ok', true, 'deleted', v_n, 'wishes_deleted', v_w, 'inquiries_anonymized', v_q);
end $function$;
