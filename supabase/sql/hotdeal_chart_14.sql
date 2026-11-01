-- 핫딜 카드 → "왜 핫딜인지" 근거 그래프용 공개 RPC
-- price_history 는 RLS로 잠겨 있으므로, 이미 노출 중인 핫딜 상품에 한해서만 이력을 열어준다.

create or replace function hotdeal_chart(pid text)
returns table(day date, price integer)
language sql
security definer
set search_path = public
as $$
  select ph.day, ph.price
  from price_history ph
  where ph.product_id = pid
    and ph.day >= (now() at time zone 'Asia/Seoul')::date - 90
    -- 이미 핫딜 게시판에 올라간 상품만 (임의 상품 이력 캐가기 방지)
    and exists (select 1 from hotdeals h where h.product_id = pid)
  order by ph.day;
$$;

revoke all on function hotdeal_chart(text) from public;
grant execute on function hotdeal_chart(text) to anon, authenticated;

select 'ok' as result;
