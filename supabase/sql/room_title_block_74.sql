-- 펜션 객실 핫딜 차단 (사장님 지시 2026-09-30 "펜션 핫딜은 뭐야 내려")
--
-- 무슨 일이었나: 09-30 08:00 쿠팡 회차가 객실 6건을 등록했다 — `101호` · `102호(복층/스위밍&제트스파/2베드)` ·
--   `프라임A(온돌/더블)` · `B동-102(리버뷰…)` · `E1키즈풀빌라원룸` · `당일권 (무박권,1박아님,숯필수구매)`.
--   **어느 펜션인지가 제목에 없어** 손님이 뭘 사는지 알 수 없는데, 할인율이 높아 오늘 카드 9칸 중 6칸을 차지했다.
-- 원인: `coupang_keywords` 에 숙박 낱말 5개(가족호텔·키즈펜션·풀빌라·리조트·글램핑)가 활성이었다.
--   쿠팡은 펜션을 **객실 하나하나를 상품으로** 판다 → 검색 결과 제목이 객실 번호가 된다.
-- 막는 방법 두 겹:
--   ① 원인 차단 — 숙박 낱말 5개를 끈다(체험·티켓 낱말은 이름이 멀쩡해서 그대로 둔다)
--   ② 그물 — brand_block 패턴으로 객실형 제목 자체를 막는다. 트리거(trg_brand_block_title)가 hotdeals·gonggu
--      **등록 경로 전부**에 걸려 있어 크론·카페·손등록 어디로 들어와도 막힌다.
-- ⚠ 기존 데이터 회귀시험 결과 **오탐 0건**(핫딜 전건·공구 11,000여건에 걸어봄). 패턴을 넓히면 반드시 다시 재볼 것.

-- ① 숙박 낱말 끄기
update coupang_keywords set active = false
 where active and major = '여행' and minor = '호텔/숙소';

-- ② 객실형 제목 차단 패턴 (brand_blocked 는 POSIX 정규식 ~* 로 본다)
insert into brand_block(pattern, reason) values
  ('^[0-9]{1,4}호([ ()]|$)',                          '객실 제목(101호·102호(복층…)) — 어느 펜션인지 없어 손님이 못 알아본다 (2026-09-30)'),
  ('^[A-Z]?[0-9]*동[ ]?-[ ]?[0-9]+',                  '객실 제목(B동-102) — 같은 이유 (2026-09-30)'),
  ('무박권|1박아님',                                    '숙박권 제목(당일권 무박권,1박아님) — 같은 이유 (2026-09-30)'),
  ('(풀빌라|펜션|글램핑|리조트)[가-힣A-Z0-9]*원룸',           '객실 제목(E1키즈풀빌라원룸) — 같은 이유 (2026-09-30)'),
  ('^(프라임|디럭스|스탠다드|스탠더드|스위트)[A-Z0-9]{0,3}[ ]?\(', '객실 제목(프라임A(온돌/더블)) — 같은 이유 (2026-09-30)')
on conflict do nothing;

-- ③ 이미 올라와 있는 같은 유형 전부 내린다(삭제 아님 — expires_at 만. 되돌리려면 null)
update hotdeals set expires_at = now()
 where (expires_at is null or expires_at > now())
   and brand_blocked(title);

select (select count(*) from coupang_keywords where active) 남은_활성키워드,
       (select count(*) from brand_block) 차단패턴,
       (select count(*) from hotdeals where (pin_random is true or expires_at is null or expires_at > now()) and brand_blocked(title)) 남은_객실핫딜,
       (select count(*) from hotdeals where pin_random is true or expires_at is null or expires_at > now()) 노출_핫딜;
