-- 커뮤니티 탭(카페 글 목록) 저장표 + 손님 읽기 권한 + 30분 크론 (2026-10-24, 사장님 앱 디벨롭 결정: 커뮤니티 = 카페 게시판)
--  · 채우는 쪽: Edge Function cafe-feed (supabase/functions/cafe-feed) — 공개 목록 API, 제목·닉네임·댓글수·조회수·시각
--  · 읽는 쪽: test.html(→ index.html) 커뮤니티 탭, anon select (규칙: 새 표는 명시 grant 없이는 손님이 못 본다)
--  · 한도(0-L): 하루 약 +400행, 30일 지난 글은 크론 뒤 정리 → 상한 약 12,000행(수 MB)
create table if not exists public.community_posts (
  cafe_id     bigint not null,
  article_id  bigint not null,
  board_id    int not null,
  board       text not null,
  title       text not null,
  nick        text,
  comments    int default 0,
  views       int default 0,
  likes       int default 0,
  has_image   boolean default false,
  is_notice   boolean default false,
  posted_at   timestamptz not null,
  url         text,
  fetched_at  timestamptz default now(),
  primary key (cafe_id, article_id)
);
create index if not exists community_posts_posted_idx on public.community_posts (posted_at desc);
create index if not exists community_posts_board_idx on public.community_posts (board_id, posted_at desc);
alter table public.community_posts enable row level security;
drop policy if exists community_posts_public_read on public.community_posts;
create policy community_posts_public_read on public.community_posts for select to anon, authenticated using (true);
grant select on public.community_posts to anon, authenticated;

-- 크론: 30분마다 cafe-feed, 매일 04:10 UTC 에 30일 지난 글 정리. 호출 형식은 open-push 잡의 명령을 복제(비밀 헤더를 파일에 안 적는다)
do $$
declare cmd text;
begin
  select command into cmd from cron.job where jobname = 'open-push';
  if cmd is null then raise notice 'open-push 잡이 없어 cafe-feed 를 만들지 못했다'; return; end if;
  if not exists (select 1 from cron.job where jobname = 'cafe-feed') then
    perform cron.schedule('cafe-feed', '*/30 * * * *', replace(cmd, 'functions/v1/send-open-push', 'functions/v1/cafe-feed?per=30'));
  end if;
  if not exists (select 1 from cron.job where jobname = 'cafe-feed-prune') then
    perform cron.schedule('cafe-feed-prune', '10 4 * * *', $sql$delete from public.community_posts where posted_at < now() - interval '30 days'$sql$);
  end if;
end $$;
select jobname, schedule, active from cron.job where jobname like 'cafe-feed%' order by 1;
