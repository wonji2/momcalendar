-- 챗봇 검색어 별칭 (2026-09-01, 사장님 지시)
--   "그건 하나하나 내가 알려줄 수 없고 너가 질문 받고 데이터 쌓아 학습하면서 판단해야 될 것 같음"
--   → 별칭을 코드가 아니라 **DB** 에 둔다. 재배포 없이 늘릴 수 있고,
--     못 찾은 질문(events.kakao_bot_miss)을 보고 자동/수동으로 채워 넣는 학습 루프의 저장소다.
create table if not exists public.bot_alias (
  term    text primary key,          -- 손님이 치는 말 (예: 뽀사카)
  expand  text not null,             -- 우리 DB 표기 (예: 뽀로로)
  hits    int  not null default 0,   -- 이 별칭으로 실제 결과를 찾은 횟수
  created_at timestamptz default now()
);
alter table public.bot_alias enable row level security;
drop policy if exists bot_alias_read on public.bot_alias;
create policy bot_alias_read on public.bot_alias for select using (true);   -- 읽기만 공개(챗봇용)

insert into public.bot_alias(term, expand) values
  ('뽀사카','뽀로로'), ('빼빼구마','룰루맘'), ('레꼴드','레꼴뜨'),
  ('크렛','kret'), ('바스','bas'), ('웩','weck')
on conflict (term) do nothing;
