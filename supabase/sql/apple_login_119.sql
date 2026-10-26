-- 애플로 로그인 (2026-10-27 · 애플 App Review 4.8 · developer.apple.com/documentation/signinwithapple/verifying-a-user)
--   서버(apple-auth 엣지 함수)가 identity token 을 검증한다: 서명(JWKS RS256)·iss=https://appleid.apple.com·aud=번들 ID·exp·nonce.
--   nonce 는 한 번만 — 같은 토큰을 다시 보내 로그인하는 재생 공격 방지(아래 표에 nonce 해시를 남긴다).
create table if not exists public.apple_nonce_used (
  nonce_hash text primary key,
  used_at timestamptz not null default now()
);
alter table public.apple_nonce_used enable row level security;   -- 정책 없음 = service_role(엣지 함수)만
create index if not exists apple_nonce_used_at on public.apple_nonce_used(used_at);
select 'ok' r;
