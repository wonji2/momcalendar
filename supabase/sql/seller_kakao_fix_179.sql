-- 셀러 카카오 알림 보강 (2026-11-23 검증자 지적): 나중에 연결한 이용 중 셀러도 주소 4개가 든 안내를 한 번 받게
--   ① _seller_notify_text 'paid': 결제 확정 24시간 안이면 「결제 완료」, 그 뒤면 「이용 안내」(같은 기간·주소)
--   ② _seller_notify_enqueue_info(p_req): 연결할 때 Edge 가 부른다 — 결제 시각과 상관없이(이용 중이면) 같은 kind/ref 로 한 번(이미 갔으면 안 감)
--   ③ _seller_notify_revive(p_seller): 다시 연결하면 그 셀러의 최근 7일 not_connected·disconnected 실패 줄을 되살린다(오래된 단계는 claim 의 stale 검사가 닫는다)
-- 되돌리기: drop function public._seller_notify_enqueue_info(bigint), public._seller_notify_revive(bigint); _seller_notify_text 는 178 판 재실행.

create or replace function public._seller_notify_text(p_req bigint, p_kind text) returns text
language plpgsql stable security definer set search_path to 'public', 'pg_temp' as $fn$
declare r seller_plan_requests%rowtype; v_dow text;
begin
  select * into r from seller_plan_requests where id = p_req;
  if not found or r.end_date is null then return null; end if;
  if p_kind = 'paid' then
    return left('[맘캘린더] 이웃셀러 ' || case when r.paid_at > now() - interval '24 hours' then '결제 완료' else '이용 안내' end || chr(10)
      || '기간 ' || to_char(r.start_date, 'YYYY.MM.DD') || ' ~ ' || to_char(r.end_date, 'YYYY.MM.DD') || ' (' || r.months || '개월)' || chr(10)
      || '셀러 로그인 momcalendar.com/register.html' || chr(10)
      || '맘캘린더 momcalendar.com' || chr(10)
      || '카페 cafe.naver.com/momcal' || chr(10)
      || '인스타 instagram.com/momcal_', 200);
  end if;
  v_dow := (array['일','월','화','수','목','금','토'])[extract(dow from r.end_date)::int + 1];
  return left('[맘캘린더] 이웃셀러 기간 ' || (r.end_date - public._plan_today()) || '일 남음' || chr(10)
    || to_char(r.end_date, 'YYYY.MM.DD') || '(' || v_dow || ')까지 노출되고, 그 뒤엔 노출이 멈춰요' || chr(10)
    || '끝난 다음 날부터 셀러 페이지에서 다시 신청할 수 있어요(자리 한정)' || chr(10)
    || 'momcalendar.com/register.html', 200);
end $fn$;

create or replace function public._seller_notify_enqueue_info(p_req bigint) returns void
language plpgsql security definer set search_path to 'public', 'pg_temp' as $fn$
declare r seller_plan_requests%rowtype; v_body text;
begin
  select * into r from seller_plan_requests where id = p_req;
  if not found or r.status <> 'paid' or r.end_date is null or r.end_date < public._plan_today() then return; end if;
  if not exists (select 1 from seller_kakao where seller_id = r.seller_id) then return; end if;
  v_body := public._seller_notify_text(p_req, 'paid');
  if v_body is null then return; end if;
  insert into seller_notify_queue (seller_id, req_id, kind, ref, body) values (r.seller_id, p_req, 'paid', p_req || ':' || r.end_date, v_body)
  on conflict (kind, ref) do update set status = 'pending', tries = 0, err = null, claimed_at = null, body = excluded.body
    where seller_notify_queue.status = 'failed' and seller_notify_queue.err in ('not_connected', 'disconnected');
end $fn$;

create or replace function public._seller_notify_revive(p_seller bigint) returns int
language plpgsql security definer set search_path to 'public', 'pg_temp' as $fn$
declare v_n int;
begin
  update seller_notify_queue set status = 'pending', tries = 0, err = null, claimed_at = null
   where seller_id = p_seller and status = 'failed' and err in ('not_connected', 'disconnected') and created_at > now() - interval '7 days';
  get diagnostics v_n = row_count;
  return v_n;
end $fn$;

revoke all on function public._seller_notify_enqueue_info(bigint), public._seller_notify_revive(bigint) from public, anon, authenticated;
grant execute on function public._seller_notify_enqueue_info(bigint), public._seller_notify_revive(bigint) to service_role;
