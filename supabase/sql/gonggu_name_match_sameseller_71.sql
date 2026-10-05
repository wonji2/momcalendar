-- 🔴 브랜드 가드의 구멍 메우기 — **같은 셀러 + 같은 오픈일**은 브랜드를 안 본다 (2026-10-06, 검증자 지적)
--
-- 무슨 일이었나: 브랜드 가드(70번)를 넣은 직후 같은셀러·같은날 중복 2건이 그대로 들어왔다.
--   #28995 `dreamyaksa_` 「**염증에** 롱비다 커큐민 복합체」 ↔ #24972 「뉴트리션스탠다드 커큐민플라 롱비다 커큐민」 (둘 다 10-01)
--   #28997 `myo_yaksa`  「**먹고** 바르는 순수 비타민C 메가도스 + 아연」 ↔ #24936 「아루틴 순수 비타민C 3000 + 아연」 (둘 다 09-22)
--   #28995 는 **손님 화면에 두 장으로 떠 있었다**(즉시 내림).
--
-- 원인: 가드가 「앞 낱말 = 브랜드」라고 가정하는데, 이 둘은 앞 낱말이 **마케팅 머리말**이다
--   (`염증에`·`먹고`·`쉽고`·`면역`·`성분`·`첨가물`·`여행용`·`유기농`…). 브랜드가 아닌 말끼리 비교하니 늘 「다르다」가 된다.
--
-- 고침: 머리말 목록을 늘려 쫓아다니지 않는다(끝이 없다). 대신 **증거가 더 센 신호**를 쓴다 —
--   **같은 셀러가 같은 날 여는 공구는 하나다.** 그럴 때는 브랜드 가드를 끄고 옛 판정(69번 그대로)으로 본다.
--   ⚠ 「같은 날」만으로는 안 된다 — 다른 셀러끼리 같은 날 겹치는 쌍 10여 개가 **진짜 다른 브랜드**였다
--     (꼬비↔맥포머스↔레벨릭스 자석블럭 · 또비앙또↔주니 보냉파우치 · 안비려요↔더헬스 오메가 …).
--     그래서 **셀러까지 같을 때만** 끈다.
--
-- 쓰는 곳: scratchpad/gen_insert_gonggu.mjs 의 not exists 에 갈래 하나를 더 붙였다.
-- 회귀 시험표: scratchpad/_q_namematch_cases.sql (같은셀러 갈래 포함)

create or replace function public.gg_same_product_nobrand(p_a text, p_b text)
returns boolean language sql immutable as $$
  with n as (select public.gg_norm(p_a) a, public.gg_norm(p_b) b)
  select case
    when (select length(a) from n) = 0 or (select length(b) from n) = 0 then false
    when (select a = b from n) then true
    when (select length(b) >= 4 and a like '%' || b || '%' from n) then true
    when (select length(a) >= 4 and b like '%' || a || '%' from n) then true
    when (select least(length(a), length(b)) >= 5 from n)
     and (select case when length(a) <= length(b)
                     then public.gg_chars_within(a, b)
                     else public.gg_chars_within(b, a) end from n) then true
    -- 🔑 여기만 다르다 — 브랜드 가드를 보지 않는다 (69번 판정 그대로)
    when public.gg_word_overlap(p_a, p_b) >= 0.5 then true
    else false
  end
$$;

-- 확인 — 두 유출 쌍이 이제 true 로 잡히는가, 그리고 **다른 셀러** 쌍은 여전히 false 인가
select '같은셀러 유출쌍1' as k,
       public.gg_same_product_nobrand('염증에 롱비다 커큐민 복합체', '뉴트리션스탠다드 커큐민플라 롱비다 커큐민') as 잡히나
union all select '같은셀러 유출쌍2',
       public.gg_same_product_nobrand('먹고 바르는 순수 비타민C 메가도스 + 아연', '아루틴 순수 비타민C 3000 + 아연')
union all select '같은셀러 쉽고-닥터라인',
       public.gg_same_product_nobrand('쉽고 빠르게 비타민D 스프레이', '닥터라인 비타민DK 스프레이 & 데이타민 비타민D')
union all select '같은셀러 뉴욕-스웰',
       public.gg_same_product_nobrand('뉴욕 프리미엄 텀블러', '스웰 프리미엄 친환경 텀블러')
union all select '[다른셀러] 꼬비-맥포머스 (false 여야 함)',
       public.gg_same_product('꼬비 미니 자석 블럭', '맥포머스 자석블럭')
union all select '[다른셀러] 우월애-향유 (false 여야 함)',
       public.gg_same_product('우월애 국산 참기름 · 들기름', '향유 국산 유기농 아기 참기름&생들기름');
