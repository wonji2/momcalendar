-- 상품명 정리 사전 (2026-11-04) — Edge 함수 name-clean 이 AI 결과를 쌓는다. 같은 이름은 두 번 AI 에 안 간다. 서비스 키만 읽고 쓴다.
create table if not exists public.name_clean_dict (
  src_name   text primary key,
  clean      text not null,
  src        text not null default 'ai',
  model      text,
  created_at timestamptz not null default now()
);
alter table public.name_clean_dict enable row level security;
revoke all on public.name_clean_dict from anon, authenticated;
