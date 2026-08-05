-- SEO 셀러 페이지용 데이터 (경쟁사도 셀러 페이지를 갖고 있다)
-- 우리만 가진 것: 팔로워 수 · 인증계정 여부 · 공구 이력 통계
select lower(trim(g.insta)) as insta,
       coalesce(max(g.influencer) filter (where coalesce(g.influencer,'')<>''), lower(trim(g.insta))) as kor,
       count(*) as cnt,
       min(g.open_date) as first_open,
       max(g.open_date) as last_open,
       mode() within group (order by g.major) as major,
       max(p.followers) as followers,
       bool_or(p.is_verified) as verified,
       string_agg(
         g.name || E'\t' || coalesce(g.open_date,'') || E'\t' || coalesce(g.end_date,'') || E'\t' || coalesce(g.major,''),
         E'\n' order by g.open_date desc
       ) as rows
from public.gonggu g
left join public.seller_profile p on lower(p.insta) = lower(trim(g.insta))
where g.approved = true and g.insta is not null and trim(g.insta) <> ''
group by 1
having count(*) >= 2
order by count(*) desc;
