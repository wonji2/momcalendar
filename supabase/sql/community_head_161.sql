-- 161 — 커뮤니티 글에 카페 말머리(head) 칸 (사장님 2026-11-18 「대분류 안에 카페 말머리 같은 거 보면 소분류도 있을 텐데 시 정도 분류」)
--   지역 수다방(서울·경기 …) 글의 말머리 = 시·구 이름. 수집기 cafe-feed 가 목록 API 의 headName 을 그대로 담는다(없으면 null).
--   한도: 글 1건당 글자 몇 개 — 무시할 크기. 되돌리기: alter table public.community_posts drop column head;
alter table public.community_posts add column if not exists head text;
notify pgrst, 'reload schema';
