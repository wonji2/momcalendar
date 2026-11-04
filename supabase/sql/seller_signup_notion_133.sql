-- 셀러 가입 → 노션 자동 기록 (2026-11-04). 함수 seller-signup-notion 이 5분마다 새 가입을 노션 「셀러 가입 (자동수집)」 표에 쌓는다.
alter table public.sellers add column if not exists notion_page_id text;
alter table public.sellers add column if not exists notion_synced_at timestamptz;
alter table public.sellers add column if not exists notion_error text;
alter table public.sellers add column if not exists notion_has_followers boolean not null default false;
-- 기존 가입자는 이번 연동에서 제외(들어오는 가입부터). 필요하면 notion_synced_at 을 null 로 되돌리면 20명씩 쌓인다.
update public.sellers set notion_synced_at = now(), notion_error = '연동 전 가입(백필 제외)' where notion_synced_at is null and notion_page_id is null;
-- 5분마다 호출: 기존 cafe-feed 예약작업의 명령(비밀 헤더 포함)을 복사해 주소만 바꾼다(비밀값을 파일에 적지 않기 위해)
select cron.schedule('seller-signup-notion', '*/5 * * * *',
  replace(replace((select command from cron.job where jobname = 'cafe-feed'), 'functions/v1/cafe-feed?per=30', 'functions/v1/seller-signup-notion'), 'cafe-feed', 'seller-signup-notion'));
