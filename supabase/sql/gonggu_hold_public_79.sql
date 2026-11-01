-- 🔴 내려놓은 공구가 **검색 페이지·sitemap 에는 그대로 살아 있었다** (2026-10-06 검증자 지적)
--
-- 무슨 일이었나: 중복이라 내린 행(approved=false + gonggu_hold)의 건별 페이지가
--   https://momcalendar.com/gg/뉴욕-프리미엄-텀블러-1006.html → **HTTP 200** 이고
--   sitemap-gonggu.xml 에도 그대로 들어 있다. 같은 공구가 구글에 **두 URL**로 남는다
--   (내린 「뉴욕 프리미엄 텀블러」 + 남긴 「스웰 프리미엄 친환경 텀블러」).
--
-- 원인: tools/seo/build.ps1 의 **보존 원칙** — 「페이지는 지우지 않는다」(:246).
--   오늘 집계에 없는 페이지도 KeptUrls() 가 매일 밤 sitemap 에 다시 합류시킨다(:843~858).
--   지우는 예외는 `brand_block` **하나뿐**이다(:850).
--   과거 공구를 남기는 건 의도된 규칙이지만, **중복이라 내린 행**은 그 규칙의 대상이 아니다. 구분이 없었다.
--
-- 고침: `gonggu_hold` 를 **두 번째 예외**로 쓴다. 그런데 빌드는 손님 키(anon)만 쓰고
--   `gonggu_hold` 는 anon 에게 닫혀 있다(메모리 supabase-security-baseline — 새 표는 명시 grant 없이는 안 보인다).
--   표를 통째로 열지 않는다 — `reason` 에 사장님 지시 문구가 들어 있다.
--   **슬러그를 만드는 데 필요한 두 칸(name·open_date)만** 내주는 뷰를 연다.
--   그 둘은 그 공구가 노출중이던 동안 이미 공개됐던 값이다.

create or replace view public.gonggu_hold_public as
  select g.name, g.open_date
    from public.gonggu_hold h
    join public.gonggu g on g.id = h.id
   where coalesce(g.name,'') <> ''
     and g.open_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$';

alter view public.gonggu_hold_public set (security_invoker = off);
grant select on public.gonggu_hold_public to anon, authenticated;

select count(*) as 내려둔_공구, min(open_date) as 가장_이른, max(open_date) as 가장_늦은
  from public.gonggu_hold_public;
