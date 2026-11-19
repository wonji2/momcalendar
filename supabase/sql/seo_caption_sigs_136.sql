-- 검색 페이지 빌드(tools/seo/build.ps1)의 캡션 전체 읽기 줄이기 (2026-11-19, 전송량 절감)
--   전에는 매일 05:10 승인 공구의 캡션 1만 2천 건(약 23MB)을 통째로 받았다(월 0.7GB — 무료 한도 5GB 의 14%).
--   이 함수는 행마다 「이름|오픈일|캡션」의 지문(md5)만 준다(행당 50바이트 안팎, 전체 0.7MB). 빌드는 어제 받아 둔 것과 지문이 다른 행의 캡션만 다시 받는다.
--   캡션은 사이트에 이미 공개된 글이라 지문을 손님 키(anon)에 열어도 새로 드러나는 것이 없다. 쪽 나누기는 p_offset(응답 상한 1000행).
create or replace function public.seo_caption_sigs(p_offset integer default 0, p_limit integer default 1000)
returns table(id bigint, sig text)
language sql stable security definer set search_path = public as $$
  select g.id, md5(coalesce(g.name,'') || '|' || coalesce(g.open_date,'') || '|' || g.caption)
  from public.gonggu g
  where g.approved and g.caption is not null
  order by g.id
  offset greatest(p_offset, 0) limit least(greatest(p_limit, 1), 1000);
$$;
revoke all on function public.seo_caption_sigs(integer, integer) from public;
grant execute on function public.seo_caption_sigs(integer, integer) to anon, authenticated, service_role;
notify pgrst, 'reload schema';
