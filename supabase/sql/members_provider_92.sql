-- 네이버 로그인 (2026-10-24): members 에 어느 쪽으로 가입했는지. 회원 키는 그대로 kakao_id(text) — 네이버는 'naver:<id>' 로 들어간다.
alter table public.members add column if not exists provider text not null default 'kakao';
