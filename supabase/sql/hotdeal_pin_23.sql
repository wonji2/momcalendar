-- 상시 노출 핫딜(직접 고른 제휴 상품)을 매일 다른 자리에 섞어 넣기 위한 표시
alter table hotdeals add column if not exists pin_random boolean default false;

-- 네이버 쇼핑커넥트 · 유정란 (사장님이 직접 고른 상시 핫딜)
insert into hotdeals (title, link, major, minor, price, price_before, discount_rate,
                      source, pin_random, mall, deal_day)
select '[농할쿠폰] 국내산 난각번호1번 유정란 무항생제 자연방목 계란 20구',
       'https://naver.me/51ucfPnE', '식품', '신선식품',
       9500, 13900, 31, 'naver', true, '네이버', null
where not exists (select 1 from hotdeals where link = 'https://naver.me/51ucfPnE');

select id, left(title,30) as title, price, discount_rate, source, pin_random
from hotdeals where source='naver';
