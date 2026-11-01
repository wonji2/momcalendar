alter table public.gonggu add column if not exists name_ns text generated always as (replace(lower(name), ' ', '')) stored;
comment on column public.gonggu.name_ns is '상품명에서 공백을 뺀 소문자 — 챗봇 붙여쓰기 검색용 (2026-09-08). 손님은 "뮴키즈오메가3" 라 치고 DB 는 "말랑구미 뮴키즈 오메가3" 다';
