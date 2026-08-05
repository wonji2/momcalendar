-- 셀러 프로필 통계 (크몽 데이터 상품용)
-- gonggu.insta 기준. sellers 테이블은 이웃셀러 관리용이고 insta 중복이 있어 따로 둔다.
create table if not exists public.seller_profile (
  insta        text primary key,
  followers    bigint,
  full_name    text,          -- 인스타 표시 이름
  is_private   boolean,
  is_verified  boolean,
  checked_at   timestamptz default now()
);

comment on table public.seller_profile is '셀러 인스타 공개 프로필 스냅샷 — 데이터 상품용. 연락처·이메일은 절대 저장하지 않는다.';

-- 관리자만 접근 (RLS on + 정책 없음 = service_role 만)
alter table public.seller_profile enable row level security;

create index if not exists seller_profile_followers_idx on public.seller_profile (followers desc nulls last);
