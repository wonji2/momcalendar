-- 핫딜 자동 만료 (사장님 지시 2026-09-01)
--
-- 왜: 노출 235건 중 229건(97%)에 expires_at 이 없어 **영원히 안 내려갔다.**
--     계란(id 42)이 9일간 옛 가격으로 남아 있던 것도 결국 이것 때문 —
--     끝난 딜에 끝나는 날짜가 없으니 가격만 틀린 채 계속 보였다.
--     가격을 쫓아다니는 것(추적기)은 증상 치료고, 이게 근본이다.
--
-- 규칙: 등록 후 14일이 지나면 자동으로 내린다.
--       · 상시딜(pin_random=true)은 제외 — 계란처럼 기간이 없는 카드
--       · deal_day 가 비어 있으면 created_at 으로 대신 센다(현재 43건이 그렇다)
--       · 삭제가 아니라 만료다 → 되살리려면 expires_at 을 null 로 되돌리면 된다
create or replace function public.hotdeal_auto_expire(p_days integer default 14)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare n integer;
begin
  update hotdeals
     set expires_at = now()
   where (expires_at is null or expires_at > now())
     and coalesce(pin_random, false) = false
     and (current_date - coalesce(deal_day, created_at::date)) > p_days;
  get diagnostics n = row_count;
  if n > 0 then
    insert into health_alerts(kind, detail)
    values ('핫딜자동만료', n || '건을 ' || p_days || '일 경과로 내렸다');
  end if;
  return n;
end $$;

revoke execute on function public.hotdeal_auto_expire(integer) from public, anon, authenticated;
