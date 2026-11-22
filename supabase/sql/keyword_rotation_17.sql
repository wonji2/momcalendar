-- ⚠️ 쿠팡 검색 API는 '시간당 호출 횟수' 제한이 있다 (3회 초과 시 파트너스 이용 제한).
-- 키워드 116개를 매번 전부 조회하면 걸린다 → 매 실행마다 오래된 것부터 N개만 돌려가며 조회.
alter table coupang_keywords add column if not exists last_seen timestamptz;
create index if not exists coupang_keywords_last_seen_idx on coupang_keywords (last_seen nulls first);
select count(*) as keywords from coupang_keywords where active=true;
