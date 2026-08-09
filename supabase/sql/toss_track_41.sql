-- 토스 가격추적: 보낸 요청 번호를 적어 두는 곳 (사장님 지시 2026-08-09)
--
-- 왜 필요한가: [크론 → Edge Function → 다시 pg_net → 토스] 구조라 응답을 기다리면
--   크론 쪽이 먼저 끊긴다(실측 25초에 응답이 오는데 "응답 없음" 이 3번 났다).
--   그래서 요청만 넣어 두고 다음 실행 때 응답을 수거한다. 그 사이 요청 번호를 여기 보관한다.
create table if not exists public.toss_track_pending (
  req_id     bigint primary key,
  created_at timestamptz not null default now()
);
alter table public.toss_track_pending enable row level security;   -- 정책 없음 = service_role 만

-- 수거되지 못하고 남은 찌꺼기는 스스로 지운다(응답이 영영 안 온 경우).
create or replace function public.toss_track_purge() returns void
language sql security definer set search_path = public, net as $$
  delete from public.toss_track_pending where created_at < now() - interval '2 days';
$$;
revoke all on function public.toss_track_purge() from public, anon, authenticated;
