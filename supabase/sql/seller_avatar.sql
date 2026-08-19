-- ⭐ 이웃셀러 동그라미를 프로필 사진으로 (사장님 지시 2026-08-19, 위시버니 참고)
--   지금은 동그라미 안에 셀러 이름 글자만 있다 → 인스타 프로필 사진으로 채운다.
--
-- ⚠ 인스타가 주는 profile_pic_url 은 **서명이 붙은 임시 주소**라 며칠이면 만료된다.
--   그대로 저장하면 얼마 뒤 사진이 깨진다 → 우리 스토리지(banners 버킷)에 받아두고 그 주소를 쓴다.
alter table public.sellers add column if not exists avatar_url text;

comment on column public.sellers.avatar_url is
  '이웃셀러 동그라미에 쓰는 프로필 사진. 인스타 원본은 만료되므로 우리 스토리지 주소를 넣을 것';

-- 사이트(anon)가 읽어야 하므로 노출 컬럼 목록에 포함돼야 한다.
-- 기존 셀러 조회 정책이 컬럼 화이트리스트 방식이면 여기서 함께 확인한다.
select column_name from information_schema.columns
 where table_schema='public' and table_name='sellers' and column_name='avatar_url';
