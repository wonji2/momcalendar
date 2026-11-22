-- 붙여 쓴 말에서 상품명 낱말 찾기 v4 (2026-09-01)
--   🔑 후보는 손님 말의 **시작이거나 끝**이어야 한다. 가운데 조각은 우연이다.
--      '존재안하는브랜드' → '안'(가운데) 제외 · '뽀로로사운드카드' → '사운드카'(가운데) 제외
--   🔑 한국어는 **뒤가 핵심어**다 → 끝인 후보를 먼저.
--      '신생아기저귀' → 기저귀(끝) · '아기유모차' → 유모차(끝) · '뽀로로사운드카드' → 뽀로로(시작)
--   ⚠ 1건짜리 상품도 손님에겐 답이다 → cnt 조건을 뺐다(위치 조건이 우연을 막는다).
create or replace function public.bot_subword(p_kw text)
returns table(word text, cnt bigint)
language plpgsql stable security definer set search_path = public as $$
declare k text := lower(regexp_replace(coalesce(p_kw,''), '\s', '', 'g'));
begin
  if length(k) < 2 then return; end if;
  return query
  with w as (
    select lower(t) tok from gonggu g,
      lateral regexp_split_to_table(regexp_replace(g.name,'[^가-힣a-zA-Z0-9]+',' ','g'),'\s+') t
     where g.approved
       and to_char(g.end_date::date,'YYYY-MM-DD') >= to_char((now() at time zone 'Asia/Seoul')::date,'YYYY-MM-DD')
       and length(t) between 1 and 10
  ), agg as (select tok, count(*)::bigint c from w group by tok)
  select a.tok, a.c from agg a
   where a.tok <> k
     and position(a.tok in k) > 0
     -- 시작이거나 끝일 때만 (가운데 조각 배제)
     and (position(a.tok in k) = 1 or position(a.tok in k) + length(a.tok) - 1 = length(k))
     -- 한 글자는 끝일 때만 (아기김→김 은 되고, 다른 자리의 한 글자는 안 된다)
     and (length(a.tok) >= 2 or position(a.tok in k) + length(a.tok) - 1 = length(k))
     and a.tok !~ '^(카드|세트|모음|모음전|전제품|시리즈|기획전|특가|골라담기|신상|국산|무료배송|택1|종|차|개|입|팩|세일|할인|최저가|공구|앵콜|재입고|사은품|증정)$'
     and a.tok !~ '^(아기|아가|아이|유아|영유아|신생아|키즈|어린이|아동|주니어|엄마|맘|남아|여아|우리|초등|성인)$'
   order by (case when position(a.tok in k) + length(a.tok) - 1 = length(k) then 0 else 1 end),
            length(a.tok) desc, a.c desc
   limit 3;
end $$;
grant execute on function public.bot_subword(text) to anon, authenticated, service_role;
