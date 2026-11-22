-- 💰 수익링크 **실제 정산액**을 담는 표 (사장님 지시 2026-10-06 "니가 키 자동으로 받아서 해")
--
-- 지금까지 관리자에 보여줄 수 있던 건 **클릭 수뿐**이었다(revenue_by_source, 82번).
-- 쿠팡은 COUPANG_ACCESS_KEY/SECRET 가 Supabase 시크릿에 이미 있어(coupang-hotdeal 함수가 쓴다)
-- 파트너스 리포트 API 로 **커미션을 직접 받아올 수 있다.** 그걸 하루 한 줄로 쌓는다.
--
-- 🔑 날짜 × 종류로 유일하다 — 같은 날을 다시 받아도 덮어쓰기만 되고 쌓이지 않는다
--    (메모리 delete-and-upsert-dont-mix — 지우고 넣지 않는다. upsert 한 번으로 끝낸다).
-- 🔑 금액은 원 단위 정수. 쿠팡 리포트는 소수점이 없다.

create table if not exists public.revenue_daily (
  day        date   not null,
  source     text   not null,                 -- coupang · linkprice · toss …
  clicks     int,                             -- 제휴사가 센 클릭(우리 events 와 다를 수 있다)
  orders     int,
  gmv        bigint,                          -- 거래액
  commission bigint,                          -- 💰 실제 수익
  raw        jsonb,                            -- 원문 한 줄 (나중에 항목이 늘어도 다시 받지 않게)
  updated_at timestamptz not null default now(),
  primary key (day, source)
);

comment on table public.revenue_daily is '제휴사별 일별 정산액. coupang-revenue 엣지함수가 매일 채운다 (2026-10-06)';

-- 손님에게 열지 않는다 — 관리자(authenticated)만 읽는다
revoke all on public.revenue_daily from anon;
grant select on public.revenue_daily to authenticated;

-- 82번 함수에 **실제 수익**을 얹는다
-- ⚠ 돌려주는 칸이 바뀌면 create or replace 가 안 된다 — 먼저 지운다(82번은 이 파일이 대체한다)
drop function if exists public.revenue_by_source(int);
create or replace function public.revenue_by_source(p_days int default 30)
returns table(
  종류 text, 등록 bigint, 노출중 bigint, 클릭 bigint,
  수익 bigint, 거래액 bigint, 마지막등록 text
)
language sql stable security definer set search_path = public as $$
  with c as (
    select coalesce(nullif(e.event_data::jsonb ->> 's', ''), '(모름)') as src, count(*) as clicks
      from public.events e
     where e.event_type = 'hotdeal_open'
       and e.visited_at > now() - make_interval(days => p_days)
       and e.event_data ~ '^\s*\{'
     group by 1
  ), h as (
    select coalesce(nullif(source, ''), '(없음)') as src,
           count(*) as regs,
           count(*) filter (where coalesce(expires_at, now() + interval '1 day') > now()) as live,
           max((created_at at time zone 'Asia/Seoul')::date)::text as last_reg
      from public.hotdeals
     where created_at > now() - make_interval(days => p_days)
     group by 1
  ), r as (
    select source as src, sum(coalesce(commission,0))::bigint as com, sum(coalesce(gmv,0))::bigint as gmv
      from public.revenue_daily
     where day > (now() at time zone 'Asia/Seoul')::date - p_days
     group by 1
  )
  select coalesce(h.src, c.src, r.src)  as 종류,
         coalesce(h.regs, 0)            as 등록,
         coalesce(h.live, 0)            as 노출중,
         coalesce(c.clicks, 0)          as 클릭,
         coalesce(r.com, 0)             as 수익,
         coalesce(r.gmv, 0)             as 거래액,
         coalesce(h.last_reg, '-')      as 마지막등록
    from h
    full outer join c on c.src = h.src
    full outer join r on r.src = coalesce(h.src, c.src)
   order by 5 desc, 4 desc, 2 desc
$$;

grant execute on function public.revenue_by_source(int) to authenticated;

select 'revenue_daily 칸수' k, count(*)::text v from information_schema.columns where table_name='revenue_daily';
