-- 검색 노출용 정적 페이지를 매일 자동 생성하기 위한 집계 (사장님 지시 2026-08-05)
-- 집계는 무거우므로 pg_cron 이 새벽에 미리 계산해 seo_cache 에 넣어 둔다.
-- GitHub Actions 는 캐시만 읽는다(anon 의 3초 제한에 걸리지 않게).

create or replace function public.seo_build()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
with c as (
  select id, btrim(regexp_replace(name,'\s+',' ','g')) nm0, influencer, insta, open_date, end_date, major, minor
  from public.gonggu where approved=true and name is not null and btrim(name)<>''
),
t as (
  select *,
    btrim(regexp_replace(
      regexp_replace(
        regexp_replace(nm0,'^(\s*[\[\(<][^\]\)>]*[\]\)>]\s*)+','','g'),
        '\s*\(.*?\)\s*',' ','g'),
      '(\s+([0-9]+\s*(종|개입|개|입|매|팩|P|p|박스|세트|셋트|SET|set|ea|EA))|\s*(세트|셋트|SET|set|모음전|기획전|특가|공구|앵콜|앙콜|재오픈|[0-9]+차))+\s*$','','g')) nm
  from c
),
w as (select *, regexp_split_to_array(nm,' ') ws from t where nm <> ''),
b0 as (
  select *,
    btrim(regexp_replace(regexp_replace(ws[1],'^[^가-힣A-Za-z0-9]+',''),'[^가-힣A-Za-z0-9]+$','')) w1,
    btrim(regexp_replace(regexp_replace(coalesce(ws[2],''),'^[^가-힣A-Za-z0-9]+',''),'[^가-힣A-Za-z0-9]+$','')) w2,
    btrim(regexp_replace(regexp_replace(ws[array_length(ws,1)],'^[^가-힣A-Za-z0-9]+',''),'[^가-힣A-Za-z0-9]+$','')) wl,
    array_length(ws,1) wn
  from w
),
b as (
  select *,
    case when w1 ~* '^(국내산|국산|햇|생|냉장|냉동|무항생제|유기농|프리미엄|정품|신상|한정|초특가|특가|대용량|단독|첫|첫공구|앵콜|앙콜|재오픈|마감임박|오늘마감|NEW|HOT|SALE|BEST|20[0-9][0-9])$'
              and wn > 1 and length(w2) >= 2 then w2 else w1 end brand0,
    case when wn > 1 then wl else null end prod
  from b0
),
v0 as (
  select * from b
  where length(brand0) >= 2 and brand0 ~ '[가-힣A-Za-z]' and brand0 !~ '^[0-9]+$'
    and brand0 !~* '^(NEW|HOT|SALE|BEST|MD|EVENT|OPEN|주문|배송|공구|구매|판매|할인|증정|사은품|무료|추천|인기|필수|가격|최저가|정품|사전|예약|재입고|품절|한정판|휴대용|아기|아기용|유아|어린이|초등|신생아|미니|대형|소형|무타공|다용도|무선|유선|접이식|접이|폴딩|사계절|여름|겨울|봄|가을|냉감|온열|방수|항균|친환경|저자극|실리콘|스테인리스|원목|순면|천연|수입|오리지널|캐릭터|생활|주방|욕실|거실|침실|차량|캠핑)$'
),
cb as (select lower(brand0) lb, mode() within group (order by brand0) brand from v0 group by lower(brand0)),
v  as (select v0.*, cb.brand from v0 join cb on lower(v0.brand0) = cb.lb),
tp as (
  select brand, prod, row_number() over (partition by brand order by count(*) desc, prod) rn
  from v where prod is not null and length(prod)>=2 and prod ~ '[가-힣A-Za-z]' and prod !~ '^[0-9]+$'
  group by 1,2
),
brands as (
  select jsonb_agg(x order by x->>'cnt') d from (
    select jsonb_build_object(
      'brand', v.brand, 'cnt', count(*), 'sellers', count(distinct lower(v.insta)),
      'first_open', min(v.open_date), 'last_open', max(v.open_date),
      'major', mode() within group (order by v.major),
      'topprods', (select string_agg(y.prod,'|' order by y.rn) from tp y where y.brand = v.brand and y.rn <= 3),
      'rows', string_agg(
        coalesce(nullif(v.influencer,''), v.insta) || E'\t' || v.nm0 || E'\t' ||
        coalesce(v.open_date,'') || E'\t' || coalesce(v.end_date,'') || E'\t' || coalesce(v.insta,''),
        E'\n' order by v.open_date desc)
    ) x
    from v group by v.brand having count(*) >= 1
  ) q
),
pv as (
  select * from v
  where prod is not null and length(prod) >= 2 and prod ~ '[가-힣A-Za-z]' and prod !~ '^[0-9]+$'
    and prod !~* '^(공구|구매|판매|할인|증정|무료|추천|인기|가격|최저가)$'
    and lower(prod) <> lower(brand)
),
products as (
  select jsonb_agg(x) d from (
    select jsonb_build_object(
      'brand', mode() within group (order by brand), 'prod', mode() within group (order by prod),
      'key', mode() within group (order by brand) || ' ' || mode() within group (order by prod),
      'cnt', count(*), 'sellers', count(distinct lower(insta)),
      'first_open', min(open_date), 'last_open', max(open_date),
      'major', mode() within group (order by major), 'minor', mode() within group (order by minor),
      'rows', string_agg(
        nm0 || E'\t' || coalesce(nullif(influencer,''), insta) || E'\t' ||
        coalesce(open_date,'') || E'\t' || coalesce(end_date,'') || E'\t' || coalesce(insta,''),
        E'\n' order by open_date desc)
    ) x
    from pv group by lower(brand), lower(prod) having count(*) >= 2
  ) q
),
sellers as (
  select jsonb_agg(x) d from (
    select jsonb_build_object(
      'insta', lower(trim(g.insta)),
      'kor', coalesce(max(g.influencer) filter (where coalesce(g.influencer,'')<>''), lower(trim(g.insta))),
      'cnt', count(*), 'first_open', min(g.open_date), 'last_open', max(g.open_date),
      'major', mode() within group (order by g.major),
      'followers', max(p.followers), 'verified', bool_or(p.is_verified),
      'rows', string_agg(
        g.name || E'\t' || coalesce(g.open_date,'') || E'\t' || coalesce(g.end_date,'') || E'\t' || coalesce(g.major,''),
        E'\n' order by g.open_date desc)
    ) x
    from public.gonggu g
    left join public.seller_profile p on lower(p.insta) = lower(trim(g.insta))
    where g.approved = true and g.insta is not null and trim(g.insta) <> ''
    group by lower(trim(g.insta)) having count(*) >= 1
  ) q
),
minors as (
  select jsonb_agg(x) d from (
    select jsonb_build_object(
      'major', g.major, 'minor', g.minor, 'cnt', count(*), 'sellers', count(distinct lower(trim(g.insta))),
      'rows', string_agg(
        g.name || E'\t' || coalesce(nullif(g.influencer,''), g.insta) || E'\t' ||
        coalesce(g.open_date,'') || E'\t' || coalesce(g.end_date,''),
        E'\n' order by g.open_date desc)
    ) x
    from public.gonggu g
    where g.approved=true and coalesce(g.minor,'')<>'' and coalesce(g.major,'')<>''
    group by g.major, g.minor having count(*) >= 3
  ) q
),
months as (
  select jsonb_agg(x order by x->>'ym') d from (
    select jsonb_build_object(
      'ym', substr(open_date,1,7), 'cnt', count(*), 'sellers', count(distinct lower(trim(insta))),
      'rows', string_agg(
        name || E'\t' || coalesce(nullif(influencer,''), insta) || E'\t' ||
        coalesce(open_date,'') || E'\t' || coalesce(end_date,'') || E'\t' || coalesce(major,''),
        E'\n' order by open_date)
    ) x
    from public.gonggu
    where approved=true and open_date ~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$'
      -- 창을 두지 않는다. 지난 달 페이지가 사라지면 색인이 날아간다(사장님 승인 2026-08-05).
      and open_date >= '2020-01-01'
    group by substr(open_date,1,7) having count(*) >= 5
  ) q
),
tday as (select to_char((now() at time zone 'Asia/Seoul')::date,'YYYY-MM-DD') d),
live as (
  select string_agg(x.name||E'\t'||x.who||E'\t'||x.open_date||E'\t'||x.end_date||E'\t'||x.major, E'\n' order by x.open_date desc) s
  from (
    select g.name, coalesce(nullif(g.influencer,''),g.insta) who, g.open_date,
           coalesce(g.end_date,'') end_date, coalesce(g.major,'') major
    from public.gonggu g, tday t
    where g.approved=true and g.open_date <= t.d and coalesce(g.end_date,'9999') >= t.d
    order by g.open_date desc limit 60
  ) x
),
soon as (
  select string_agg(x.name||E'\t'||x.who||E'\t'||x.open_date||E'\t'||x.end_date||E'\t'||x.major, E'\n' order by x.open_date) s
  from (
    select g.name, coalesce(nullif(g.influencer,''),g.insta) who, g.open_date,
           coalesce(g.end_date,'') end_date, coalesce(g.major,'') major
    from public.gonggu g, tday t
    where g.approved=true and g.open_date > t.d
    order by g.open_date limit 60
  ) x
)
select jsonb_build_object(
  'today',    (select d from tday),
  'brands',   coalesce((select d from brands),   '[]'::jsonb),
  'products', coalesce((select d from products), '[]'::jsonb),
  'sellers',  coalesce((select d from sellers),  '[]'::jsonb),
  'minors',   coalesce((select d from minors),   '[]'::jsonb),
  'months',   coalesce((select d from months),   '[]'::jsonb),
  'live',     coalesce((select s from live), ''),
  'soon',     coalesce((select s from soon), ''),
  'stat',     jsonb_build_object(
    'total',   (select count(*) from public.gonggu where approved=true),
    'sellers', (select count(distinct lower(trim(insta))) from public.gonggu where approved=true and coalesce(insta,'')<>''),
    'live',    (select count(*) from public.gonggu g, tday t where g.approved=true and g.open_date<=t.d and coalesce(g.end_date,'9999')>=t.d)
  )
);
$$;


