-- 🙋 챗봇 말투 사장님 검토 (2026-09-01, 사장님 지시 "나한테 검토맡아 그럼")
--   챗봇이 못 알아들은 말 중 자동으로 못 배우는 것(= 말투 문제)을 사장님이 직접 판정한다.
--   판정하면 bot_phrase 에 들어가고 챗봇이 매 요청 때 읽으므로 **재배포 없이 즉시** 반영된다.

-- ① 판정 대기 목록 (bot_learn.mjs 가 매시 채운다)
create table if not exists public.bot_review (
  term       text primary key,
  sample     text,                       -- 손님이 실제로 친 원문
  cnt        int  not null default 1,
  status     text not null default 'wait',   -- wait | done | skip
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.bot_review enable row level security;   -- 관리자 RPC 로만 접근

-- ② 사장님이 확정한 말투 (챗봇이 읽는다)
create table if not exists public.bot_phrase (
  term    text primary key,
  kind    text not null,                 -- hello | thanks | praise | bye | love
  created_at timestamptz not null default now()
);
alter table public.bot_phrase enable row level security;
drop policy if exists bot_phrase_read on public.bot_phrase;
create policy bot_phrase_read on public.bot_phrase for select using (true);   -- 챗봇이 읽기만

-- ③ 관리자: 판정 대기 목록
create or replace function public.admin_bot_review(p_limit int default 30)
returns table(term text, sample text, cnt int, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_app_admin() then return; end if;
  return query select r.term, r.sample, r.cnt, r.created_at
    from bot_review r where r.status = 'wait'
   order by r.cnt desc, r.created_at desc limit greatest(1, least(p_limit, 100));
end $$;

-- ④ 관리자: 판정 (kind 가 'skip' 이면 그냥 목록에서 내린다)
create or replace function public.admin_bot_decide(p_term text, p_kind text)
returns text
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_app_admin() then return '권한 없음'; end if;
  if p_kind in ('hello','thanks','praise','bye','love') then
    insert into bot_phrase(term, kind) values (lower(trim(p_term)), p_kind)
      on conflict (term) do update set kind = excluded.kind;
    update bot_review set status = 'done', decided_at = now() where term = p_term;
    return '반영됨';
  end if;
  update bot_review set status = 'skip', decided_at = now() where term = p_term;
  return '넘김';
end $$;

-- ⑤ bot_learn.mjs 가 대기 목록을 채울 때 쓴다 (관리자 CLI 로만 호출)
create or replace function public.bot_review_add(p_term text, p_sample text, p_cnt int)
returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into bot_review(term, sample, cnt) values (p_term, p_sample, greatest(1, p_cnt))
    on conflict (term) do update
      set cnt = greatest(bot_review.cnt, excluded.cnt),
          sample = coalesce(nullif(excluded.sample,''), bot_review.sample)
    where bot_review.status = 'wait';   -- 이미 판정한 건 되살리지 않는다
end $$;

revoke all on function public.admin_bot_review(int)          from public, anon;
revoke all on function public.admin_bot_decide(text,text)     from public, anon;
revoke all on function public.bot_review_add(text,text,int)   from public, anon;
grant execute on function public.admin_bot_review(int)        to authenticated, service_role;
grant execute on function public.admin_bot_decide(text,text)  to authenticated, service_role;
grant execute on function public.bot_review_add(text,text,int) to service_role;
grant select on public.bot_phrase to anon;
