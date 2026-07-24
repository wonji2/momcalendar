-- ══════════════════════════════════════════════════════════
--  관리자 통계 RPC — 2026-07-23
--
--  목적: admin.html 통계 페이지 개편(B안). 무거운 집계를 브라우저에서
--        DB 로 옮긴다. (events 10만건을 매번 내려받던 것을 대체)
--
--  공통: 전부 SECURITY DEFINER + is_app_admin() 게이트.
--        anon 은 실행 불가. 관리자로 로그인한 authenticated 만 값을 받는다.
--        (통계 열람 차단은 2026-07-23 rls 정리에서 이미 걸어둔 정책과 일관)
--
--  ⚠ event_data 는 TEXT. 잘못된 JSON 이 섞여 있어도 죽지 않게 정규식으로 뽑는다.
--    visited_at 은 UTC 저장 → '오늘'은 Asia/Seoul 로 변환해 비교.
-- ══════════════════════════════════════════════════════════

-- 공구 id 를 event_data 에서 안전하게 추출 (card_click / save 용)
create or replace function public._evt_gonggu_id(p text)
returns bigint
language sql immutable
set search_path = public
as $$
  select case
    when p is null then null
    when p ~ '"id"[[:space:]]*:[[:space:]]*[0-9]+'
      then (regexp_match(p, '"id"[[:space:]]*:[[:space:]]*([0-9]+)'))[1]::bigint
    when p ~ '^[0-9]+$' then p::bigint
    else null
  end;
$$;
revoke execute on function public._evt_gonggu_id(text) from public, anon, authenticated;


-- ── 1) 오늘 한눈에 (요약 카드) ──
create or replace function public.admin_overview()
returns json
language plpgsql stable
security definer
set search_path = public
as $$
declare
  d date := (now() at time zone 'Asia/Seoul')::date;
  now_t time := (now() at time zone 'Asia/Seoul')::time;   -- 지금 시각(KST)
  vt bigint; vy bigint; vy_sofar bigint; v7 bigint; v30 bigint; vtot bigint;
  ret numeric;
  w_tot bigint; w_users bigint; w_gg bigint;
  p_active bigint; p_users bigint; optin numeric;
  g_tot bigint; g_month bigint; g_pend bigint; s_pend bigint;
begin
  if not public.is_app_admin() then
    return json_build_object('ok', false, 'msg', 'forbidden');
  end if;

  select count(*) filter (where (visited_at at time zone 'Asia/Seoul')::date = d),
         count(*) filter (where (visited_at at time zone 'Asia/Seoul')::date = d - 1),
         -- 어제 '같은 시각'까지 (오늘과 공정 비교): 어제 00:00 ~ 어제 지금시각
         count(*) filter (where (visited_at at time zone 'Asia/Seoul')::date = d - 1
                            and (visited_at at time zone 'Asia/Seoul')::time <= now_t),
         count(*) filter (where visited_at >= now() - interval '7 days'),
         count(*) filter (where visited_at >= now() - interval '30 days'),
         count(*)
    into vt, vy, vy_sofar, v7, v30, vtot
  from visitors;

  select round(100.0 * count(*) filter (where days >= 2) / nullif(count(*), 0), 1)
    into ret
  from (
    select anonymous_id, count(distinct (visited_at at time zone 'Asia/Seoul')::date) as days
    from visits
    where anonymous_id is not null and visited_at >= now() - interval '30 days'
    group by anonymous_id
  ) t;

  select count(*), count(distinct device_id), count(distinct gonggu_id)
    into w_tot, w_users, w_gg from wishes;

  select count(*) filter (where fail_count < 5), count(distinct device_id)
    into p_active, p_users from push_subs;

  optin := round(100.0 * p_active / nullif(w_users, 0), 1);

  select count(*) filter (where approved),
         count(*) filter (where approved and open_date >= to_char(date_trunc('month', d), 'YYYY-MM-DD')),
         count(*) filter (where not approved)
    into g_tot, g_month, g_pend from gonggu;

  select count(*) into s_pend
    from sellers where login_insta is not null and not login_active;

  return json_build_object(
    'ok', true,
    'today', d,
    'visit', json_build_object('today', vt, 'yesterday', vy, 'yesterday_sofar', vy_sofar, 'week', v7, 'month', v30, 'total', vtot),
    'retention_30d', coalesce(ret, 0),
    'wish', json_build_object('total', w_tot, 'users', w_users, 'gonggu', w_gg),
    'push', json_build_object('active', p_active, 'optin_rate', coalesce(optin, 0)),
    'gonggu', json_build_object('total', g_tot, 'month', g_month),
    'pending', json_build_object('gonggu', g_pend, 'seller', s_pend)
  );
end;
$$;


