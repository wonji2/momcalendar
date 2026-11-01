-- 챗봇 검색어 별칭 (2026-09-01, 사장님 지시)
--   "그건 하나하나 내가 알려줄 수 없고 너가 질문 받고 데이터 쌓아 학습하면서 판단해야 될 것 같음"
--   → 별칭을 코드가 아니라 **DB** 에 둔다. 재배포 없이 늘릴 수 있고,
--     못 찾은 질문(events.kakao_bot_miss)을 보고 자동/수동으로 채워 넣는 학습 루프의 저장소다.
-- ⚠ 2026-09-21: 키가 (term) → (term, expand) 로 넓어졌다 — 한 말이 두 브랜드를 가리킬 수 있다
--   (사장님 "아기김은 우아한김이랑 또또맘"). 새로 만들 때도 이 키로 만든다. 원본 supabase/sql/bot_alias_multi_60.sql
create table if not exists public.bot_alias (
  term    text not null,             -- 손님이 치는 말 (예: 뽀사카)
  expand  text not null,             -- 우리 DB 표기 (예: 뽀로로)
  hits    int  not null default 0,   -- 이 별칭으로 실제 결과를 찾은 횟수
  created_at timestamptz default now(),
  primary key (term, expand)
);
-- 옛 판(PK=term)으로 이미 만들어져 있으면 여기서 넓힌다 — 복구 때 이 파일만 돌려도 되게.
alter table public.bot_alias drop constraint if exists bot_alias_pkey;
alter table public.bot_alias add  constraint bot_alias_pkey primary key (term, expand);
alter table public.bot_alias enable row level security;
drop policy if exists bot_alias_read on public.bot_alias;
create policy bot_alias_read on public.bot_alias for select using (true);   -- 읽기만 공개(챗봇용)

insert into public.bot_alias(term, expand) values
  ('뽀사카','뽀로로'), ('빼빼구마','룰루맘'), ('레꼴드','레꼴뜨'),
  ('크렛','kret'), ('바스','bas'), ('웩','weck')
on conflict do nothing;
