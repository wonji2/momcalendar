create or replace function public.hotdeals_fill_mall() returns trigger language plpgsql as $$
begin
  -- 판매처 칸이 비면 카페 글 제목이 ") 상품명" 으로 나가고 카드에 판매처가 안 뜬다 (2026-09-08 사장님 지적). 링크로 채운다.
  if new.mall is null or btrim(new.mall) = '' then
    new.mall := case
      when new.link ilike '%coupang.com%' then '쿠팡'
      when new.link ilike '%toss.im%' or new.link ilike '%toss.shopping%' then '토스쇼핑'
      when new.link ilike '%m=gmarket%' or new.link ilike '%gmarket.co.kr%' then '지마켓'
      when new.link ilike '%m=auction%' or new.link ilike '%auction.co.kr%' then '옥션'
      when new.link ilike '%m=11st%' or new.link ilike '%11st.co.kr%' then '11번가'
      when new.link ilike '%m=boribori%' then '보리보리'
      when new.link ilike '%ohou.se%' or new.link ilike '%ozip.me%' then '오늘의집'
      when new.link ilike '%naver.%' then '네이버'
      else new.mall end;
  end if;
  return new;
end $$;
drop trigger if exists trg_hotdeals_fill_mall on public.hotdeals;
create trigger trg_hotdeals_fill_mall before insert or update of mall, link on public.hotdeals
  for each row execute function public.hotdeals_fill_mall();
update public.hotdeals set mall = mall where mall is null or btrim(mall) = '';
select count(*) filter (where mall is null or btrim(mall)='') as still_empty, count(*) filter (where mall='쿠팡') as coupang from public.hotdeals;