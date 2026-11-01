-- 🔴 규칙 0-M 이 **내 상품명이 그대로 들어 있는 공구**를 놓쳤다 (사장님 지적 2026-10-06)
--
--   *"나도 요거쪽쪽 파는게 밀크하우스 요거트&치즈 이거야 똑같은거야"*
--
-- 실측: 내 「요거쪽쪽 요거트」(#27811, 10/12~10/14) 창 안에
--   `ah_yamyam_` #25615 「밀크하우스 **요거쪽쪽**&치즈」(10/14~10/16)가 **노출중**이었다.
--   이름에 내 상품명 「요거쪽쪽」이 글자 그대로 들어 있는데도 안 걸렸다.
--
-- 왜: `gg_same_product` 의 **브랜드 가드**가 막았다. 내 앞 낱말은 「요거쪽쪽」, 상대는 「밀크하우스」라
--   「다른 브랜드」로 판정된다. 포함검사도 양쪽 다 서로를 품지 않아 통과 못 한다
--   (「요거쪽쪽요거트」 ⊄ 「밀크하우스요거쪽쪽치즈」).
--
-- 고침: 0-M 에 갈래 하나를 더 둔다 — **상대 이름이 내 앞 낱말(브랜드)을 품으면 같은 상품으로 본다.**
--   사장님이 마인크래프트 때 하신 말씀과 같은 기준이다:
--     *"똑같이 마인크래프트라는 이름 들어간 상품만 2주내로 내리면 됨"*
--   그래서 「밀크하우스 요거쪽쪽&치즈」는 걸리고, 「밀키요 요거트」·「프레벨롱 요거트」처럼
--   **다른 브랜드의 같은 품목**은 그대로 둔다(자석블럭 때와 같은 판단).
--
-- ⚠ 내 앞 낱말이 2글자 미만이면 쓰지 않는다 — 「김」·「물」 같은 말이 아무 데나 걸린다.

create or replace function public.gg_in_own_window(p_name text, p_insta text, p_open text)
returns bigint language sql stable as $$
  select m.id
    from public.gonggu m
   where lower(coalesce(m.insta,'')) = 'momcal_'
     and m.approved
     and lower(coalesce(p_insta,'')) is distinct from 'momcal_'
     and m.open_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
     and (coalesce(m.end_date,'') = '' or m.end_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
     and coalesce(p_open,'') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
     and p_open::date between m.open_date::date - 14
                          and coalesce(nullif(m.end_date,'')::date, m.open_date::date + 3)
     and (
       -- ① 내 **앞 낱말(브랜드·상품명)** 이 상대 이름에 글자 그대로 들어 있으면 같은 상품이다
       --    「요거쪽쪽」 ⊂ 「밀크하우스 요거쪽쪽&치즈」 · 「마인크래프트」 ⊂ 「맥씽크 마인크래프트 자석블럭」
       (   length(public.gg_norm(public.gg_head_word(m.name))) >= 2
       and public.gg_norm(p_name) like '%' || public.gg_norm(public.gg_head_word(m.name)) || '%' )
       -- ② 그 밖에는 기존 판정을 쓰되, **포함검사로만 걸린 막연한 이름**은 뺀다
       --    (「자석블럭」 ⊂ 「마인크래프트 미니자석블럭」 — 사장님 "자석블럭들은 그냥 둬")
       or ( public.gg_same_product(m.name, p_name)
            and ( not ( length(public.gg_norm(p_name)) >= 4
                        and public.gg_norm(m.name) like '%' || public.gg_norm(p_name) || '%' )
                  or public.gg_norm(p_name) like '%' || public.gg_norm(public.gg_head_word(m.name)) || '%' ) )
     )
   order by m.id
   limit 1
$$;

-- 확인 — 걸려야 할 것과 걸리면 안 되는 것
select '🟢걸려야: 밀크하우스 요거쪽쪽&치즈' as k,
       public.gg_in_own_window('밀크하우스 요거쪽쪽&치즈', 'ah_yamyam_', '2026-10-14') is not null as 걸리나
union all select '🟢걸려야: 요거쪽쪽',
       public.gg_in_own_window('요거쪽쪽', 'x', '2026-10-05') is not null
union all select '🔴걸리면안됨: 밀키요 요거트',
       public.gg_in_own_window('밀키요 요거트', 'x', '2026-09-28') is not null
union all select '🔴걸리면안됨: 프레벨롱 요거트',
       public.gg_in_own_window('프레벨롱 요거트', 'x', '2026-10-07') is not null
union all select '🔴걸리면안됨: 자석블럭',
       public.gg_in_own_window('자석블럭', 'x', '2026-10-16') is not null
union all select '🟢걸려야: 맥씽크 마인크래프트 자석블럭 300pcs',
       public.gg_in_own_window('맥씽크 마인크래프트 자석블럭 300pcs', 'x', '2026-10-20') is not null
union all select '🔴걸리면안됨: 벨베이비 자석블럭',
       public.gg_in_own_window('벨베이비 자석블럭', 'x', '2026-10-16') is not null;
