-- 셀러 연락처 보관함 (사장님 지시 2026-08-19)
--   "폰이랑 이메일 수확 가능하면 db등록 승인표 말고 셀러 연락처 db따로 만들어서 거기 저장해놔 내가 쓰게"
--
-- 무엇을 담나: 셀러가 **자기 인포크·프로필에 공개해 둔 사업용 연락처**(비즈니스 문의 메일, C/S 번호).
--   승인표(공구 등록용)와 완전히 분리한다 — 승인표는 사장님 결재판이지 연락처 장부가 아니다.
--
-- 🔴 보안: RLS on · 정책 없음 = **service_role(관리자)만 접근**.
--   2026-07-23 사고를 반복하지 않기 위함 — 그때 sellers 가 공개 조회 가능해서
--   **셀러 비밀번호 해시 18개**가 방문자 모두에게 내려가고 있었다.
--   연락처는 그보다 더 민감하다. 공개 anon 키로는 한 줄도 읽히면 안 된다.
--
-- ⚠ 활용 제한(법): 수집·보관은 정당한 업무 목적이지만, 이 명단으로 **광고·홍보성 문자/메일**을 보내려면
--   정보통신망법 제50조에 따라 **수신동의가 별도로 필요**하다. 입점 문의·업무 연락은 해당 없음.

create table if not exists public.seller_contacts (
  id          bigserial primary key,
  insta       text        not null,                 -- 인스타 핸들 (gonggu.insta 와 같은 키)
  kind        text        not null,                 -- email | phone | kakao | url
  value       text        not null,
  context     text,                                 -- 어디에 적혀 있었는지 (블록 제목 일부)
  source      text        not null default 'inpock',-- inpock | profile | 제보
  source_slug text,                                 -- 인포크 슬러그 (핸들과 다를 수 있다)
  first_seen  timestamptz not null default now(),
  last_seen   timestamptz not null default now(),
  constraint seller_contacts_kind_ck check (kind in ('email','phone','kakao','url'))
);

-- 같은 셀러의 같은 연락처는 한 줄. 다시 보이면 last_seen 만 올린다.
create unique index if not exists seller_contacts_uk
  on public.seller_contacts (insta, kind, value);

create index if not exists seller_contacts_insta_idx on public.seller_contacts (insta);

alter table public.seller_contacts enable row level security;
-- 정책을 만들지 않는다 → anon·authenticated 는 접근 불가, service_role 만 가능
revoke all on public.seller_contacts from anon, authenticated;

-- 적재용 RPC — 있으면 last_seen 갱신, 없으면 새로 넣는다.
--   ⚠ SECURITY DEFINER 함수는 search_path 를 고정한다(2026-07-23 보안정비 때 전 함수에 적용한 규칙).
create or replace function public.seller_contact_upsert(p jsonb)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  n integer := 0;
  r jsonb;
begin
  for r in select * from jsonb_array_elements(p)
  loop
    insert into public.seller_contacts (insta, kind, value, context, source, source_slug)
    values (
      r->>'insta', r->>'kind', r->>'value',
      left(coalesce(r->>'context',''), 200),
      coalesce(r->>'source','inpock'),
      r->>'source_slug'
    )
    on conflict (insta, kind, value)
      do update set last_seen = now(),
                    context   = coalesce(excluded.context, public.seller_contacts.context);
    n := n + 1;
  end loop;
  return n;
end;
$$;

revoke all on function public.seller_contact_upsert(jsonb) from anon, authenticated;

-- 사장님이 볼 때 쓰는 조회 (관리자 화면에서 service_role 로 호출)
create or replace function public.admin_seller_contacts()
returns table (insta text, 한글명 text, email text, phone text, 공구수 bigint, 최근공구 text)
language sql
security definer
set search_path = public, pg_temp
as $$
  select c.insta,
         max(g.influencer)                                        as 한글명,
         string_agg(distinct c.value, ', ') filter (where c.kind='email') as email,
         string_agg(distinct c.value, ', ') filter (where c.kind='phone') as phone,
         count(distinct g.id)                                     as 공구수,
         max(g.open_date)                                         as 최근공구
  from public.seller_contacts c
  left join public.gonggu g on g.insta = c.insta and g.approved = true
  group by c.insta
  order by count(distinct g.id) desc, c.insta;
$$;

revoke all on function public.admin_seller_contacts() from anon, authenticated;

-- 🔴 2026-08-19 실측 보완: 위의 `revoke ... from anon, authenticated` 만으로는 **안 막힌다.**
--    PostgreSQL 은 새 함수에 EXECUTE 를 **PUBLIC 에 기본 부여**한다.
--    anon/authenticated 에서만 회수해도 PUBLIC 경로가 살아 있어 공개 키로 호출됐다(빈 배열 200 응답 확인).
--    → PUBLIC 에서 회수해야 한다. HANDOFF 의 admin_reset_pw 사고(anon 이 호출 가능 → 셀러 계정 탈취)와 같은 구멍이다.
revoke execute on function public.seller_contact_upsert(jsonb) from public;
revoke execute on function public.admin_seller_contacts()   from public;
grant  execute on function public.seller_contact_upsert(jsonb) to service_role;
grant  execute on function public.admin_seller_contacts()      to service_role;
