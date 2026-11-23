-- ══════════════════════════════════════════════════════════════════
--  통합 지표 저장소 — 웹(GA4) · 안드로이드(Play) · 애플(App Store) (2026-11-23)
--  지시: 길아 님 「애플 갤럭시 웹 다 한눈에 매일 볼 수 있게」
--
--  왜 표 3개인가
--    analytics_daily  : 날짜·소스·지표·차원 한 줄. 증감·추이는 RPC 가 계산한다(원본만 쌓는다)
--    analytics_meta   : 소스별 마지막 수집 상태(ok/stale/미설정/오류). **키가 없어도 화면이 깨지지 않게** 하는 장치
--    analytics_manual : 손으로 넣는 값(플레이 전환율·처음 실행률·쇼핑 차트 순위). 자동값이 없을 때만 쓴다
--
--  쓰기: GitHub Actions 가 서비스 키로 PostgREST upsert (RLS 우회 — service_role)
--  읽기: 관리자만 — analytics_overview() SECURITY DEFINER + is_app_admin()
--  ⚠ anon·authenticated 는 표도 함수도 못 본다(손님용 아님). ops_status_68.sql 과 같은 규칙.
-- ══════════════════════════════════════════════════════════════════

create table if not exists public.analytics_daily (
  day        date        not null,
  source     text        not null,              -- ga4 | play | apple
  metric     text        not null,              -- active_users, sessions, device_installs, downloads …
  dim        text        not null default '',   -- channel:네이버 / source:chatgpt.com / type:first …
  value      numeric     not null,
  updated_at timestamptz not null default now(),
  primary key (day, source, metric, dim)
);
create index if not exists analytics_daily_day_idx on public.analytics_daily (day desc);

create table if not exists public.analytics_meta (
  source     text primary key,                  -- ga4 | play | apple
  status     text not null default '미설정',     -- ok | stale | 미설정 | 오류
  note       text,
  last_ok_at timestamptz,
  last_try_at timestamptz,
  detail     jsonb not null default '{}'::jsonb   -- 마지막 실행에서 얻은 부가 정보(리포트 이름·버킷 목록 등)
);

