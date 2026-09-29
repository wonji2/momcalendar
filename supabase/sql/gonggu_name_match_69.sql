-- 🔎 공구 상품명 동일성 판정 함수 (2026-09-29 신설)
--
-- 왜: 등록기(gen_insert_gonggu.mjs)의 `where not exists` 는 **문자열 포함 + levenshtein** 만 본다.
--     그래서 **어순·띄어쓰기 변형**을 통째로 놓친다. 2026-09-29 실측으로 7건이 재등록됐다:
--       「도깨비방망이 무선 올스텐 해리티지」 ↔ 「무선 올스텐 도깨비 방망이」   (어순)
--       「주니 실리콘 멀티컵」               ↔ 「주니 멀티컵」                (중간 낱말)
--       「사파 3in1 열제본 코팅 복합기」      ↔ 「사파 열제본 코팅 복합기」
--       「쿠민 2in1 듀얼 충전식 전동 그라인더」↔ 「쿠민 전동 그라인더 소금후추 2in1」
--       「에디슨 젓가락 텀블러 등 육아용품 골라담기」↔「에디슨 육아용품 모음전」
--       「제니튼치약 4차」                   ↔ 「제니튼 치약 & 가글」          (띄어쓰기)
--       「예일(YALE) 키즈 26FW 상하복」      ↔ 「예일키즈 상하복 점퍼 등 100종」
--     게이트(pending_check.sh)는 이것들을 「이미 있음」으로 셌는데 등록기는 새 행으로 넣었다.
--     **두 곳이 같은 판정식을 써야** 무인 회차가 돌 때마다 변형이 쌓이지 않는다.
--
-- 판정 두 갈래
--   ① 글자 다중집합 포함 — 짧은 쪽 글자가 긴 쪽에 다 있으면 같은 공구로 본다(어순·띄어쓰기 무관)
--   ② 낱말 겹침 비율    — 한쪽 낱말이 다른 쪽 이름에 부분문자열로 50% 이상 나타나고 2개 이상 겹치면 같다
--     ⚠ 「아기·유아·키즈·아이」 같은 흔한 낱말은 낱말 목록에서 뺀다 —
--        안 빼면 「무키 아기 자전거」와 「무키 아기 매트」가 같은 공구로 잡힌다.
--
-- 쓰는 곳: gen_insert_gonggu.mjs 의 not exists · scratchpad/_q_dup_*.sql
-- ⚠ anon 은 쓰지 않는다(관리자 SQL 전용) → grant 하지 않는다. 규칙 14 참조.

create or replace function public.gg_norm(p text)
returns text language sql immutable as $$
  select translate(
           lower(regexp_replace(
             regexp_replace(coalesce(p,''),
               '([0-9]+차|[0-9.]+세대|초특가|특가|모음전|기획전|국산|신상|NEW|new|한정|공구)', '', 'g'),
             '[[:space:]·•‧∙ㆍ._&/,!+()\[\]''"“”‘’`~-]', '', 'g')),
           '배게래매대새채애캐태패해', '베개레메데세체에케테페헤')
$$;

create or replace function public.gg_words(p text)
returns text[] language sql immutable as $$
  select coalesce(array_agg(w), '{}'::text[])
  from unnest(string_to_array(
         regexp_replace(
           regexp_replace(lower(coalesce(p,'')),
             '([0-9]+차|[0-9.]+세대|초특가|특가|모음전|기획전|국산|신상|new|한정|공구|아기|유아|키즈|아이|모음|세트)', ' ', 'g'),
           '[[:space:]·•‧∙ㆍ._&/,!+()\[\]''"“”‘’`~-]+', ' ', 'g'),
         ' ')) as w
  where length(w) >= 2
$$;

-- 글자 다중집합 포함: 짧은 쪽의 각 글자가 긴 쪽에 **개수까지** 들어 있는가
create or replace function public.gg_chars_within(p_short text, p_long text)
returns boolean language sql immutable as $$
  select not exists (
    select 1
    from (select c, count(*) n from unnest(string_to_array(p_short, null)) c group by c) s
    left join (select c, count(*) n from unnest(string_to_array(p_long, null)) c group by c) l using (c)
    where coalesce(l.n, 0) < s.n
  )
$$;

-- 낱말 겹침 비율(양방향 중 큰 값)과 겹친 개수
create or replace function public.gg_word_overlap(p_a text, p_b text)
returns numeric language sql immutable as $$
  with wa as (select unnest(public.gg_words(p_a)) w),
       wb as (select unnest(public.gg_words(p_b)) w),
       na as (select count(*) n from wa), nb as (select count(*) n from wb),
       hit_a as (select count(*) n from wa where public.gg_norm(p_b) like '%' || public.gg_norm(w) || '%'),
       hit_b as (select count(*) n from wb where public.gg_norm(p_a) like '%' || public.gg_norm(w) || '%')
  select case
    when (select n from na) = 0 or (select n from nb) = 0 then 0
    when greatest((select n from hit_a), (select n from hit_b)) < 2 then 0
    else greatest(
      (select n from hit_a)::numeric / (select n from na),
      (select n from hit_b)::numeric / (select n from nb))
  end
$$;

-- 🔑 같은 공구인가 — 등록기·중복검사가 **같이** 부르는 한 곳
create or replace function public.gg_same_product(p_a text, p_b text)
returns boolean language sql immutable as $$
  with n as (select public.gg_norm(p_a) a, public.gg_norm(p_b) b)
  select case
    when (select length(a) from n) = 0 or (select length(b) from n) = 0 then false
    when (select a = b from n) then true
    -- 포함 (기존 규칙)
    when (select length(b) >= 4 and a like '%' || b || '%' from n) then true
    when (select length(a) >= 4 and b like '%' || a || '%' from n) then true
    -- ① 글자 다중집합 포함 (어순·띄어쓰기 변형)
    when (select least(length(a), length(b)) >= 5 from n)
     and (select case when length(a) <= length(b)
                     then public.gg_chars_within(a, b)
                     else public.gg_chars_within(b, a) end from n) then true
    -- ② 낱말 겹침 50%+ (겹친 낱말 2개 이상일 때만)
    when public.gg_word_overlap(p_a, p_b) >= 0.5 then true
    else false
  end
$$;

-- 🔴 2026-09-29 추가: **오픈일이 정확히 같을 때는 2자 이름도 본다.**
--   내가 판촉 잔해를 떼며 이름을 「압스」(2자)로 줄였더니, 원래 이름
--   「뭐만 하면 다 인생템이래.. 진짜 압스」 가 같은 날짜에 새 행으로 다시 들어왔다(25947).
--   포함검사 문턱(4자)·같은날짜 문턱(3자)에 둘 다 안 걸렸다.
create or replace function public.gg_same_product_sameday(p_a text, p_b text)
returns boolean language sql immutable as $$
  with n as (select public.gg_norm(p_a) a, public.gg_norm(p_b) b)
  select public.gg_same_product(p_a, p_b)
      or (select length(a) >= 2 and length(b) >= 2
                 and (a like '%' || b || '%' or b like '%' || a || '%') from n)
$$;
