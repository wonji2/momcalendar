-- 🔴 80번의 「내 앞 낱말이 들어 있으면」 갈래가 **너무 넓었다** (같은 날 바로 잡음)
--
-- 전수로 쓸어 보니 6건이 걸렸는데 **4건이 오판**이었다:
--   🔴 「유니드**마이** 그릭 요거트」  ← 내 「**마이**키즈 영양음료」의 '마이' 가 낱말 가운데 걸렸다
--   🔴 「티니핑 완구」·「티니핑 & 카봇 식기」·「캐치티니핑 플레이북」
--       ← 티니핑은 **캐릭터 라이선스**라 완구·식기·책에 다 붙는다. 내 젤리와 경쟁 상품이 아니다
--       (검증자도 오늘 「티니핑 완구는 안 걸린다」를 통과 판정했던 자리다 — 80번이 그걸 깼다)
--   ✅ 「밀크하우스 요거쪽쪽&치즈」 · 「우랩 소고기」 — 이 둘은 내려야 하는 게 맞다
--
-- 고침 두 가지
--  ① **낱말 경계**로만 본다. 「마이」가 「유니드마이」 가운데 걸리지 않는다.
--     정규화(공백 제거)한 문자열로 비교하면 경계가 사라지므로 **원문에 정규식**을 건다.
--  ② **캐릭터 낱말은 이 갈래를 쓰지 않는다.** 캐릭터는 품목을 가리지 않고 붙는다.
--     지금은 티니핑 하나다. 늘어나면 여기 적는다 — 표로 빼는 것은 과하다(코드 한 줄이 더 읽기 쉽다).

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
       -- ① 내 상품명의 앞 낱말이 상대 이름에 **낱말로** 들어 있으면 같은 상품이다
       --    「요거쪽쪽」 ⊂ 「밀크하우스 요거쪽쪽&치즈」 · 「우랩」 ⊂ 「우랩 소고기」
       (   length(public.gg_head_word(m.name)) >= 2
       and public.gg_head_word(m.name) !~* '(티니핑|포켓몬|뽀로로|핑크퐁|캐치티니핑)'   -- 캐릭터는 품목을 안 가린다
       and p_name ~ ('(^|[^가-힣A-Za-z0-9])' || public.gg_head_word(m.name) || '([^가-힣A-Za-z0-9]|$)') )
       -- ② 그 밖에는 기존 판정. 단 **포함검사로만 걸린 막연한 이름**은 뺀다
       --    (「자석블럭」 ⊂ 「마인크래프트 미니자석블럭」 — 사장님 "자석블럭들은 그냥 둬")
       or ( public.gg_same_product(m.name, p_name)
            and ( not ( length(public.gg_norm(p_name)) >= 4
                        and public.gg_norm(m.name) like '%' || public.gg_norm(p_name) || '%' )
                  or public.gg_norm(p_name) like '%' || public.gg_norm(public.gg_head_word(m.name)) || '%' ) )
     )
   order by m.id
   limit 1
$$;

select k, 걸리나, (k like '🟢%') = 걸리나 as 맞나 from (
  select '🟢걸려야: 밀크하우스 요거쪽쪽&치즈' k, public.gg_in_own_window('밀크하우스 요거쪽쪽&치즈','x','2026-10-14') is not null 걸리나
  union all select '🟢걸려야: 우랩 소고기',        public.gg_in_own_window('우랩 소고기','x','2026-10-05') is not null
  union all select '🟢걸려야: 요거쪽쪽',           public.gg_in_own_window('요거쪽쪽','x','2026-10-05') is not null
  union all select '🟢걸려야: 맥씽크 마인크래프트 자석블럭', public.gg_in_own_window('맥씽크 마인크래프트 자석블럭 300pcs','x','2026-10-20') is not null
  union all select '🔴안됨: 유니드마이 그릭 요거트',   public.gg_in_own_window('유니드마이 그릭 요거트','x','2026-09-30') is not null
  union all select '🔴안됨: 티니핑 완구',           public.gg_in_own_window('티니핑 완구','x','2026-10-06') is not null
  union all select '🔴안됨: 티니핑 & 카봇 식기',     public.gg_in_own_window('티니핑 & 카봇 식기','x','2026-10-01') is not null
  union all select '🔴안됨: 캐치티니핑 플레이북 모음',  public.gg_in_own_window('캐치티니핑 플레이북 모음','x','2026-10-05') is not null
  union all select '🔴안됨: 자석블럭',             public.gg_in_own_window('자석블럭','x','2026-10-16') is not null
  union all select '🔴안됨: 벨베이비 자석블럭',       public.gg_in_own_window('벨베이비 자석블럭','x','2026-10-16') is not null
  union all select '🔴안됨: 밀키요 요거트',          public.gg_in_own_window('밀키요 요거트','x','2026-09-28') is not null
) t order by 맞나, k;
