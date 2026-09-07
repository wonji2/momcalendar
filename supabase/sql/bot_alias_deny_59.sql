-- 🚫 별칭 금지표 (2026-09-07, 사장님 판정) — 자동학습(bot_learn)이 다시 배우면 안 되는 오타 짝
--   아토팜(화장품)≠아이팜(세면대·디딤대) · 보르르≠보아르 — 둘 다 "다른 브랜드" 로 사장님 확정. bot_learn 이 넣기 전에 여기를 본다.
create table if not exists public.bot_alias_deny (
  term   text not null,
  expand text not null,
  note   text,
  created_at timestamptz not null default now(),
  primary key (term, expand)
);
alter table public.bot_alias_deny enable row level security;
insert into public.bot_alias_deny(term, expand, note) values
  ('아토팜', '아이팜', '다른 브랜드 (사장님 2026-09-07)'),
  ('보르르', '보아르', '다른 브랜드 (사장님 2026-09-07)')
on conflict do nothing;
