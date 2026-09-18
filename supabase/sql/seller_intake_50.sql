-- 셀러 정산정보 온보딩 (원츠비 벤더사용) — 2026-09-18
--
-- 왜: 셀러에게 이름·연락처·이메일·채널·사업자번호(또는 주민번호)·샘플 주소·정산 계좌를 받아야 하는데
--     카톡으로 주고받으면 사장님 휴대폰과 채팅방에 평문으로 남는다. 초대링크 1회용 폼으로 받아
--     Supabase 에 암호화 저장하고, 노션에는 마스킹본만 자동으로 쌓는다.
--
-- 보안 기준 (중요)
--   · 이 두 표는 **RLS 켜고 정책을 하나도 두지 않는다** → anon·authenticated 키로는 읽기·쓰기 전부 불가.
--     쓰기·읽기는 service_role 을 쥔 Edge Function `seller-intake` 한 곳으로만 들어온다.
--   · 주민등록번호·계좌번호는 **Edge Function 에서 AES-256-GCM 으로 암호화**해 base64 로 넣는다.
--     키(INTAKE_ENC_KEY)는 Supabase 시크릿에만 있고 DB 에는 없다 → DB 가 통째로 새도 두 값은 못 읽는다.
--   · 목록 화면용으로 계좌 끝 4자리(acct_last4)만 평문으로 둔다.
--   · 관리자가 전체 값을 열어볼 때마다 seller_intake_audit 에 남는다.

create table if not exists public.seller_invite (
  token       text primary key,                    -- 초대 링크 코드(32 hex). 추측 불가·1회용
  label       text not null,                       -- 누구에게 보냈는지 (셀러명/메모)
  memo        text,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,                -- 기본 7일
  used_at     timestamptz,                         -- 제출되면 찍힌다 (재사용 차단)
  revoked     boolean not null default false
);

create table if not exists public.seller_intake (
  id            bigserial primary key,
  token         text references public.seller_invite(token),
  -- 기본 정보
  seller_name   text not null,                     -- 셀러명/채널명
  owner_name    text not null,                     -- 대표자 실명
  phone         text not null,
  email         text,
  -- 채널
  channel_url   text,
  followers     integer,
  -- 정산 유형
  settle_type   text not null check (settle_type in ('business','freelancer')),
  biz_name      text,                              -- 사업자명
  biz_no        text,                              -- 사업자등록번호(공개정보라 평문)
  rrn_enc       text,                              -- 주민등록번호 (암호문, 프리랜서만)
  rrn_masked    text,                              -- 표시용 900101-1******
  -- 샘플 수령 주소
  zipcode       text,
  addr1         text,
  addr2         text,
  -- 정산 계좌
  bank          text not null,
  acct_enc      text not null,                     -- 계좌번호 (암호문)
  acct_last4    text,                              -- 목록·노션 표시용
  acct_holder   text not null,
  -- 동의·접수 기록
  agreed        boolean not null default false,
  agreed_at     timestamptz,
  consent_ver   text,
  ip_hash       text,                              -- 원문 IP 는 저장하지 않는다
  ua            text,
  -- 노션 동기화 상태
  notion_page_id   text,
  notion_synced_at timestamptz,
  notion_error     text,
  status        text not null default 'new',       -- new | checked | hold
  created_at    timestamptz not null default now()
);

create index if not exists seller_intake_created_idx on public.seller_intake (created_at desc);
create index if not exists seller_intake_notion_idx  on public.seller_intake (notion_synced_at) where notion_synced_at is null;

-- 관리자가 주민번호·계좌 전체를 열람한 기록 (보안 사고 시 추적용)
create table if not exists public.seller_intake_audit (
  id         bigserial primary key,
  intake_id  bigint not null references public.seller_intake(id),
  admin_uid  uuid,
  action     text not null,                        -- reveal_acct | reveal_rrn | list
  at         timestamptz not null default now()
);

-- 접수 폭주·장난 제출 방어용 (IP 해시당 시간별 건수)
create table if not exists public.seller_intake_rate (
  ip_hash   text not null,
  hour_key  text not null,
  n         integer not null default 1,
  primary key (ip_hash, hour_key)
);

-- 🔒 셋 다 공개 키로는 손도 못 대게 한다
alter table public.seller_invite        enable row level security;
alter table public.seller_intake        enable row level security;
alter table public.seller_intake_audit  enable row level security;
alter table public.seller_intake_rate   enable row level security;
revoke all on public.seller_invite       from anon, authenticated;
revoke all on public.seller_intake       from anon, authenticated;
revoke all on public.seller_intake_audit from anon, authenticated;
revoke all on public.seller_intake_rate  from anon, authenticated;
revoke all on sequence public.seller_intake_id_seq       from anon, authenticated;
revoke all on sequence public.seller_intake_audit_id_seq from anon, authenticated;

-- 2026-09-18 추가: 사업자 과세유형 (사장님 지시)
--   일반과세자 → 세금계산서 발행 필수 / 간이과세자 → 부가세액 제외 후 현금영수증 처리
--   (노션 「셀러 소개용(공유용)」 정산 공통 규칙과 같은 기준)
alter table public.seller_intake add column if not exists biz_type text
  check (biz_type in ('general','simplified'));
