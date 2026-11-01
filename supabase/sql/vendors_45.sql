-- 공급사·벤더사 일정 등록 대행 (사장님 지시 2026-09-01)
--
-- 왜: 셀러 셀프등록은 무료지만, 공급사·벤더사가 맡기는 일정은 유료다.
--     "이번 계약에서 몇 건 썼는지" 를 셀 수 있어야 정산이 된다.
--     지금 gonggu 에는 등록 시각도, 누구 몫인지도 없어서 셀 방법이 아예 없었다.

-- 1) 계약 마스터
create table if not exists public.vendors (
  id          bigserial primary key,
  name        text not null unique,                    -- 공급사명 (표시용)
  plan        text not null default 'basic',           -- basic(60건) | premium(120건)
  quota       int  not null default 60,                -- 계약 건수 (2개월 단위)
  start_date  date not null,
  end_date    date not null,
  cafe_enabled boolean not null default true,          -- 카페 게시 대상인지
  memo        text,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
alter table public.vendors enable row level security;   -- 정책 없음 = 관리자 RPC 로만 접근

-- 2) gonggu 에 "누구 몫 / 언제 등록" 을 남긴다
alter table public.gonggu add column if not exists vendor_id bigint references public.vendors(id);
-- ⚠ created_at 은 default 를 나중에 건다. 지금 default 를 걸면 기존 3천여 행이 전부
--   '오늘 등록' 으로 채워져 집계가 거짓이 된다. 기존 행은 null(=등록일 미상) 로 두는 게 정확하다.
alter table public.gonggu add column if not exists created_at timestamptz;
alter table public.gonggu alter column created_at set default now();
create index if not exists gonggu_vendor_idx on public.gonggu(vendor_id) where vendor_id is not null;

-- 3) 계약 현황 (소진 건수 포함)
create or replace function public.admin_vendor_list()
returns table(id bigint, name text, plan text, quota int, used int, remain int,
              start_date date, end_date date, days_left int, cafe_enabled boolean,
              active boolean, memo text)
language sql security definer set search_path = public as $$
  select v.id, v.name, v.plan, v.quota,
         coalesce(u.cnt, 0)::int as used,
         (v.quota - coalesce(u.cnt, 0))::int as remain,
         v.start_date, v.end_date,
         (v.end_date - (now() at time zone 'Asia/Seoul')::date)::int as days_left,
         v.cafe_enabled, v.active, v.memo
    from vendors v
    left join (
      -- 계약 기간 안에 등록된 건만 센다 (등록 시각 기준)
      select g.vendor_id, count(*) cnt
        from gonggu g join vendors vv on vv.id = g.vendor_id
       where g.created_at is not null
         and (g.created_at at time zone 'Asia/Seoul')::date between vv.start_date and vv.end_date
       group by g.vendor_id
    ) u on u.vendor_id = v.id
   order by v.active desc, v.end_date desc, v.name;
$$;

-- 4) 계약 등록·수정 (id 를 주면 수정, 없으면 신규)
create or replace function public.admin_vendor_upsert(
  p_id bigint, p_name text, p_plan text, p_quota int,
  p_start date, p_end date, p_cafe boolean, p_active boolean, p_memo text)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  if p_id is null then
    insert into vendors(name, plan, quota, start_date, end_date, cafe_enabled, active, memo)
    values (p_name, coalesce(p_plan,'basic'), coalesce(p_quota,60), p_start, p_end,
            coalesce(p_cafe,true), coalesce(p_active,true), p_memo)
    returning id into v_id;
  else
    update vendors set name=p_name, plan=coalesce(p_plan,plan), quota=coalesce(p_quota,quota),
           start_date=p_start, end_date=p_end, cafe_enabled=coalesce(p_cafe,cafe_enabled),
           active=coalesce(p_active,active), memo=p_memo
     where id=p_id returning id into v_id;
  end if;
  return v_id;
end $$;

-- 5) 그 공급사 공구 목록 (정산 근거)
create or replace function public.admin_vendor_gonggu(p_vendor bigint, p_limit int default 200)
returns table(id bigint, name text, insta text, influencer text,
              open_date text, end_date text, major text, approved boolean, reg_day date)
language sql security definer set search_path = public as $$
  select g.id, g.name, g.insta, g.influencer, g.open_date, g.end_date, g.major, g.approved,
         (g.created_at at time zone 'Asia/Seoul')::date
    from gonggu g where g.vendor_id = p_vendor
   order by g.created_at desc nulls last, g.id desc limit coalesce(p_limit,200);
$$;

revoke execute on function public.admin_vendor_list() from public, anon;
revoke execute on function public.admin_vendor_upsert(bigint,text,text,int,date,date,boolean,boolean,text) from public, anon;
revoke execute on function public.admin_vendor_gonggu(bigint,int) from public, anon;
