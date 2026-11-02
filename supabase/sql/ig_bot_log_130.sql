create table if not exists public.ig_bot_log(
  comment_id text primary key,
  status text,
  note text,
  at timestamptz default now(),
  done_at timestamptz
);
alter table public.ig_bot_log enable row level security;
revoke all on public.ig_bot_log from anon, authenticated;
create index if not exists ig_bot_log_done_idx on public.ig_bot_log(done_at desc);
select relrowsecurity from pg_class where relname='ig_bot_log';
