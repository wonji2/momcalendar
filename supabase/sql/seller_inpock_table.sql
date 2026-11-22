-- 🔑 인스타 핸들 ↔ 인포크 슬러그 — **단일 출처** (사장님 지시 2026-09-28)
--   "인포크핸들이랑 인스타핸들을 별도로 db에 모으라고 시켰어 두개가 다르니까 한번만 모으면 안헷갈리잖아"
--
-- 왜 표를 따로 두나 (파생 컬럼만으로는 모자랐다):
--   seller_profile.inpock_slug 는 external_url 에서 자동 추출하는데, external_url 이 **빈 셀러가 326명**이다.
--   실제로 째째홈(jjhome_and_life)·희아패밀리(heeah_family)가 거기 걸려 전수조사에서 통째로 빠졌다.
--   그래서 ①자동 추출분 ②사람이 눈으로 확인한 분 을 한 표에 모으고, 도구는 이 표 하나만 본다.
--
-- 쓰는 곳: inpock_harvest.mjs(수확 전 슬러그 조회) · pending_check.sh(핸들 칸 오염 검사) · 파싱 전수조사

create table if not exists public.seller_inpock (
  insta       text primary key,                 -- 인스타 핸들 (정본)
  slug        text not null,                    -- 인포크 슬러그
  source      text not null default 'auto',     -- auto(external_url 파생) | manual(눈으로 확인) | harvest(수확 성공)
  note        text,
  checked_at  timestamptz not null default now()
);

comment on table public.seller_inpock is
  '인스타 핸들 ↔ 인포크 슬러그. 둘은 다르다(405쌍 실측) — 헷갈리면 같은 셀러가 갈라져 중복검사가 비켜간다. 2026-09-28';

create index if not exists seller_inpock_slug_idx on public.seller_inpock (slug);

-- ① seller_profile 의 external_url 에서 자동 추출분을 넣는다 (이미 있는 것은 건드리지 않는다)
insert into public.seller_inpock (insta, slug, source)
select insta, inpock_slug, 'auto'
from public.seller_profile
where inpock_slug is not null and inpock_slug <> ''
on conflict (insta) do nothing;

select count(*) as 모인_매핑,
       count(*) filter (where insta <> slug) as 핸들과_다른것
from public.seller_inpock;
