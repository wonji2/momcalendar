-- 핫딜 출처 구분 (사장님 지시 2026-08-10)
-- "내가 주는 채팅 핫딜은 대부분 거의 찐 핫딜이니까 그대로 쓰고,
--  너가 파싱하는것만 두번 세번 재검토하고 올려서도 다시 검토하고"
--
-- manual=true  : 사장님이 카톡으로 주신 링크를 변환해 올린 것 → 할인율로 자동 판단하지 않는다
--                (품절처럼 명백한 것만 내린다)
-- manual=false : 크론이 스스로 주워온 것 → 매일 다시 확인하고 조건 벗어나면 내린다
alter table public.hotdeals add column if not exists manual boolean not null default false;

-- 지금까지 사장님 링크로 올린 것들 표시
--  · linkprice/naver 는 전부 수동 등록분이다
--  · toss 중에서는 크론(collect)이 아니라 내가 변환해 넣은 것들
update public.hotdeals set manual = true
where source in ('linkprice','naver')
   or id in (139,140,141,142,143,145,163,164);   -- 8/9~8/10 사장님 링크 변환분

select coalesce(source,'-') 소스, manual, count(*) n
from public.hotdeals where expires_at is null or expires_at > now()
group by 1,2 order by 1;
