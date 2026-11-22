-- 핫딜 보관 규칙 (사장님 지시 2026-10-01)
--   "핫딜도 14일만 지나면 사이트에서 내리고 오래된 순으로 지워서 용량 없애 보통 하루면 딜 끝나"
--
-- 🔴 고치는 구멍: 기존 `hotdeal_auto_expire` 는 `coalesce(deal_day, created_at::date)` 를 봤다.
--    그런데 `deal_day` 는 딜을 되살릴 때 오늘로 밀어준다(지난 세션들의 수기 update·evergreen 크론).
--    그래서 **9/1 에 등록한 행이 10/1 에도 「오늘 뜬 핫딜」로 남아** 영원히 안 내려갔다
--    (닥터노아 id 555 · 블랑키즐 id 554 — 사장님이 카드에서 보고 지적하셨다).
--    → 기준을 **created_at 하나로** 바꾼다. 「올린 날로부터 14일」이다.

create or replace function public.hotdeal_auto_expire(p_days int default 14)
returns int language plpgsql security definer as $$
declare n integer;
begin
  update hotdeals
     set expires_at = now()
   where (expires_at is null or expires_at > now())
     and coalesce(pin_random, false) = false
     -- 🔑 deal_day 를 보지 않는다 — 되살리며 밀어준 날짜로 만료를 피해 가던 구멍이었다
     and created_at < now() - (p_days || ' days')::interval;
  get diagnostics n = row_count;
  if n > 0 then
    insert into health_alerts(kind, detail)
    values ('핫딜자동만료', n || '건을 등록 후 ' || p_days || '일 경과로 내렸다');
  end if;
  return n;
end $$;

-- 오래된 순으로 지운다 (용량). 기본 60일 — 만료된 것만, 고정딜은 남긴다.
--   🔑 지우기 전에 **가격 이력은 price_history 에 따로 쌓여 있다** → 딜 행을 지워도 가격 기록은 남는다.
create or replace function public.hotdeal_purge_old(p_days int default 60)
returns int language plpgsql security definer as $$
declare n integer;
begin
  delete from hotdeals
   where coalesce(pin_random, false) = false
     and expires_at is not null and expires_at < now()
     and created_at < now() - (p_days || ' days')::interval;
  get diagnostics n = row_count;
  if n > 0 then
    insert into health_alerts(kind, detail)
    values ('핫딜정리', n || '건을 등록 후 ' || p_days || '일 경과로 지웠다');
  end if;
  return n;
end $$;

grant execute on function public.hotdeal_auto_expire(int) to service_role;
grant execute on function public.hotdeal_purge_old(int) to service_role;
