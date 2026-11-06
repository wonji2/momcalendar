-- 🛡 api 수집기 자동 차단 목록 (2026-11-06 사장님 「이런식의 요청 더 있나 매일 감시시스템 만들고 자동으로 우리가 막게」)
--   흐름: scratchpad/private/api_scraper_guard.mjs(PC 예약 momcal-api-guard 3시간) 가 Cloudflare 분석으로 수집기 IP 를 판정 → 이 표에 넣는다
--         → api 워커(tools/daily/cf_api_proxy/worker.js)가 api_blocklist_ips() 를 5분마다 읽어 그 IP 를 403 으로 돌려보낸다(DB·캐시 안 탐).
--   왜 판정이 PC 인가: Cloudflare 분석 토큰이 PC(tools/daily/.env)에만 있고, 서버 비밀값으로 옮기는 것은 자동 안전장치가 막았다(2026-11-06).
--         PC 가 꺼져도 **이미 넣은 차단은 그대로 산다**(표·워커는 서버). 판정만 멈추고, 36시간 멈추면 아래 크론이 health_alerts 에 남긴다.
--   되돌리기: update api_blocklist set active=false where ip='…';  (5분 안에 풀린다)
create table if not exists public.api_blocklist (
  ip          text primary key,
  reason      text not null,
  stats       jsonb,
  source      text not null default 'auto',     -- auto(감시기) · manual(사람)
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  expires_at  timestamptz,                       -- null = 영구. 자동 차단은 30일(다시 걸리면 늘어난다)
  active      boolean not null default true
);
alter table public.api_blocklist enable row level security;
revoke all on public.api_blocklist from anon, authenticated;

-- 워커가 읽는 창구 — 지금 막을 IP 만 쉼표로. 목록이 드러나도 해가 없다(막힌 쪽만 안다)
create or replace function public.api_blocklist_ips() returns text
language sql stable security definer set search_path = public as $$
  select coalesce(string_agg(ip, ',' order by ip), '') from public.api_blocklist
   where active and (expires_at is null or expires_at > now());
$$;
revoke all on function public.api_blocklist_ips() from public;
grant execute on function public.api_blocklist_ips() to anon, authenticated;

-- 첫 줄: 2026-11-06 눈으로 판정한 수집기(사장님 확인 「내 IP 아니야」). Cloudflare 방화벽 규칙 block-node-scraper-182.210.222.17 과 겹쳐 둔다
insert into public.api_blocklist(ip, reason, stats, source, expires_at)
values ('182.210.222.17', 'UA node · api 만 · 1~2분마다 사이트 첫 로딩 묶음 25건 · 24시간 · 사이트 화면 0',
        '{"api_24h":19338,"hours":24,"site":0,"ua":["node"]}'::jsonb, 'manual', now() + interval '30 days')   -- 가정 회선이라 영구로 두지 않는다(다른 집에 넘어갈 수 있다, 검증자 2026-11-06). 다시 오면 감시기가 다시 잡는다
on conflict (ip) do nothing;

-- 감시기 심박(ops_status 'api-guard')이 36시간 끊기면 경보 — PC 가 꺼졌거나 예약작업이 죽은 것
do $$ begin
  perform cron.unschedule(j.jobid) from cron.job j where j.jobname = 'api-guard-heartbeat';
  perform cron.schedule('api-guard-heartbeat', '20 1 * * *', $h$
    insert into public.health_alerts(kind, detail)
    select 'api감시:멈춤', '🟡 api 수집기 감시(momcal-api-guard, PC)가 ' ||
           coalesce(round(extract(epoch from now() - (select updated_at from public.ops_status where id = 'api-guard')) / 3600)::text || '시간째', '한 번도') ||
           ' 안 돌았다 — 이미 넣은 차단은 그대로 살아 있다. PC 예약작업 momcal-api-guard 확인'
    where coalesce((select updated_at from public.ops_status where id = 'api-guard'), 'epoch'::timestamptz) < now() - interval '36 hours'
      and not exists (select 1 from public.health_alerts where kind = 'api감시:멈춤' and created_at > now() - interval '12 hours');
  $h$);
end $$;
select public.api_blocklist_ips() as ips, (select count(*) from cron.job where jobname = 'api-guard-heartbeat') as cron;
