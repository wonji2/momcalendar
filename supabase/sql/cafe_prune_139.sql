-- 카페에서 지운 글을 커뮤니티 탭에서도 뺀다 (사장님 2026-11-07 「자동정리하고 테스트 확실히 · 멀쩡한 글 지우지 말고 재검 삼검 교차검증」)
--  · 지우는 일은 Edge Function cafe-prune 이 한다: 글 하나하나를 카페 글 조회 API 로 직접 확인(errorCode 4003 = 삭제·없는 글),
--    25분 이상 간격으로 3번 연속 4003 이고 카페 게시판 목록에도 없을 때만 뺀다. 로그인 필요(0004)·그 밖의 오류는 「지워졌다」로 세지 않는다.
--  · 뺀 글은 삭제만 하지 않고 community_posts_removed 에 보관한다(되살리기 가능).
--  · 손님(anon)은 보관표를 못 본다(새 표 기본 잠금, 2026-09-28 보안 기준선).
alter table public.community_posts add column if not exists gone_strikes int not null default 0;
alter table public.community_posts add column if not exists gone_last_at timestamptz;
alter table public.community_posts add column if not exists checked_at timestamptz;
create index if not exists community_posts_checked_idx on public.community_posts (checked_at nulls first);

create table if not exists public.community_posts_removed (like public.community_posts including defaults);
alter table public.community_posts_removed add column if not exists removed_at timestamptz not null default now();
alter table public.community_posts_removed add column if not exists remove_reason text;
alter table public.community_posts_removed enable row level security;
revoke all on public.community_posts_removed from anon, authenticated;

-- 확인 결과 반영: 살아 있는 글(p_seen)은 의심 횟수를 0 으로, 지워진 듯한 글(p_gone)은 +1(직전 의심에서 25분이 지났을 때만)
create or replace function public.cafe_prune_mark(p_seen bigint[], p_gone bigint[])
returns void language plpgsql security definer set search_path = public as $$
begin
  update community_posts set gone_strikes = 0, checked_at = now()
   where article_id = any(coalesce(p_seen, '{}'));
  update community_posts set gone_strikes = gone_strikes + 1, gone_last_at = now(), checked_at = now()
   where article_id = any(coalesce(p_gone, '{}')) and (gone_last_at is null or gone_last_at < now() - interval '25 minutes');
end $$;

-- 목록에 있었던 글(반증)은 의심을 되돌린다
create or replace function public.cafe_prune_reset(p_ids bigint[])
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update community_posts set gone_strikes = 0, gone_last_at = null where article_id = any(coalesce(p_ids, '{}')) and gone_strikes > 0;
  get diagnostics n = row_count; return n;
end $$;

-- 빼기: 보관표로 복사한 뒤 삭제. 의심 3번 이상 · 마지막 의심이 6시간 안인 글만(DB 쪽 마지막 안전장치). 열 이름을 직접 적어 표에 칸이 늘어도 깨지지 않는다
create or replace function public.cafe_prune_apply(p_ids bigint[], p_min int default 3)
returns bigint[] language plpgsql security definer set search_path = public as $$
declare done bigint[];
begin
  if p_min < 3 then p_min := 3; end if;
  with moved as (
    insert into community_posts_removed (cafe_id, article_id, board_id, board, title, nick, comments, views, likes, has_image, is_notice, posted_at, url, fetched_at, summary, image_url, writer_level, gone_strikes, gone_last_at, checked_at, removed_at, remove_reason)
    select c.cafe_id, c.article_id, c.board_id, c.board, c.title, c.nick, c.comments, c.views, c.likes, c.has_image, c.is_notice, c.posted_at, c.url, c.fetched_at, c.summary, c.image_url, c.writer_level, c.gone_strikes, c.gone_last_at, c.checked_at, now(), 'cafe 4003 x' || c.gone_strikes
      from community_posts c
     where c.article_id = any(coalesce(p_ids, '{}')) and c.gone_strikes >= p_min and c.gone_last_at > now() - interval '6 hours'
    returning cafe_id, article_id
  ), del as (
    delete from community_posts d using moved m where d.cafe_id = m.cafe_id and d.article_id = m.article_id returning d.article_id
  ) select coalesce(array_agg(article_id), '{}') into done from del;
  return done;
end $$;

revoke all on function public.cafe_prune_mark(bigint[], bigint[]) from public, anon, authenticated;
revoke all on function public.cafe_prune_reset(bigint[]) from public, anon, authenticated;
revoke all on function public.cafe_prune_apply(bigint[], int) from public, anon, authenticated;
grant execute on function public.cafe_prune_mark(bigint[], bigint[]) to service_role;
grant execute on function public.cafe_prune_reset(bigint[]) to service_role;
grant execute on function public.cafe_prune_apply(bigint[], int) to service_role;
notify pgrst, 'reload schema';
select count(*) filter (where column_name in ('gone_strikes','gone_last_at','checked_at')) as new_cols
  from information_schema.columns where table_schema='public' and table_name='community_posts';
