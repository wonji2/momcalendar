-- 붙여 쓴 말에서 상품명 낱말 찾기 v5 (2026-09-01, 사장님 지적)
--   🔑 **끝 낱말만** 쓴다. 앞부분을 잘라내면 다른 뜻의 낱말이 된다.
--      *"메쉬넵 세글자가 그 브랜드고 메쉬는 그냥 망사라는 메쉬 이거니까 두갠 다른 단어자나"*
--      → '메쉬넵' 에서 '메쉬'(시작) 를 취하면 지퍼파우치가 나간다. 시작 후보를 아예 뺀다.
--   한국어는 '수식어 + 핵심어' 라 뒤가 답이다: 아기김→김 · 아기곰탕→곰탕 · 신생아기저귀→기저귀 · 로얄젤리→젤리
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
     -- 끝 낱말만 (앞을 자르면 뜻이 달라진다)
     and position(a.tok in k) > 0
     and position(a.tok in k) + length(a.tok) - 1 = length(k)
     and a.tok !~ '^(카드|세트|모음|모음전|전제품|시리즈|기획전|특가|골라담기|신상|국산|무료배송|택1|종|차|개|입|팩|세일|할인|최저가|공구|앵콜|재입고|사은품|증정)$'
     and a.tok !~ '^(아기|아가|아이|유아|영유아|신생아|키즈|어린이|아동|주니어|엄마|맘|남아|여아|우리|초등|성인)$'
   order by length(a.tok) desc, a.c desc
   limit 3;
end $$;
grant execute on function public.bot_subword(text) to anon, authenticated, service_role;
