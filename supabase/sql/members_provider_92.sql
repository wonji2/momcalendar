-- 네이버 로그인 (2026-10-24): members 에 어느 쪽으로 가입했는지. 회원 키는 그대로 kakao_id(text) — 네이버는 'naver:<id>' 로 들어간다.
alter table public.members add column if not exists provider text not null default 'kakao';
-- 네이버 로그인 「추가(선택)」 동의 항목 — 회원 분포 통계용 (사장님 2026-10-24 "연령대나 성별 정도는 회원 분포도 db 모을 때 좋을 것 같은데")
--  gender: 'F' | 'M' | 'U'(네이버가 준 값 그대로) · age_range: '30-39' 같은 네이버 연령대 문자열. 동의 안 하면 null.
alter table public.members add column if not exists gender text;
alter table public.members add column if not exists age_range text;
