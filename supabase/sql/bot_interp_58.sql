-- 🧠 챗봇 해석 사전 bot_interp (2026-09-06, 사장님 지시 "돈을 쓰는만큼 무조건 학습해서 … ai안써도 되게")
--   AI(Haiku)가 낸 {intent,q,cat} 를 손님 말(정규화) 단위로 저장한다. 같은 말은 두 번 AI 에 안 간다.
--   설계 원본: scratchpad/챗봇AI도입_계획.md 8-2. 읽는 곳: kakao-skill interpLookup / 쓰는 곳: interpAI (서비스 키)
create table if not exists public.bot_interp (
  utt_norm   text primary key,               -- 정규화한 손님 말 (normUtt)
  utt        text,                           -- 원문 샘플
  intent     text not null,                  -- search|today|tomorrow|week|weekend|closing|popular|hotdeal|greeting|thanks|other
  q          text not null default '',       -- search 일 때 찾을 낱말
  cat        text not null default '',
  src        text not null default 'ai',     -- ai | human | log
  model      text,
  in_tok     int  not null default 0,
  out_tok    int  not null default 0,
  hits       int  not null default 0,        -- 사전에서 답한 횟수 = 아낀 호출 수
  ok_cards   boolean not null default false, -- 그 해석으로 카드가 나온 적 있나 (false 이면서 hits 많으면 재해석 후보)
  created_at timestamptz not null default now(),
  last_at    timestamptz not null default now()
);
alter table public.bot_interp enable row level security;
drop policy if exists bot_interp_read on public.bot_interp;
create policy bot_interp_read on public.bot_interp for select using (true);   -- 챗봇(anon)은 읽기만. 쓰기는 서비스 키

-- 사전 히트 기록 (anon 이 부른다 — 카운터만 올리므로 security definer)
create or replace function public.bot_interp_hit(p_utt text, p_ok boolean)
returns void
language sql security definer set search_path = public as $$
  update public.bot_interp
     set hits = hits + 1,
         ok_cards = ok_cards or p_ok,
         last_at = now()
   where utt_norm = p_utt;
$$;
revoke all on function public.bot_interp_hit(text, boolean) from public;
grant execute on function public.bot_interp_hit(text, boolean) to anon, authenticated, service_role;