-- ── 2) 찜 많은 공구 TOP ──
create or replace function public.admin_wish_top(p_limit int default 20)
returns table (gonggu_id bigint, name text, seller text, insta text, wish_cnt bigint, open_date text, approved boolean)
language plpgsql stable
security definer
set search_path = public
as $$
begin
  if not public.is_app_admin() then raise exception 'forbidden' using errcode='28000'; end if;
  return query
    select g.id,
           coalesce(nullif(g.name,''), '(삭제된 공구)'),
           coalesce(nullif(g.influencer,''), g.insta),
           g.insta,
           w.cnt,
           g.open_date,
           g.approved
    from (select wi.gonggu_id as gid, count(*)::bigint as cnt from wishes wi group by wi.gonggu_id) w
    left join gonggu g on g.id = w.gid
    order by w.cnt desc, w.gid desc
    limit greatest(1, least(p_limit, 200));
end;
$$;


-- ── 3) 셀러별 찜 합계 ──
create or replace function public.admin_wish_by_seller(p_limit int default 20)
returns table (seller text, insta text, wish_cnt bigint, gonggu_cnt bigint)
language plpgsql stable
security definer
set search_path = public
as $$
begin
  if not public.is_app_admin() then raise exception 'forbidden' using errcode='28000'; end if;
  return query
    select coalesce(nullif(max(g.influencer),''), g.insta) as seller,
           g.insta,
           count(w.*)::bigint as wish_cnt,
           count(distinct g.id)::bigint as gonggu_cnt
    from wishes w
    join gonggu g on g.id = w.gonggu_id
    where coalesce(g.insta,'') <> ''
    group by g.insta
    order by wish_cnt desc
    limit greatest(1, least(p_limit, 200));
end;
$$;


-- ── 4) 알림(푸시) 현황 ──
create or replace function public.admin_push_overview()
returns json
language plpgsql stable
security definer
set search_path = public
as $$
declare sub_total bigint; sub_active bigint; sub_dead bigint;
        sent_total bigint; sent_today bigint; sent_days json;
begin
  if not public.is_app_admin() then return json_build_object('ok', false, 'msg', 'forbidden'); end if;

  select count(*), count(*) filter (where fail_count < 5), count(*) filter (where fail_count >= 5)
    into sub_total, sub_active, sub_dead from push_subs;

  select count(*), count(*) filter (where (created_at at time zone 'Asia/Seoul')::date = (now() at time zone 'Asia/Seoul')::date)
    into sent_total, sent_today from push_log;

  select coalesce(json_agg(row_to_json(t)), '[]'::json) into sent_days from (
    select (created_at at time zone 'Asia/Seoul')::date as d, count(*) as cnt
    from push_log
    where created_at >= now() - interval '14 days'
    group by 1 order by 1 desc
  ) t;

  return json_build_object('ok', true,
    'sub_total', sub_total, 'sub_active', sub_active, 'sub_dead', sub_dead,
    'sent_total', sent_total, 'sent_today', sent_today, 'recent', sent_days);
end;
$$;


-- ── 5) 일별 방문 추이 ──
create or replace function public.admin_visit_series(p_days int default 30)
returns table (d date, visits bigint)
language plpgsql stable
security definer
set search_path = public
as $$
begin
  if not public.is_app_admin() then raise exception 'forbidden' using errcode='28000'; end if;
  return query
    select (visited_at at time zone 'Asia/Seoul')::date as d, count(*)::bigint
    from visitors
    where visited_at >= now() - make_interval(days => greatest(1, least(p_days, 180)))
    group by 1 order by 1;
end;
$$;


-- ── 6) 유입 경로 ──
create or replace function public.admin_referrers(p_days int default 30, p_limit int default 12)
returns table (source text, cnt bigint)
language plpgsql stable
security definer
set search_path = public
as $$
begin
  if not public.is_app_admin() then raise exception 'forbidden' using errcode='28000'; end if;
  return query
    select case
             when coalesce(referrer,'') = '' then '(직접 방문·앱)'
             when referrer ~* 'naver'    then '네이버'
             when referrer ~* 'google'   then '구글'
             when referrer ~* 'instagram' then '인스타그램'
             when referrer ~* 'threads'  then '스레드'
             when referrer ~* 'kakao'    then '카카오'
             when referrer ~* 'daum'     then '다음'
             when referrer ~* 'momcalendar' then '사이트 내부'
             else regexp_replace(referrer, '^https?://([^/]+).*$', '\1')
           end as source,
           count(*)::bigint
    from visits
    where visited_at >= now() - make_interval(days => greatest(1, least(p_days, 180)))
    group by 1 order by 2 desc
    limit greatest(1, least(p_limit, 50));
end;
$$;


