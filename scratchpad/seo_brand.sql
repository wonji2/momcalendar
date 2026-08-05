-- SEO 브랜드 페이지용 데이터
-- 상품명 첫 단어(꾸밈말이면 두 번째)를 브랜드로 보고 묶는다.
with c as (
  select id, btrim(regexp_replace(name,'\s+',' ','g')) nm, influencer, insta, open_date, end_date, major, minor
  from public.gonggu
  where approved = true and name is not null and btrim(name) <> ''
),
w as (select *, regexp_split_to_array(nm,' ') ws from c),
b as (
  select id, nm, influencer, insta, open_date, end_date, major, minor,
    case when ws[1] ~ '^(국내산|국산|햇|생|냉장|냉동|무항생제|유기농|프리미엄|정품|신상|한정|초특가|특가|대용량|20[0-9][0-9]|NEW|new)$'
              and array_length(ws,1) > 1 then ws[2] else ws[1] end brand
  from w
)
select brand,
       count(*) cnt,
       count(distinct lower(insta)) sellers,
       min(open_date) first_open,
       max(open_date) last_open,
       mode() within group (order by major) major,
       string_agg(
         coalesce(nullif(influencer,''), insta) || E'\t' || nm || E'\t' || coalesce(open_date,'') || E'\t' || coalesce(end_date,'') || E'\t' || coalesce(insta,''),
         E'\n' order by open_date desc
       ) rows
from b
where length(brand) >= 2 and brand !~ '^[0-9]+$'
group by brand
having count(*) >= 2
order by count(distinct lower(insta)) desc, count(*) desc;
