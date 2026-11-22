-- 커뮤니티 탭 본문 2줄·사진 (사장님 2026-10-24 「앱에선 본문도 두줄 정도 보이게 해놨는데 … 앱 짜놓은대로 테스트에도 올려」)
--  · 10-23 판은 「본문·사진은 등급이 막아 못 읽는다」고 적었지만 틀렸다 — 카페 새 목록 API(cafe-boardlist-api v1)가
--    로그인 없이 summary(본문 앞부분)를 주고, viewType=I 로 부르면 representImage(대표 사진)를 준다(2026-10-24 실측 50건 중 42건 summary).
--  · 채우는 쪽: Edge Function cafe-feed(v2) · 읽는 쪽: test.html 커뮤니티 탭(anon select 는 90번에서 이미 열림)
--  · 한도(0-L): 글당 summary 최대 200자 + 사진 주소 1개 → 12,000행 상한에서 약 +3MB
alter table public.community_posts add column if not exists summary text;
alter table public.community_posts add column if not exists image_url text;
notify pgrst, 'reload schema';
select count(*) filter (where column_name in ('summary','image_url')) as new_cols
from information_schema.columns where table_schema='public' and table_name='community_posts';
