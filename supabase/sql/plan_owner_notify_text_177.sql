-- 이웃셀러 결제 카톡 문구에 「상품·기간·신규/연장」 넣기 (사장님 2026-11-20 「이웃셀러 누가 결제 기간 얼마 결제상품 뭐 이런거 카톡오게」)
-- 175 의 _owner_notify_text 를 바꾼다. 트리거·큐·크론은 그대로.
-- 되돌리기: plan_owner_notify_175.sql 의 _owner_notify_text 정의를 다시 실행.
create or replace function public._owner_notify_text(p_req bigint, p_kind text) returns text
language plpgsql stable security definer set search_path to 'public', 'pg_temp' as $fn$
declare r seller_plan_requests%rowtype; s sellers%rowtype; v_nm text; v_head text; v_tail text; v_new text; v_period text;
begin
  select * into r from seller_plan_requests where id = p_req;
  select * into s from sellers where id = r.seller_id;
  v_nm := coalesce(nullif(trim(s.seller_influencer), ''), nullif(trim(s.name), ''), r.login_insta);
  v_new := case when exists (select 1 from seller_plan_requests x where x.seller_id = r.seller_id and x.id <> r.id and x.paid_at is not null)
                then '연장' else '신규' end;
  v_period := case when r.start_date is not null and r.end_date is not null
                   then to_char(r.start_date, 'FMMM/FMDD') || ' ~ ' || to_char(r.end_date, 'FMMM/FMDD')
                   else '입금 확인되면 시작' end;
  v_head := case p_kind when 'paid' then '[맘캘린더] 이웃셀러 결제 완료' else '[맘캘린더] 이웃셀러 「입금했어요」 눌림' end;
  v_tail := case p_kind
    when 'paid' then '카페 [' || v_nm || '] 공구 일정 게시판 만들고 글쓰기 권한 주세요'
    else '입금 확인 필요 (관리자 > 이웃셀러)' end;
  return left(v_head || chr(10)
    || '셀러: ' || v_nm || ' @' || replace(coalesce(r.login_insta, ''), '@', '') || chr(10)
    || '상품: 이웃셀러 ' || r.months || '개월 (' || v_new || ')' || chr(10)
    || '금액: ' || to_char(r.amount, 'FM999,999,999') || '원 · '
    || case r.method when 'card' then '스룩 결제' when 'bank' then '계좌이체' else coalesce(r.method, '') end || chr(10)
    || '기간: ' || v_period || chr(10)
    || '카페 닉네임: ' || coalesce(nullif(trim(s.cafe_nick), ''), '아직 안 적음') || chr(10)
    || v_tail, 200);
end $fn$;
revoke all on function public._owner_notify_text(bigint, text) from public, anon, authenticated;
