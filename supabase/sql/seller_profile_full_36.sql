-- 셀러 프로필 전수 수집 확장 (사장님 지시 2026-08-14)
--   "한번에 가져올 수 있는 모든 정보를 다 수집해서 얹어놔야 내가 뭐라도 팔 거 아냐"
--
-- 인스타 web_profile_info 응답 1회에 딸려오는 값을 전부 저장한다(추가 호출 0).
-- 스냅샷(seller_profile)은 최신값, 이력(seller_profile_history)은 변할 때마다 누적 →
-- 성장률·도달규모 시계열이 만들어진다. 이력이 있어야 크몽 리포트에서 "3개월 성장률" 을 팔 수 있다.

-- ── 1) 스냅샷 테이블에 필드 추가 ──────────────────────────────
alter table public.seller_profile
  add column if not exists posts        bigint,      -- 게시물 수
  add column if not exists following    bigint,      -- 팔로잉 수
  add column if not exists biography    text,        -- 바이오(공구 일정·연락 정책이 여기 있다)
  add column if not exists external_url text,        -- 링크인바이오(인포크 슬러그 확보 = 다음 파싱 비용 절감)
  add column if not exists is_business  boolean,     -- 비즈니스 계정 여부
  add column if not exists category     text,        -- 인스타가 분류한 카테고리
  add column if not exists profile_pic  text,        -- 프로필 이미지 URL
  add column if not exists first_seen_at timestamptz;

-- ── 2) 이력 테이블 (시계열 자산) ─────────────────────────────
create table if not exists public.seller_profile_history(
  id         bigserial primary key,
  insta      text not null,
  followers  bigint,
  posts      bigint,
  following  bigint,
  checked_at timestamptz not null default now()
);
create index if not exists spf_hist_insta_idx on public.seller_profile_history(insta, checked_at desc);
alter table public.seller_profile_history enable row level security;
-- 정책 없음 = 아무도 직접 못 읽는다(경쟁사 수집 방어). 리포트 함수(service_role)로만 나간다.
revoke all on table public.seller_profile_history from anon, authenticated;

-- ── 3) 업서트 RPC — 파싱하면서 호출한다 ──────────────────────
-- 값이 실제로 변했을 때만 이력을 남긴다(같은 값 매일 쌓아 부풀리지 않는다).
create or replace function public.seller_profile_upsert(p jsonb)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_insta text := lower(trim(p->>'insta'));
  v_fw bigint := nullif(p->>'followers','')::bigint;
  v_posts bigint := nullif(p->>'posts','')::bigint;
  v_following bigint := nullif(p->>'following','')::bigint;
  v_prev_fw bigint;
  v_prev_posts bigint;
begin
  if v_insta is null or v_insta = '' then return 'skip'; end if;

  select followers, posts into v_prev_fw, v_prev_posts
  from public.seller_profile where lower(insta) = v_insta;

  insert into public.seller_profile as sp
    (insta, followers, posts, following, full_name, biography, external_url,
     is_private, is_verified, is_business, category, profile_pic, checked_at, first_seen_at)
  values
    (v_insta, v_fw, v_posts, v_following, p->>'full_name', p->>'biography', p->>'external_url',
     (p->>'is_private')::boolean, (p->>'is_verified')::boolean, (p->>'is_business')::boolean,
     p->>'category', p->>'profile_pic', now(), now())
  on conflict (insta) do update set
    followers    = coalesce(excluded.followers, sp.followers),
    posts        = coalesce(excluded.posts, sp.posts),
    following    = coalesce(excluded.following, sp.following),
    full_name    = coalesce(excluded.full_name, sp.full_name),
    biography    = coalesce(excluded.biography, sp.biography),
    external_url = coalesce(excluded.external_url, sp.external_url),
    is_private   = coalesce(excluded.is_private, sp.is_private),
    is_verified  = coalesce(excluded.is_verified, sp.is_verified),
    is_business  = coalesce(excluded.is_business, sp.is_business),
    category     = coalesce(excluded.category, sp.category),
    profile_pic  = coalesce(excluded.profile_pic, sp.profile_pic),
    checked_at   = now(),
    first_seen_at = coalesce(sp.first_seen_at, now());

  -- 팔로워/게시물이 바뀌었을 때만 이력 적재
  if v_fw is not null and (v_prev_fw is null or v_prev_fw <> v_fw
      or v_prev_posts is distinct from v_posts) then
    insert into public.seller_profile_history(insta, followers, posts, following)
    values (v_insta, v_fw, v_posts, v_following);
    return 'saved+hist';
  end if;
  return 'saved';
end $$;

revoke all on function public.seller_profile_upsert(jsonb) from public, anon, authenticated;
grant execute on function public.seller_profile_upsert(jsonb) to service_role;

comment on table public.seller_profile_history is
  '셀러 팔로워·게시물 시계열. 성장률 리포트의 근거. 파싱할 때마다 값이 변하면 적재된다.';
comment on function public.seller_profile_upsert(jsonb) is
  '인스타 프로필 1회 조회분을 통째로 저장(추가 호출 0). 파싱 루프에서 셀러마다 호출할 것.';
