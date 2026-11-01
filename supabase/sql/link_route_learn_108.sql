-- 바깥 링크(카페 글쓰기·댓글·카페에서 보기) 「여는 길」 자가학습 (사장님 2026-10-25
--   「니가 추적가능하게 만들어놔야지 모든 기기 모든 펌웨어 모든 종류에서 내가 테스트는 불가능하니까 … 스스로 뒷단 자가점검 및 수정 자동으로 되게」)
--
-- 손님 쪽(index·test 의 commGo)이 누를 때마다 events 에 남긴다 (event_data = 환경|길|번호):
--   link_try  : 시도 — 환경 = 플랫폼(a/i/o)|화면(sa·tab)|브라우저(chrome·samsung·kakao·insta·wv·safari…)
--   link_ok   : 2.5초 안에 이 화면이 가려졌다(다른 앱·창으로 넘어감)
--   link_stay : 2.5초가 지나도 그대로(고르는 창이 떴거나 무시됨)
--   link_fb   : 앱이 없어 우리 중간 화면(cafego.html)으로 떨어졌다 — ok 로 보였어도 실패로 친다
-- 이 함수가 21일치를 모아 환경마다 길의 점수 = (성공+1)/(성공+실패+2) 로 순서를 정한다(처음 보는 길은 0.5 — 실패가 쌓인 길보다 먼저 시도된다)
-- 손님 쪽은 이 순서 + 그 기기에서 직접 겪은 결과(localStorage)로 고른다. 매시간(:07) 갱신. 성공률이 낮은 환경은 health_alerts 에 하루 한 번
create table if not exists public.link_rules(
  env text primary key,
  strategy_order text[] not null,
  stats jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.link_rules enable row level security;
drop policy if exists link_rules_read on public.link_rules;
create policy link_rules_read on public.link_rules for select to anon, authenticated using (true);
grant select on public.link_rules to anon, authenticated;

create or replace function public.link_rules_refresh()
returns int language plpgsql security definer set search_path to 'public' as $$
declare v_rows int;
begin
  with t as (
    select split_part(event_data,'|',1)||'|'||split_part(event_data,'|',2)||'|'||split_part(event_data,'|',3) as env,
           split_part(event_data,'|',4) as s, split_part(event_data,'|',5) as id, event_type
    from events
    where event_type in ('link_try','link_ok','link_stay','link_fb') and visited_at > now() - interval '21 days'
  ),
  tries as (select distinct env, s, id from t where event_type='link_try' and id<>''),
  res as (select id, bool_or(event_type='link_ok') ok, bool_or(event_type='link_stay') stay, bool_or(event_type='link_fb') fb from t where event_type<>'link_try' group by id),
  agg as (
    select tr.env, tr.s, count(*) n,
           count(*) filter (where coalesce(r.ok,false) and not coalesce(r.fb,false)) ok,
           count(*) filter (where coalesce(r.stay,false) or coalesce(r.fb,false)) bad
    from tries tr left join res r on r.id = tr.id group by 1,2
  ),
  ranked as (select env, s, n, ok, bad, (ok + 1.0) / (ok + bad + 2.0) as score from agg)
  insert into link_rules(env, strategy_order, stats, updated_at)
  select env, array_agg(s order by score desc, n desc),
         jsonb_object_agg(s, jsonb_build_object('n', n, 'ok', ok, 'bad', bad, 'score', round(score::numeric, 3))), now()
  from ranked group by env
  on conflict (env) do update set strategy_order = excluded.strategy_order, stats = excluded.stats, updated_at = now();
  get diagnostics v_rows = row_count;

  -- 경보: 시도 10번 이상인데 가장 나은 길도 성공률 50% 미만인 환경 (환경마다 하루 한 번)
  insert into health_alerts(kind, detail)
  select 'link_route_low', r.env || ' — 가장 나은 길 ' || r.strategy_order[1] || ' 성공 ' || (r.stats -> r.strategy_order[1] ->> 'ok') || '/' || (r.stats -> r.strategy_order[1] ->> 'n')
  from link_rules r
  where (r.stats -> r.strategy_order[1] ->> 'n')::int >= 10
    and (r.stats -> r.strategy_order[1] ->> 'score')::numeric < 0.5
    and not exists (select 1 from health_alerts h where h.kind = 'link_route_low' and h.detail like r.env || ' —%' and h.created_at > now() - interval '24 hours');
  return v_rows;
end $$;
revoke all on function public.link_rules_refresh() from public, anon, authenticated;

select cron.unschedule('link-rules-refresh') where exists (select 1 from cron.job where jobname = 'link-rules-refresh');
select cron.schedule('link-rules-refresh', '7 * * * *', $$select public.link_rules_refresh()$$);
select public.link_rules_refresh() as refreshed;
