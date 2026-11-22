-- 핫딜 1단계-b (131 뒤) — 단위가 트리거 · 기존 행 채우기 · 뱃지 채우기 · 동적 키워드 크론 (2026-11-01, 회귀 300건 검수 뒤: 읽힘 130/300 · 오판 사례 7종 고침)
--   · 트리거 zz_hotdeals_unit: title/price 가 바뀔 때만(BEFORE INSERT OR UPDATE OF title, price). 기존 trg_hotdeals_fill_mall 뒤에 돈다(이름 zz_)
--   · 뱃지: is_lowest → lowest · 평균 대비 25%↑ → super · 10%↑ → sale (쿠팡 함수 판정값 그대로, 기준 안 바꿈) — 가격이력 근거가 있는 출처(coupang·linkprice)만
--   · 크론 hotdeal-watch-terms: 매일 KST 07:30 (쿠팡 회차 08:00 전) refresh_hotdeal_watch_terms()
-- 되돌리기: drop trigger zz_hotdeals_unit on hotdeals; select cron.unschedule('hotdeal-watch-terms'); update hotdeals set badge=null, unit_price=null, unit_label=null;

create or replace function public.hotdeals_unit_fill() returns trigger language plpgsql as $$
declare u record;
begin
  select * into u from public.hotdeal_unit(new.title, new.price);
  new.unit_price := u.unit_price; new.unit_label := u.unit_label;
  return new;
end $$;
drop trigger if exists zz_hotdeals_unit on public.hotdeals;
create trigger zz_hotdeals_unit before insert or update of title, price on public.hotdeals
  for each row execute function public.hotdeals_unit_fill();

-- 기존 행: 살아 있는 것(만료 안 됨 또는 최근 7일)만 채운다
update public.hotdeals h set unit_price = (public.hotdeal_unit(h.title, h.price)).unit_price, unit_label = (public.hotdeal_unit(h.title, h.price)).unit_label
 where (h.expires_at is null or h.expires_at > now() or h.deal_day >= current_date - 7) and h.unit_price is null;

update public.hotdeals set badge = case
    when is_lowest then 'lowest'
    when coalesce(discount_rate,0) >= 25 then 'super'
    when coalesce(discount_rate,0) >= 10 then 'sale' end
 where badge is null and source in ('coupang','linkprice') and price_before is not null
   and (expires_at is null or expires_at > now() or deal_day >= current_date - 7);

select cron.unschedule(jobid) from cron.job where jobname = 'hotdeal-watch-terms';
select cron.schedule('hotdeal-watch-terms', '30 22 * * *', $$ select public.refresh_hotdeal_watch_terms(); $$);
