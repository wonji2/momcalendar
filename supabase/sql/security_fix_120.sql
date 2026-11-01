-- 보안 구멍 막기 1차 (2026-10-27 · 사장님 「보안이 제일 중요 … 다른 모든 구멍들도」 · 점검 결과 scratchpad/sec/)
-- 되돌리기: 바꾸기 전 함수 정의 scratchpad/handoff-log/security_fix_2026-10-27_before_defs.sql
--
-- ① 예약작업(postgres)만 쓰는 함수인데 손님(anon)·로그인(authenticated)에 열려 있던 것 → 닫는다
--    hotdeal_purge_old: anon 이 {"p_days":0} 으로 핀 안 된 지난 핫딜을 전부 지울 수 있었다
revoke execute on function public.hotdeal_purge_old(integer) from public, anon, authenticated;
revoke execute on function public.bot_pair_add(text, text) from public, anon, authenticated;
revoke execute on function public.bot_review_add(text, text, integer) from public, anon, authenticated;
revoke execute on function public.check_site_health(integer) from public, anon, authenticated;
revoke execute on function public.data_health_person_dup() from public, anon, authenticated;

-- ② 매출 조회 — anon 이 쿠팡 수익·거래액을 그대로 볼 수 있었다 → 관리자만(원래 함수는 안쪽으로 숨긴다)
do $$ begin
  if to_regprocedure('public._revenue_by_source_inner(integer)') is null then
    alter function public.revenue_by_source(integer) rename to _revenue_by_source_inner;
  end if;
end $$;
revoke all on function public._revenue_by_source_inner(integer) from public, anon, authenticated;
create or replace function public.revenue_by_source(p_days integer default 30)
returns table("종류" text, "등록" bigint, "노출중" bigint, "클릭" bigint, "수익" bigint, "거래액" bigint, "마지막등록" text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_app_admin() then raise exception 'forbidden' using errcode = '28000'; end if;
  return query select * from public._revenue_by_source_inner(p_days);
end $$;
revoke all on function public.revenue_by_source(integer) from public, anon;
grant execute on function public.revenue_by_source(integer) to authenticated;

-- ③ 쿠팡 수익 다시 받기 — 스태프 계정이면 누구나 쿠팡 API 를 마구 부를 수 있었다 → REST(로그인 손님)로 부르면 관리자만. 예약작업(postgres)은 그대로
do $$
declare d text;
begin
  d := pg_get_functiondef('public.coupang_revenue_refetch()'::regprocedure);
  if position('관리자만(2026-10-27)' in d) = 0 then
    d := regexp_replace(d, '(AS \$[a-z_]*\$\s*(declare[\s\S]*?)?begin)', E'\\1\n  -- 관리자만(2026-10-27): REST 로 부르면 관리자 검사, 예약작업(요청 토큰 없음)은 통과\n  if coalesce(current_setting(''request.jwt.claims'', true), '''') <> '''' and not public.is_app_admin() then raise exception ''forbidden'' using errcode = ''28000''; end if;', 'i');
    if position('관리자만(2026-10-27)' in d) = 0 then raise exception 'coupang_revenue_refetch: begin 을 못 찾아 고치지 않았다'; end if;
    execute d;
  end if;
end $$;
revoke execute on function public.coupang_revenue_refetch() from public, anon;

-- ④ 매출 일별 표 — RLS 가 꺼져 있어 로그인(스태프 포함)이면 읽혔다 → 관리자만
alter table public.revenue_daily enable row level security;
drop policy if exists revenue_daily_admin on public.revenue_daily;
create policy revenue_daily_admin on public.revenue_daily for select to authenticated using (public.is_app_admin());
revoke all on public.revenue_daily from anon;

-- ⑤ 챗봇 해석 표 — anon 이 손님 문장 854건을 읽고, 로그인(스태프)이 고칠 수 있었다 → 엣지 함수(service_role)만
revoke all on public.bot_interp from anon, authenticated;

-- ⑥ 배너 공개 뷰 — 예약 배너의 판매 링크가 오픈 전에 보였다(자체 공구 링크는 오픈일 자정에) → 그 전엔 링크를 비운다
create or replace view public.banners_public as
 select id, type, title, subtitle, cta,
        case when link_open_at is null or link_open_at <= now() then link else null end as link,
        bg, img_url, sort_order, active, created_at, img_position, img_size, link_open_at, show_from, show_until, stage
   from public.banners
  where active = true;

-- ⑦ 방문 기록 — anon 이 길이 제한 없이 써서 DB(500MB)를 채울 수 있었다 → 새로 들어오는 행만 길이 검사(기존 행은 그대로: NOT VALID)
alter table public.events drop constraint if exists events_len_chk;
alter table public.events add constraint events_len_chk check (length(event_type) <= 60 and length(coalesce(event_data, '')) <= 2000) not valid;

notify pgrst, 'reload schema';
select 'ok' r;
