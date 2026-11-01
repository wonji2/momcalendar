-- 🔎 상품명 동일성 — **브랜드 낱말 가드** 추가 (2026-10-06)
--
-- 왜: 낱말 겹침 갈래(②)가 **브랜드를 안 본다.** 흔한 품목 낱말 2개만 겹치면 같은 공구가 된다.
--   실측(무인 회차가 사흘째 등록 0건이던 원인):
--     「우월애 국산 참기름 · 들기름」(soojung_lee_, 10/03)
--        ↔ 「향유 국산 유기농 아기 참기름&생들기름」(#27023, 10/01)   → 참기름·들기름 2/3 = 0.67 → 같다(오판)
--        ↔ 「씨드밀 찬찬히방앗간 저온압착참기름&생들기름」(#27461)      → 같은 이유
--   세 개가 **서로 다른 브랜드의 다른 공구**다. 이것 때문에 정상 신규가 조용히 등록에서 빠졌다.
--
-- 고침: 낱말 겹침 갈래에만 가드를 건다 —
--   **두 이름의 앞 낱말(브랜드) 중 하나라도 상대 이름 안에 있어야** 낱말 겹침으로 같다고 본다.
--   한쪽만 맞아도 통과시킨다(표기가 붙었다 떨어졌다 한다 — 「예일(YALE) 키즈」 ↔ 「예일키즈」).
--
-- ⚠ 포함검사·글자 다중집합(갈래 ①)에는 가드를 걸지 않는다. 그쪽은 이미 글자가 통째로 겹쳐야 해서
--   브랜드가 다르면 애초에 안 걸린다. 가드를 거기까지 걸면 2026-09-29 에 잡은 어순변형 7건이 되살아난다.
--
-- 원본: supabase/sql/gonggu_name_match_69.sql (gg_norm·gg_words·gg_chars_within·gg_word_overlap 은 그대로 쓴다)

create extension if not exists fuzzystrmatch;   -- levenshtein (오타 브랜드 구제에 쓴다)

-- 앞 낱말(브랜드 후보). 흔한 수식어(아기·키즈·모음·국산…)를 뺀 뒤 **맨 앞** 낱말.
-- ⚠ `(gg_words(p))[1]` 로 쓰면 안 된다 — gg_words 는 `array_agg(unnest)` 라 **순서를 보장하지 않는다**
--   (지금까지는 겹침 개수만 세어서 순서가 상관없었다). 여기서는 맨 앞이어야 하니 ordinality 로 직접 센다.
--   ⚠ 아래 두 정규식은 gg_words 와 **글자 하나까지 같아야 한다** — 어긋나면 브랜드 낱말이 달라진다.
create or replace function public.gg_head_word(p text)
returns text language sql immutable as $$
  select coalesce((
    select w from unnest(string_to_array(
             regexp_replace(
               regexp_replace(lower(coalesce(p,'')),
                 '([0-9]+차|[0-9.]+세대|초특가|특가|모음전|기획전|국산|신상|new|한정|공구|아기|유아|키즈|아이|모음|세트)', ' ', 'g'),
               '[[:space:]·•‧∙ㆍ._&/,!+()\[\]''"“”‘’`~-]+', ' ', 'g'),
             ' ')) with ordinality as t(w, ord)
     where length(w) >= 2 order by ord limit 1), '')
$$;

-- 브랜드가 서로를 안 부르는가 — 둘 다 아니면 낱말 겹침만으로는 같다고 보지 않는다.
-- ⚠ 아래 「가드를 안 거는」 네 경우는 **실제 쌍을 눈으로 보고** 넣은 것이다(scratchpad/brandguard_flips.md).
--   가드가 셀 수 없는 자리에서는 옛 판정을 그대로 둔다 — 넓히는 쪽이 아니라 **좁히는 쪽**이 안전하다.
create or replace function public.gg_brand_clash(p_a text, p_b text)
returns boolean language sql immutable as $$
  with h as (select public.gg_norm(public.gg_head_word(p_a)) ha,
                    public.gg_norm(public.gg_head_word(p_b)) hb,
                    public.gg_norm(p_a) na, public.gg_norm(p_b) nb,
                    coalesce(array_length(public.gg_words(p_a), 1), 0) ca,
                    coalesce(array_length(public.gg_words(p_b), 1), 0) cb)
  select case
    -- ⓪ 앞 낱말을 못 뽑으면 가드를 걸지 않는다
    when (select length(ha) = 0 or length(hb) = 0 from h) then false
    -- ① **한 낱말짜리 이름**은 브랜드와 품목이 안 갈린다 — 가드를 걸지 않는다
    --    실측: 「미피병풍」 ↔ 「에이든 미피 아기병풍」(같은 상품인데 앞낱말이 미피병풍 vs 에이든)
    when (select ca <= 1 or cb <= 1 from h) then false
    -- ② 앞 낱말이 **숫자로 시작**하면 브랜드가 아니다 — 가드를 걸지 않는다
    --    실측: 「3일간 팝업」 ↔ 「테라큐민 프라임 & 부스터 3일 팝업」(같은 셀러·같은 날)
    when (select ha ~ '^[0-9]' or hb ~ '^[0-9]' from h) then false
    -- ③ 브랜드가 서로를 부르면 같은 브랜드다
    when (select nb like '%' || ha || '%' from h) then false
    when (select na like '%' || hb || '%' from h) then false
    -- ④ **한 글자 차이는 오타다** — 가드를 걸지 않는다
    --    실측: 「쁘띠엘르 순면 방수패드」 ↔ 「쁘리엘르 순면 방수패드」(같은 상품, 표기 오타)
    when (select levenshtein(ha, hb) <= greatest(1, least(length(ha), length(hb)) / 4) from h) then false
    else true
  end
$$;

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
    -- ② 낱말 겹침 50%+ (겹친 낱말 2개 이상) — 🔴 2026-10-06: 브랜드가 서로 다르면 여기서 멈춘다
    when public.gg_word_overlap(p_a, p_b) >= 0.5
     and not public.gg_brand_clash(p_a, p_b) then true
    else false
  end
$$;
