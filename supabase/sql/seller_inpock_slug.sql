-- 인포크 슬러그를 DB 한 곳에 모은다 (사장님 지시 2026-09-28)
--   "인포크핸들이랑 인스타핸들을 별도로 db에 모으라고 시켰어 두개가 다르니까 한번만 모으면 안헷갈리잖아"
--
-- 왜 필요한가: 인포크 주소와 인스타 핸들은 **다르다**.
--   째째홈  = instagram.com/jjhome_and_life  ·  인포크 link.inpock.co.kr/rachelkkong
--   희아패밀리 = instagram.com/heeah_family   ·  인포크 link.inpock.co.kr/heeah
--   이걸 헷갈려 gonggu.insta 에 슬러그를 넣으면 같은 셀러가 갈라져 중복검사가 통째로 비켜간다.
--   지금까지는 scratchpad/_slugmap.tsv(파일)에만 45쌍 있었고, 도구가 그걸 안 읽으면 매번 다시 틀렸다.
--
-- 어디서 오나: seller_profile.external_url 이 이미 인포크 주소를 갖고 있다(1,306명 중 863명).
--   그래서 **파생 컬럼**으로 만든다 — external_url 이 갱신되면 슬러그도 저절로 따라온다. 손으로 채울 일이 없다.

alter table public.seller_profile
  add column if not exists inpock_slug text
  generated always as (
    nullif(
      regexp_replace(
        external_url,
        '^https?://(?:www\.)?(?:link\.inpock\.co\.kr|inpk\.link)/([A-Za-z0-9._@-]+).*$',
        '\1'
      ),
      external_url            -- 정규식이 안 맞으면 원문이 그대로 나온다 → 인포크가 아니므로 null
    )
  ) stored;

comment on column public.seller_profile.inpock_slug is
  '인포크 주소의 슬러그. external_url 에서 자동 추출(파생 컬럼). 인스타 핸들(insta)과 다를 수 있다 — 2026-09-28';

create index if not exists seller_profile_inpock_slug_idx
  on public.seller_profile (inpock_slug) where inpock_slug is not null;

-- 확인
select count(*) as 전체,
       count(inpock_slug) as 슬러그있음,
       count(*) filter (where inpock_slug is not null and inpock_slug <> insta) as 핸들과다름
from public.seller_profile;
