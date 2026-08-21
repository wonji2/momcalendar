-- 셀러 인포크 슬러그 보관 (2026-08-20)
--   인포크 슬러그는 인스타 핸들과 다른 경우가 24% 다(실측 131명 중 32명).
--   건이맘 geone.mom → geonmarket · 이현맘은 핸들과 같음.
--   매일 도는 배너 갱신이 슬러그를 추측하느라 헛돌지 않게 DB에 적어 둔다.
alter table public.sellers add column if not exists inpock_slug text;
comment on column public.sellers.inpock_slug is
  '인포크 슬러그(핸들과 다를 수 있음). 비어 있으면 insta 를 슬러그로 시도한다.';
