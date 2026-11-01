-- 라방 찜 = 방송 10분 전 알림 (사장님 2026-10-24 「라방 알림은 어디서 받아 세일처럼 찜표시가 없네」)
--  · 세일 찜(sale_wish_85/89)과 같은 틀: 화면은 이 기기(localStorage mc_live_w)에 바로 · 서버 live_wishes 에도 저장
--    → pg_cron `live-push` 5분마다 · 보낼 대상이 있을 때만 send-live-push 를 부른다(없으면 외부 호출 0)
--  · 대상 = 찜한 방송이 앞으로 12분 안에 시작 · 그 기기에 아직 안 보냄 · push_subs.fail_count < 5
--  · 한도(0-L): 찜 1건 = 1행. 방송 시작 3일 지난 찜·발송 기록은 매일 지운다 → 상한 수천 행
--  되돌리기: drop function live_wish_set, live_wish_list, live_push_targets; drop table live_wishes, live_push_log; select cron.unschedule('live-push'); select cron.unschedule('live-wish-prune');
create table if not exists public.live_wishes (
  device_id  text   not null,
  show_id    bigint not null,           -- live_shows.id (방송 번호). 수집기가 지난 방송 행을 지우므로 FK 는 걸지 않는다
  start_at   timestamptz,               -- 찜할 때의 시작 시각(방송 행이 지워진 뒤 정리용)
  created_at timestamptz not null default now(),
  primary key (device_id, show_id)
);
alter table public.live_wishes enable row level security;
revoke all on public.live_wishes from anon, authenticated;

create table if not exists public.live_push_log (
  device_id text   not null,
  show_id   bigint not null,
  sent_at   timestamptz not null default now(),
  primary key (device_id, show_id)
);
alter table public.live_push_log enable row level security;
revoke all on public.live_push_log from anon, authenticated;

create or replace function public.live_wish_set(p_device text, p_show bigint, p_on boolean)
returns void language plpgsql security definer set search_path = public as $$
declare st timestamptz;
begin
  if coalesce(length(p_device),0) < 8 or p_show is null then return; end if;
  if not coalesce(p_on,false) then delete from live_wishes where device_id = p_device and show_id = p_show; return; end if;
  select start_at into st from live_shows where id = p_show;
  if st is null then return; end if;   -- 없는 방송 번호는 받지 않는다
  insert into live_wishes(device_id, show_id, start_at) values (p_device, p_show, st)
  on conflict (device_id, show_id) do update set start_at = excluded.start_at;
end $$;

create or replace function public.live_wish_list(p_device text)
returns table(show_id bigint)
language sql stable security definer set search_path = public as $$
  select w.show_id from live_wishes w where w.device_id = p_device and coalesce(w.start_at, now()) > now() - interval '2 hours';
$$;

create or replace function public.live_push_targets()
returns table(device_id text, endpoint text, p256dh text, auth text, show_id bigint, title text, channel_name text, start_at timestamptz)
language sql stable security definer set search_path = public as $$
  select s.device_id, s.endpoint, s.p256dh, s.auth, l.id, l.title, l.channel_name, l.start_at
  from live_wishes w
  join push_subs  s on s.device_id = w.device_id
  join live_shows l on l.id = w.show_id
  where l.start_at > now() and l.start_at <= now() + interval '12 minutes'
    and s.fail_count < 5
    and not exists (select 1 from live_push_log g where g.device_id = s.device_id and g.show_id = l.id);
$$;

revoke all on function public.live_wish_set(text,bigint,boolean) from public;
revoke all on function public.live_wish_list(text) from public;
revoke all on function public.live_push_targets() from public, anon, authenticated;
grant execute on function public.live_wish_set(text,bigint,boolean) to anon, authenticated;
grant execute on function public.live_wish_list(text) to anon, authenticated;
grant execute on function public.live_push_targets() to service_role;

-- 크론: open-push 잡의 호출문을 복제(비밀 헤더를 파일에 안 적는다) + 「대상이 있을 때만」 조건을 붙인다
do $$
declare cmd text;
begin
  select command into cmd from cron.job where jobname = 'open-push' limit 1;
  if cmd is null then raise notice 'open-push 잡이 없어 live-push 를 만들지 못했다'; return; end if;
  cmd := replace(cmd, 'functions/v1/send-open-push', 'functions/v1/send-live-push');
  cmd := regexp_replace(cmd, '\)\s*;\s*$', ') where exists (select 1 from public.live_push_targets());');
  if position('live_push_targets' in cmd) = 0 then raise notice '조건을 못 붙여 live-push 를 만들지 않았다'; return; end if;
  if exists (select 1 from cron.job where jobname = 'live-push') then perform cron.unschedule('live-push'); end if;
  perform cron.schedule('live-push', '*/5 * * * *', cmd);
  if not exists (select 1 from cron.job where jobname = 'live-wish-prune') then
    perform cron.schedule('live-wish-prune', '20 4 * * *', $sql$delete from public.live_wishes where start_at < now() - interval '3 days'; delete from public.live_push_log where sent_at < now() - interval '3 days'$sql$);
  end if;
end $$;

notify pgrst, 'reload schema';
select (select count(*) from cron.job where jobname in ('live-push','live-wish-prune')) as jobs,
       (select position('live_push_targets' in command) > 0 from cron.job where jobname = 'live-push') as guarded,
       (select count(*) from public.live_push_targets()) as targets_now;
