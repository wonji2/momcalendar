-- 🔄 손님이 말을 바꿔 다시 쳐서 성공한 쌍 → 사장님 검토판 (2026-09-04)
--
-- 사장님 지시: "1번하고 2번" 중 **1번** — AI 를 안 쓰고 학습한다.
--
-- 왜 이게 공짜로 되나:
--   손님이 "반참통" 을 치고 못 찾자 3분 안에 "반찬통" 을 쳐서 찾았다.
--   **정답이 이미 우리 로그 안에 있다.** 손님이 우리 대신 고쳐준 것이다.
--   `bot_guard` ⑤ 가 이미 이 쌍을 찾아내고 있었는데, 로그에만 찍고 버렸다.
--   이제 여기 쌓아 사장님이 버튼 한 번으로 별칭을 확정한다.
--
-- ⚠ 자동 등록하지 않는 이유:
--   손님이 아예 다른 걸 물었을 수도 있다("물티슈" 실패 → "기저귀" 성공).
--   그러면 물티슈→기저귀 라는 엉뚱한 별칭이 생긴다. 판단은 사람이 한다.
--
-- 실측 근거(2026-09-04): 하루에 4쌍이 잡혔다 —
--   반참통→반찬통 · 베게→베개 · 톤캐→톤캬 · **보르르→분유포트**
--   마지막 것은 오타가 아니라 **브랜드↔품목명 매핑**이라 자동학습(편집거리)으로는 절대 못 배운다.

create table if not exists public.bot_pair (
  wrong       text not null,                     -- 손님이 처음 친 말 (우리가 못 찾은 것)
  right_word  text not null,                     -- 손님이 바꿔 쳐서 성공한 말
  cnt         integer not null default 1,        -- 같은 쌍이 몇 번 나왔나
  status      text    not null default 'wait',   -- wait | ok | no
  decided_at  timestamptz,
  created_at  timestamptz not null default now(),
  primary key (wrong, right_word)
);
alter table public.bot_pair enable row level security;   -- 정책 없음 = 서버 전용

-- 감지기(bot_guard)가 넣는다. 이미 판정한 쌍은 다시 대기로 돌리지 않는다.
create or replace function public.bot_pair_add(p_wrong text, p_right text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if coalesce(trim(p_wrong),'') = '' or coalesce(trim(p_right),'') = '' then return; end if;
  if trim(p_wrong) = trim(p_right) then return; end if;
  insert into public.bot_pair(wrong, right_word)
       values (trim(p_wrong), trim(p_right))
  on conflict (wrong, right_word) do update
       set cnt = public.bot_pair.cnt + 1
     where public.bot_pair.status = 'wait';       -- 판정 끝난 쌍은 건드리지 않는다
end $$;

-- 관리자 검토판 조회
create or replace function public.admin_bot_pairs(p_limit int default 50)
returns table(wrong text, right_word text, cnt int, created_at timestamptz)
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_app_admin() then raise exception 'forbidden'; end if;
  return query
    select p.wrong, p.right_word, p.cnt, p.created_at
      from public.bot_pair p
     where p.status = 'wait'
     order by p.cnt desc, p.created_at desc
     limit greatest(1, least(coalesce(p_limit,50), 200));
end $$;

-- 사장님이 버튼을 누르면: ok 면 별칭에 넣고, no 면 다시 안 올라오게만 한다.
create or replace function public.admin_bot_pair_decide(p_wrong text, p_right text, p_ok boolean)
returns text language plpgsql security definer set search_path = public as $$
begin
  if not public.is_app_admin() then raise exception 'forbidden'; end if;
  update public.bot_pair
     set status = case when p_ok then 'ok' else 'no' end, decided_at = now()
   where wrong = trim(p_wrong) and right_word = trim(p_right);
  if not found then return 'notfound'; end if;

  if p_ok then
    -- 별칭은 kakao-skill 이 양방향으로 푼다(term↔expand) — 방향을 고민할 필요가 없다.
    insert into public.bot_alias(term, expand)
         values (trim(p_wrong), trim(p_right))
    on conflict do nothing;
    return 'ok';
  end if;
  return 'no';
end $$;

revoke execute on function public.bot_pair_add(text,text)            from public, anon;
revoke execute on function public.admin_bot_pairs(int)               from public, anon;
revoke execute on function public.admin_bot_pair_decide(text,text,boolean) from public, anon;
grant  execute on function public.admin_bot_pairs(int)               to authenticated;
grant  execute on function public.admin_bot_pair_decide(text,text,boolean) to authenticated;