-- ── 7) 셀러 성과표 (공구수·클릭·찜) ──
create or replace function public.admin_seller_perf(p_days int default 30, p_limit int default 30)
returns table (insta text, seller text, gonggu_cnt bigint, click_cnt bigint, wish_cnt bigint, is_partner boolean)
language plpgsql stable
security definer
set search_path = public
as $$
declare since timestamptz := now() - make_interval(days => greatest(1, least(p_days, 365)));
begin
  if not public.is_app_admin() then raise exception 'forbidden' using errcode='28000'; end if;

  return query
  with clk as (   -- card_click event_data 의 공구 id → gonggu.insta 로 집계
    select g.insta, count(*)::bigint as c
    from events e
    join gonggu g on g.id = public._evt_gonggu_id(e.event_data)
    where e.event_type = 'card_click' and e.visited_at >= since and coalesce(g.insta,'') <> ''
    group by g.insta
  ),
  wsh as (
    select g.insta, count(*)::bigint as c
    from wishes w join gonggu g on g.id = w.gonggu_id
    where coalesce(g.insta,'') <> ''
    group by g.insta
  ),
  base as (
    select g.insta,
           coalesce(nullif(max(g.influencer) filter (where g.influencer not like '@%'),''), g.insta) as seller,
           count(*)::bigint as gg,
           bool_or(coalesce(s.is_partner,false)) as partner
    from gonggu g
    left join sellers s on s.insta = g.insta
    where coalesce(g.insta,'') <> ''
    group by g.insta
  )
  select b.insta, b.seller, b.gg,
         coalesce(clk.c, 0), coalesce(wsh.c, 0), b.partner
  from base b
  left join clk on clk.insta = b.insta
  left join wsh on wsh.insta = b.insta
  order by coalesce(clk.c,0) + coalesce(wsh.c,0)*3 desc, b.gg desc
  limit greatest(1, least(p_limit, 200));
end;
$$;


-- ── 8) 인기 공구(클릭) ──
create or replace function public.admin_card_top(p_days int default 30, p_limit int default 20)
returns table (gonggu_id bigint, name text, seller text, insta text, click_cnt bigint, wish_cnt bigint)
language plpgsql stable
security definer
set search_path = public
as $$
declare since timestamptz := now() - make_interval(days => greatest(1, least(p_days, 365)));
begin
  if not public.is_app_admin() then raise exception 'forbidden' using errcode='28000'; end if;
  return query
  with clk as (
    select public._evt_gonggu_id(event_data) as gid, count(*)::bigint as c
    from events
    where event_type = 'card_click' and visited_at >= since
      and public._evt_gonggu_id(event_data) is not null
    group by 1
  )
  select clk.gid,
         coalesce(nullif(g.name,''), '(삭제됨)'),
         coalesce(nullif(g.influencer,''), g.insta),
         g.insta,
         clk.c,
         (select count(*)::bigint from wishes w where w.gonggu_id = clk.gid)
  from clk left join gonggu g on g.id = clk.gid
  order by clk.c desc
  limit greatest(1, least(p_limit, 100));
end;
$$;


-- ── 9) 인기 검색어 + 수요 갭(결과 0건) ──
create or replace function public.admin_search_top(p_days int default 30, p_limit int default 25)
returns table (q text, cnt bigint, zero_cnt bigint)
language plpgsql stable
security definer
set search_path = public
as $$
declare since timestamptz := now() - make_interval(days => greatest(1, least(p_days, 365)));
begin
  if not public.is_app_admin() then raise exception 'forbidden' using errcode='28000'; end if;
  return query
  select lower(btrim((regexp_match(event_data, '"q"[[:space:]]*:[[:space:]]*"([^"]*)"'))[1])) as q,
         count(*)::bigint as cnt,
         count(*) filter (where event_data ~ '"n"[[:space:]]*:[[:space:]]*0[^0-9]')::bigint as zero_cnt
  from events
  where event_type = 'search' and visited_at >= since
    and event_data ~ '"q"[[:space:]]*:[[:space:]]*"[^"]'
  group by 1
  having lower(btrim((regexp_match(event_data, '"q"[[:space:]]*:[[:space:]]*"([^"]*)"'))[1])) <> ''
  order by cnt desc
  limit greatest(1, least(p_limit, 100));
end;
$$;


-- ── 실행 권한: 관리자로 로그인한 authenticated 만 (내부에서 재확인) ──
revoke execute on function
  public.admin_overview(), public.admin_wish_top(int), public.admin_wish_by_seller(int),
  public.admin_push_overview(), public.admin_visit_series(int), public.admin_referrers(int,int),
  public.admin_seller_perf(int,int), public.admin_card_top(int,int), public.admin_search_top(int,int)
  from public, anon;

grant execute on function
  public.admin_overview(), public.admin_wish_top(int), public.admin_wish_by_seller(int),
  public.admin_push_overview(), public.admin_visit_series(int), public.admin_referrers(int,int),
  public.admin_seller_perf(int,int), public.admin_card_top(int,int), public.admin_search_top(int,int)
  to authenticated;
