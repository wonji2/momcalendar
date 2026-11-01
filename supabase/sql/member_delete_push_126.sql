-- 회원 탈퇴 때 「기기 데이터도 지움」을 고르면 앱 알림 토큰(push_fcm·push_ios)도 지운다 (2026-10-27, 아직 적용 전 — 사장님 확인 뒤)
--   플레이 계정 삭제 정책 감사: 탈퇴 RPC 가 push_subs(웹)만 지우고 앱 토큰은 남겼다.
--   기기 데이터를 남기기로 하면(찜 유지) 그 찜의 오픈 알림을 계속 받아야 하므로 토큰도 남긴다.
CREATE OR REPLACE FUNCTION public.member_delete_account(p_token text, p_wipe_device boolean DEFAULT false)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare v_kakao text; v_dev text; v_n int; v_w int := 0; v_q int := 0;
begin
  v_kakao := _member_from_token(p_token);
  if v_kakao is null then raise exception 'unauthorized' using errcode = '28000'; end if;
  select m.device_id into v_dev from members m where m.kakao_id = v_kakao;

  delete from attendance_winners where kakao_id = v_kakao;   -- 연락처가 들어있다. 반드시 먼저
  delete from attendance where kakao_id = v_kakao;
  delete from member_ics where kakao_id = v_kakao;
  delete from member_devices where kakao_id = v_kakao;
  delete from member_sessions where kakao_id = v_kakao;
  update inquiries set kakao_id = null, nickname = null, device_id = null where kakao_id = v_kakao;
  get diagnostics v_q = row_count;
  delete from members where kakao_id = v_kakao;
  get diagnostics v_n = row_count;

  if p_wipe_device and coalesce(v_dev,'') <> '' then
    delete from wishes where device_id = v_dev;
    get diagnostics v_w = row_count;
    delete from push_subs where device_id = v_dev;
    delete from push_fcm where device_id = v_dev;
    delete from push_ios where device_id = v_dev;
  end if;

  return json_build_object('ok', true, 'deleted', v_n, 'wishes_deleted', v_w, 'inquiries_anonymized', v_q);
end $function$;
