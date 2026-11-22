-- 세일일정 (공구 캘린더와 별개) — 브랜드 공식 세일·행사 일정. 2026-10-13 사장님 "세일일정 B안"
-- 손님(anon)은 approved=true 인 행만 읽는다. 쓰기는 관리자(서비스 롤)만.
create table if not exists public.sale_events (
  id          bigserial primary key,
  brand       text not null,                 -- 표시 이름(올리브영)
  slug        text not null,                 -- 로고 파일명 sale/logos/<slug>.png
  title       text not null,                 -- 행사명
  tag         text not null default '',      -- 블프·시즌오프 등 꼬리표
  start_date  text not null,                 -- 'YYYY-MM-DD' (TEXT — gonggu 와 같은 규칙)
  end_date    text not null default '',      -- 빈 값 = 종료일 미정
  url         text not null,                 -- 브랜드 공식 홈/행사 페이지
  note        text not null default '',
  approved    boolean not null default true,
  created_at  timestamptz not null default now()
);
create unique index if not exists sale_events_uq on public.sale_events (brand, title, start_date);
alter table public.sale_events enable row level security;
drop policy if exists sale_events_read on public.sale_events;
create policy sale_events_read on public.sale_events for select to anon, authenticated using (approved);
grant select on public.sale_events to anon, authenticated;

insert into public.sale_events (brand, slug, title, tag, start_date, end_date, url) values
 ('에이블리','ably','가을 메가 세일','','2026-10-07','2026-10-14','https://m.a-bly.com/'),
 ('자라','zara','미드시즌 세일','시즌오프','2026-10-06','','https://www.zara.com/kr/'),
 ('탑텐','topten','텐텐데이','','2026-10-17','2026-11-02','https://www.topten10mall.com/'),
 ('무신사','musinsa','무신사 감사세일','','2026-10-21','2026-10-27','https://www.musinsa.com/'),
 ('올리브영','oliveyoung','올영데이','','2026-10-25','2026-10-27','https://www.oliveyoung.co.kr/'),
 ('무신사','musinsa','겨울 블랙프라이데이','블프','2026-11-16','2026-11-26','https://www.musinsa.com/'),
 ('지그재그','zigzag','겨울 블랙프라이데이','블프','2026-11-17','2026-12-01','https://zigzag.kr/'),
 ('에이블리','ably','겨울 블랙프라이데이','블프','2026-11-17','2026-12-03','https://m.a-bly.com/'),
 ('유니클로','uniqlo','겨울 감사제','','2026-11-20','2026-11-26','https://www.uniqlo.com/kr/ko/'),
 ('자라','zara','블랙프라이데이','블프','2026-11-27','2026-12-01','https://www.zara.com/kr/'),
 ('지그재그','zigzag','시즌오프','시즌오프','2026-12-01','2026-12-07','https://zigzag.kr/'),
 ('올리브영','oliveyoung','겨울 빅세일','','2026-12-01','2026-12-07','https://www.oliveyoung.co.kr/'),
 ('에잇세컨즈','8seconds','겨울 세일','','2026-12-11','2027-01-07','https://www.ssfshop.com/8seconds/main'),
 ('자라','zara','시즌오프 세일','시즌오프','2026-12-16','','https://www.zara.com/kr/'),
 ('유니클로','uniqlo','연말 결산 세일','','2026-12-18','2026-12-31','https://www.uniqlo.com/kr/ko/')
on conflict do nothing;
select count(*) as n from public.sale_events;
