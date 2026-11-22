-- 붙여 쓴 말에서 상품명 낱말 찾기 v3 (2026-09-01, 사장님 지적으로 두 번 고침)
--   ① 일반어(카드·세트·모음전…)와 ② 수식어(아기·유아·키즈…)를 후보에서 뺀다.
--      안 빼면 '아기곰탕' → '아기'(14건) · '뽀로로사운드카드' → '카드' 로 엉뚱한 결과가 간다.
--   ③ 1건짜리 우연한 조각도 뺀다 — '뽀로로사운드카드' 에서 '사운드카'(1건) 를 고르던 것.
--   ④ 남은 것 중 **긴 낱말 · 흔한 브랜드** 순. 뽀로로(7건) vs 사운드(3건) → 뽀로로.
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
     and a.c >= 2
     -- 한 글자는 말 끝에 올 때만 쓴다 (아기김→김 은 되고, 존재안하는브랜드→안 은 안 된다)
     and (length(a.tok) >= 2 or position(a.tok in k) = length(k))
     and a.tok !~ '^(카드|세트|모음|모음전|전제품|시리즈|기획전|특가|골라담기|신상|국산|무료배송|택1|종|차|개|입|팩|세일|할인|최저가|공구|앵콜|재입고|사은품|증정)$'
     and a.tok !~ '^(아기|아가|아이|유아|영유아|신생아|키즈|어린이|아동|주니어|엄마|맘|남아|여아|우리|초등|성인)$'
   order by length(a.tok) desc, a.c desc
   limit 3;
end $$;
grant execute on function public.bot_subword(text) to anon, authenticated, service_role;
