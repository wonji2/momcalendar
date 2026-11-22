-- 홈 관리 탭 정렬 고정용 칸 (사장님 2026-11-04 「모든 항목 정렬순서 되게」)
--   null = 지금처럼(랜덤·날짜순), 숫자 = 그 순서대로 앞에 고정. 관리자 ▲▼ 가 1,2,3… 으로 채운다.
--   gonggu.top_order  : 상위노출 보라 카드(맘캘린더·이웃셀러 공구)
--   sellers.pin_order : 이웃셀러 동그라미
--   banners.pin_order : 이웃셀러 배너(type=seller). 메인 배너(보증공구·스포)는 기존 sort_order 를 쓴다
-- 칸만 더하는 변경이라 기존 화면·조회에 영향 없다. 손님(anon)이 읽는 칸은 명시 grant 필요(2026-09-28 보안 잠금).
alter table public.gonggu  add column if not exists top_order int;
alter table public.sellers add column if not exists pin_order int;
alter table public.banners add column if not exists pin_order int;
grant select (top_order)  on public.gonggu  to anon;
grant select (pin_order)  on public.sellers to anon;
create or replace view public.banners_public as
 select id, type, title, subtitle, cta,
        case when (link_open_at is null) or (link_open_at <= now()) then link else null::text end as link,
        bg, img_url, sort_order, active, created_at, img_position, img_size, link_open_at, show_from, show_until, stage,
        pin_order
   from public.banners
  where active = true;
