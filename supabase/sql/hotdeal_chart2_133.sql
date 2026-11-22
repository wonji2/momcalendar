-- 핫딜 가격 추이 차트 기간 확장 (사장님 2026-11-02 「1·2·3·6개월, 최대 6개월 캡」)
-- 기존 hotdeal_chart(pid)=최근 90일 은 그대로 둔다(옛 화면·캐시 호환). 새 함수는 days 를 받되 7~180 일로 자른다.
-- 180일 = price_history 를 지우는 기존 크론(coupang_cron_15: day < today-180)과 같은 한도 → DB 용량 한도(규칙 0-L)와 맞는다.
create or replace function hotdeal_chart2(pid text, days int default 90)
returns table(day date, price integer)
language sql
stable
security definer
set search_path = public
as $$
  select ph.day, ph.price
  from price_history ph
  where ph.product_id = pid
    and ph.day >= (now() at time zone 'Asia/Seoul')::date - least(greatest(coalesce(days, 90), 7), 180)
    -- 이미 핫딜 게시판에 올라간 상품만 (임의 상품 이력 캐가기 방지) — hotdeal_chart 와 같은 조건
    and exists (select 1 from hotdeals h where h.product_id = pid)
  order by ph.day;
$$;
revoke all on function hotdeal_chart2(text, int) from public;
grant execute on function hotdeal_chart2(text, int) to anon, authenticated;
select 'ok' as result;
