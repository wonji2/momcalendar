-- 추적 요청이 tacaIds 로 물은 건지 tacaItemIds 로 물은 건지 기록한다 (2026-08-10)
--
-- 왜: 응답을 수거할 때 tacaId·tacaItemId 를 둘 다 키로 넣었더니, 서로 다른 상품의
--     번호가 겹쳐 엉뚱한 가격이 붙었다. 실측에서 67% 짜리가 3% 로, 59% 가 0% 로 잘못 판정돼
--     멀쩡한 핫딜이 내려갔다. → 물어본 종류에 맞는 키로만 매핑한다.
alter table public.toss_track_pending add column if not exists id_kind text;