-- ── 캐시 테이블 ─────────────────────────────────────────────
create table if not exists public.seo_cache(
  id int primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.seo_cache enable row level security;
-- 정책 없음 = 아무도 직접 못 읽는다. 아래 함수로만 나간다.
revoke all on table public.seo_cache from anon, authenticated;

-- ── 새벽에 pg_cron 이 돌릴 갱신 함수 ─────────────────────────
create or replace function public.seo_refresh()
returns text
language plpgsql
security definer
set search_path = public
set statement_timeout = '600s'
as $$
declare n int;
begin
  insert into public.seo_cache(id, data, updated_at)
  values (1, public.seo_build(), now())
  on conflict (id) do update set data = excluded.data, updated_at = excluded.updated_at;
  select jsonb_array_length(data->'brands') into n from public.seo_cache where id=1;
  return 'ok brands=' || coalesce(n,0);
end $$;
revoke all on function public.seo_refresh() from public, anon, authenticated;
grant execute on function public.seo_refresh() to service_role;

-- ── 밖에서 읽는 함수(캐시만 본다 = 즉시 반환) ────────────────
create or replace function public.seo_dataset()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_set(data, '{cached_at}', to_jsonb(updated_at)) from public.seo_cache where id = 1;
$$;
revoke all on function public.seo_dataset() from public;
grant execute on function public.seo_dataset() to anon, authenticated, service_role;

comment on function public.seo_dataset() is
  '검색 노출용 정적 페이지 생성 데이터(캐시). GitHub Actions 가 매일 호출한다. 반환값은 전부 사이트에 공개되는 내용이다.';
comment on function public.seo_refresh() is
  'seo_cache 갱신. pg_cron 이 매일 새벽에 호출한다(무거운 집계라 외부 호출 금지).';

-- 최초 1회 채우기
select public.seo_refresh();
