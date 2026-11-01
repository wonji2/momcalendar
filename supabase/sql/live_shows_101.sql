-- 라방(라이브 커머스) 일정 — 네이버 쇼핑라이브 편성표 (2026-10-24 사장님 「세일/라방 … 토글에 라방 일정도 따로 보게 · 라방 내용도 우리도 수집해서 그대로 다 넣어」)
--   수집: Edge Function live-collect (6시간마다, pg_cron live-collect). 원천 = shoppinglive.naver.com/calendar 가 부르는 공개 편성표 API(분류 9개 × 7일)
--   방송 번호(id)로 덮어쓴다 → 방송사가 제목·시각을 바꾸면 따라간다. 30일 지난 방송은 지운다(LONG_TERM_REGISTER: 주 ~800행, 상시 ~3천 행)
--   제목·상품명은 원본 그대로(규칙 0-S-원본). 링크는 네이버 라이브 주소(수익 링크 아님 — 브랜드커넥트는 조립 불가).
create table if not exists public.live_shows (
  id            bigint primary key,            -- 쇼핑라이브 broadcast id
  title         text not null,
  description   text,
  channel_name  text,
  channel_id    bigint,
  category      text,                          -- 뷰티·푸드·패션·라이프·여행/체험·키즈·테크·취미레저·문화생활
  start_at      timestamptz not null,          -- expectedStartDate (KST 로 온다)
  status        text,                          -- NONE/STANDBY/ONAIR/BLOCK/END …
  image_url     text,
  link_url      text,                          -- https://shoppinglive.naver.com/livebridge/<id>
  products      jsonb,                         -- [{name, price, discountRate, image, mall}] 최대 3
  benefits      jsonb,                         -- [{message, detail}] 최대 3
  source        text not null default 'naver_shoppinglive',
  first_seen    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists live_shows_start on public.live_shows (start_at);
alter table public.live_shows enable row level security;
drop policy if exists live_shows_read on public.live_shows;
create policy live_shows_read on public.live_shows for select using (true);
grant select on public.live_shows to anon, authenticated;

-- 6시간마다(KST 02:10·08:10·14:10·20:10). 비밀값은 기존 크론(cafe-feed)에서 그대로 읽어 쓴다(파일에 비밀을 적지 않는다)
select cron.unschedule('live-collect') where exists (select 1 from cron.job where jobname = 'live-collect');
select cron.schedule('live-collect', '10 5,11,17,23 * * *',
  format($f$select net.http_post(url := 'https://hycaqsqeogjtbscmzrtm.supabase.co/functions/v1/live-collect', headers := %L::jsonb, body := '{}'::jsonb, timeout_milliseconds := 140000)$f$,
         json_build_object('Content-Type', 'application/json', 'x-cron-secret',
           (select (regexp_match(command, '"x-cron-secret":"([^"]+)"'))[1] from cron.job where jobname = 'cafe-feed'))::text));

-- 2026-10-24 검증 반영: 화면용 가벼운 칸(사이트는 이것만 읽는다 — products·benefits 전체를 읽으면 한 번에 144KB)
alter table public.live_shows add column if not exists prod_name text, add column if not exists prod_price int, add column if not exists prod_rate int, add column if not exists benefit text;
