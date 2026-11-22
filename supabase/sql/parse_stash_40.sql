-- 파싱 임시 보관함 (사장님 지시 2026-08-06)
-- 브라우저 탭이 닫히면 수집분이 통째로 날아간다(오늘 두 번 겪음).
-- 모으는 즉시 서버에 넣어 두고, 승인표는 여기서 뽑는다.
create table if not exists public.parse_stash(
  id         bigserial primary key,
  insta      text not null,
  name       text not null,
  open_date  text,
  end_date   text,
  est        boolean default false,   -- 날짜를 추정한 건(오픈+3 등)
  src        text,                    -- 근거(게시일 등)
  batch      text,                    -- 수집 회차
  created_at timestamptz default now(),
  unique (insta, name, open_date)
);
alter table public.parse_stash enable row level security;
revoke all on table public.parse_stash from anon, authenticated;

-- 브라우저에서 바로 넣을 수 있게 (service_role 전용)
create or replace function public.stash_put(p jsonb)
returns int language plpgsql security definer set search_path = public
as $$
declare n int;
begin
  insert into public.parse_stash(insta, name, open_date, end_date, est, src, batch)
  select x->>'h', x->>'nm', x->>'o', x->>'e', coalesce((x->>'est')::boolean,false), x->>'src', x->>'batch'
  from jsonb_array_elements(p) x
  on conflict (insta, name, open_date) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.stash_put(jsonb) from public, anon, authenticated;
grant execute on function public.stash_put(jsonb) to service_role;

select count(*) 보관중 from public.parse_stash;