create table if not exists public.analytics_manual (
  id         text primary key,                  -- play_console | app_store | web_note
  as_of      date,                              -- 그 값이 어느 날 기준인지(반드시 화면에 찍는다)
  payload    jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.analytics_daily  enable row level security;
alter table public.analytics_meta   enable row level security;
alter table public.analytics_manual enable row level security;
revoke all on public.analytics_daily, public.analytics_meta, public.analytics_manual from public, anon, authenticated;

-- ── 관리자용 한 방 조회 ─────────────────────────────────────────────
--   admin.html 은 이 함수 하나만 부른다(카드 5블록 + 신선도). 실패해도 예외를 던지지 않고
--   빈 구조를 돌려준다 → 화면이 '—' 로 뜨고 사유는 meta 에 남는다.
create or replace function public.analytics_overview(p_days integer default 28)
returns jsonb
language plpgsql stable security definer set search_path = 'public' as $$
declare
  d0 date := (now() at time zone 'Asia/Seoul')::date;
  p  integer := greatest(1, least(coalesce(p_days, 28), 120));
  v_web jsonb; v_and jsonb; v_ios jsonb; v_cvr jsonb;
begin
  if not public.is_app_admin() then raise exception 'forbidden' using errcode = '28000'; end if;

  -- ① 웹 (GA4)
  select jsonb_build_object(
    'd1',       coalesce((select value from analytics_daily where source='ga4' and metric='active_users' and dim='' and day = d0 - 1), 0),
    'd2',       coalesce((select value from analytics_daily where source='ga4' and metric='active_users' and dim='' and day = d0 - 2), 0),
    'users7',   coalesce((select sum(value) from analytics_daily where source='ga4' and metric='active_users' and dim='' and day > d0 - 8 and day <= d0 - 1), 0),
    'views7',   coalesce((select sum(value) from analytics_daily where source='ga4' and metric='page_views'  and dim='' and day > d0 - 8 and day <= d0 - 1), 0),
    'series',   coalesce((select jsonb_agg(jsonb_build_object('day', day, 'v', value) order by day)
                            from analytics_daily where source='ga4' and metric='active_users' and dim='' and day > d0 - p), '[]'::jsonb),
    'channels', coalesce((select jsonb_agg(jsonb_build_object('dim', replace(dim,'channel:',''), 'v', v) order by v desc)
                            from (select dim, sum(value) v from analytics_daily
                                   where source='ga4' and metric='sessions' and dim like 'channel:%' and day > d0 - p
                                   group by dim order by 2 desc limit 6) t), '[]'::jsonb),
    'ai',       coalesce((select jsonb_agg(jsonb_build_object('dim', replace(dim,'source:',''), 'v', v) order by v desc)
                            from (select dim, sum(value) v from analytics_daily
                                   where source='ga4' and metric='sessions' and dim like 'source:%' and day > d0 - p
                                   group by dim order by 2 desc limit 6) t), '[]'::jsonb)
  ) into v_web;

  -- ② 안드로이드 (Play 벌크)
  select jsonb_build_object(
    'installs28', coalesce((select sum(value) from analytics_daily where source='play' and metric='device_installs'   and dim='' and day > d0 - p), 0),
    'uninst28',   coalesce((select sum(value) from analytics_daily where source='play' and metric='device_uninstalls' and dim='' and day > d0 - p), 0),
    'last_day',   (select max(day) from analytics_daily where source='play'),
    'last_active',(select value from analytics_daily where source='play' and metric='active_device_installs' and dim=''
                    order by day desc limit 1),
    'series',     coalesce((select jsonb_agg(jsonb_build_object('day', day, 'v', value) order by day)
                              from analytics_daily where source='play' and metric='device_installs' and dim='' and day > d0 - 62), '[]'::jsonb)
  ) into v_and;

  -- ③ 애플 (App Store Connect)
  select jsonb_build_object(
    'first28', coalesce((select sum(value) from analytics_daily where source='apple' and metric='downloads' and dim='type:first'      and day > d0 - p), 0),
    'redl28',  coalesce((select sum(value) from analytics_daily where source='apple' and metric='downloads' and dim='type:redownload' and day > d0 - p), 0),
    'imp28',   coalesce((select sum(value) from analytics_daily where source='apple' and metric='impressions' and dim='' and day > d0 - p), 0),
    'ppv28',   coalesce((select sum(value) from analytics_daily where source='apple' and metric='page_views'  and dim='' and day > d0 - p), 0),
    'impu28',  coalesce((select sum(value) from analytics_daily where source='apple' and metric='impressions_unique' and dim='' and day > d0 - p), 0),  -- 전환율 분모(고유 노출) — 화면이 (최초+재다운로드)÷고유노출 을 계산한다
    'last_day',(select max(day) from analytics_daily where source='apple'),
    'series',  coalesce((select jsonb_agg(jsonb_build_object('day', day, 'v', value) order by day)
                           from analytics_daily where source='apple' and metric='downloads' and dim='type:first' and day > d0 - p), '[]'::jsonb),
    'rank',    (select payload -> 'chart_rank' from analytics_manual where id='app_store')
  ) into v_ios;

  -- ④ 웹→앱 전환 (참고치 — 정확한 퍼널이 아니다. 화면에도 그렇게 적는다)
  select jsonb_build_object(
    'cta28',    coalesce((select sum(value) from analytics_daily where source='ga4' and metric='app_cta' and day > d0 - p), 0),
    'cta_d1',   (select sum(value) from analytics_daily where source='ga4' and metric='app_cta' and day = d0 - 1),   -- 전일 대비용(값이 없으면 null — 0 으로 채우지 않는다)
    'cta_d2',   (select sum(value) from analytics_daily where source='ga4' and metric='app_cta' and day = d0 - 2),
    'dl28',     coalesce((select sum(value) from analytics_daily where source='apple' and metric='downloads' and dim='type:first' and day > d0 - p), 0)
              + coalesce((select sum(value) from analytics_daily where source='play'  and metric='device_installs' and day > d0 - p), 0)
  ) into v_cvr;

  return jsonb_build_object(
    'ok', true, 'today', d0, 'days', p,
    'web', v_web, 'android', v_and, 'apple', v_ios, 'cvr', v_cvr,
    'manual', coalesce((select jsonb_object_agg(id, jsonb_build_object('as_of', as_of, 'payload', payload)) from analytics_manual), '{}'::jsonb),
    'meta', coalesce((select jsonb_agg(jsonb_build_object('source', source, 'status', status, 'note', note,
                                                          'last_ok_at', to_char(last_ok_at at time zone 'Asia/Seoul','MM-DD HH24:MI'),
                                                          'last_try_at', to_char(last_try_at at time zone 'Asia/Seoul','MM-DD HH24:MI'))
                            order by source) from analytics_meta), '[]'::jsonb),
    'served_at', to_char(now() at time zone 'Asia/Seoul','YYYY-MM-DD HH24:MI')
  );
end $$;
revoke all on function public.analytics_overview(integer) from public, anon;
grant execute on function public.analytics_overview(integer) to authenticated;
-- ↑ 관리자 화면은 로그인한 사용자(authenticated) JWT 로 부른다. 권한 판정은 함수 안의 is_app_admin() 이 한다.
--   (ops_status_68.sql 과 같은 규칙 — "명시 grant 는 authenticated 에만". 손님은 로그인 자체를 못 한다)
