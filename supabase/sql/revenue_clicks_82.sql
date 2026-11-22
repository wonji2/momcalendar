-- 💰 수익링크 종류별 집계 (사장님 지시 2026-10-06
--    *"맘캘린더 관리자페이지에 내 수익링크 종류(쿠팡, 네이버, 링크프라이스 등) 나열해서 수익 얼만지 합계보이게"*)
--
-- ⚠ **정산액(실제 수익)은 이 DB 에 없다.** 쿠팡 파트너스·링크프라이스·토스의 수익 리포트는
--    각 제휴사 계정에서만 나오고, 이 컴퓨터엔 그 키가 없다(tools/daily/.env 확인함).
--    그래서 지금 낼 수 있는 건 **등록 건수와 클릭 수**다 — 수익의 앞단 지표다.
--    정산액을 붙이려면 ①제휴사 API 키를 받거나 ②사장님이 월별 금액을 적어 넣어야 한다.
--
-- 🔑 클릭은 events.event_type='hotdeal_open' 에 쌓인다.
--    event_data 가 {"id":1081,"s":"linkprice","n":"상품명","p":29950} 꼴이라
--    **종류(s)가 그 안에 그대로 있다** — hotdeals 와 조인하지 않아도 된다(조인하면 지워진 딜을 놓친다).

create or replace function public.revenue_by_source(p_days int default 30)
returns table(
  종류 text, 등록 bigint, 노출중 bigint, 클릭 bigint,
  클릭당_정가합 numeric, 마지막등록 text
)
language sql stable security definer set search_path = public as $$
  with c as (
    select coalesce(nullif(e.event_data::jsonb ->> 's', ''), '(모름)') as src,
           count(*) as clicks
      from public.events e
     where e.event_type = 'hotdeal_open'
       and e.visited_at > now() - make_interval(days => p_days)
       and e.event_data ~ '^\s*\{'
     group by 1
  ), h as (
    select coalesce(nullif(source, ''), '(없음)') as src,
           count(*) as regs,
           count(*) filter (where coalesce(expires_at, now() + interval '1 day') > now()) as live,
           sum(coalesce(price, 0)) as amt,
           max((created_at at time zone 'Asia/Seoul')::date)::text as last_reg
      from public.hotdeals
     where created_at > now() - make_interval(days => p_days)
     group by 1
  )
  select coalesce(h.src, c.src)                as 종류,
         coalesce(h.regs, 0)                   as 등록,
         coalesce(h.live, 0)                   as 노출중,
         coalesce(c.clicks, 0)                 as 클릭,
         coalesce(h.amt, 0)::numeric           as 클릭당_정가합,
         coalesce(h.last_reg, '-')             as 마지막등록
    from h full outer join c on c.src = h.src
   order by 4 desc, 2 desc
$$;

grant execute on function public.revenue_by_source(int) to authenticated;

select * from public.revenue_by_source(30);
