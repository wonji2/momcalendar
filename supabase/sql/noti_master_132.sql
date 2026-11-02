-- 알림 마스터 오더 (사장님 2026-11-02, scratchpad/ORDER_NOTI_AND_BOT_MASTER.md)
-- ① 핫딜 키워드 푸시: 손님(앱)이 등록한 키워드 → kw_push_subs, 새 핫딜 제목에 키워드가 들어 있으면 send-fcm-push?mode=kw 가 사진·가격과 함께 한 번 보낸다.
-- ② 6개월(180일) 가격 이력 보관: 지시서의 hotdeal_history 는 우리 표 이름이 price_history(product_id, day, price) — 매일 지운다.
-- 되돌리기: drop table kw_push_subs, kw_push_log; drop function kw_push_set, kw_push_targets_fcm; select cron.unschedule('fcm-kw-push'); select cron.unschedule('price-history-prune');
create table if not exists public.kw_push_subs(device_id text not null, keyword text not null, created_at timestamptz not null default now(), primary key(device_id, keyword));
create table if not exists public.kw_push_log(device_id text not null, hotdeal_id bigint not null, sent_at timestamptz not null default now(), primary key(device_id, hotdeal_id));
alter table public.kw_push_subs enable row level security;
alter table public.kw_push_log enable row level security;
revoke all on public.kw_push_subs, public.kw_push_log from anon, authenticated;

create or replace function public.kw_push_set(p_device text, p_kws text[]) returns void
language plpgsql security definer set search_path to 'public' as $$
declare k text; n int := 0;
begin
  if p_device is null or length(p_device) < 8 or length(p_device) > 80 then return; end if;
  delete from kw_push_subs where device_id = p_device;
  foreach k in array coalesce(p_kws, '{}'::text[]) loop
    k := left(btrim(coalesce(k, '')), 20);
    continue when length(k) < 2;
    n := n + 1; exit when n > 30;
    insert into kw_push_subs(device_id, keyword) values (p_device, k) on conflict do nothing;
  end loop;
end $$;
grant execute on function public.kw_push_set(text, text[]) to anon, authenticated;

create or replace function public.kw_push_targets_fcm()
returns table(device_id text, fcm_token text, hotdeal_id bigint, keyword text, title text, price int, discount_rate int, mall text, img_url text, unit_price int, unit_label text)
language sql stable security definer set search_path to 'public' as $$
  select distinct on (s.device_id, h.id)
         s.device_id, s.fcm_token, h.id, k.keyword, h.title, h.price, h.discount_rate, h.mall, h.img_url, h.unit_price, h.unit_label
  from kw_push_subs k
  join push_fcm s on s.device_id = k.device_id
  join hotdeals h on position(lower(k.keyword) in lower(h.title)) > 0
  where h.created_at > now() - interval '90 minutes'
    and h.price > 0 and h.img_url is not null
    and (h.expires_at is null or h.expires_at > now())
    and s.fail_count < 5
    and coalesce((s.prefs->>'hotdeal')::boolean, true)
    and not exists (select 1 from kw_push_log l where l.device_id = s.device_id and l.hotdeal_id = h.id)
    and (select count(*) from kw_push_log l2 where l2.device_id = s.device_id and l2.sent_at > now() - interval '24 hours') < 5
  order by s.device_id, h.id, length(k.keyword) desc;
$$;
revoke all on function public.kw_push_targets_fcm() from anon, authenticated;

-- 30분마다(함수 안에서 한국 시간 21~09시는 쉰다). 비밀값은 fcm-open-push 명령을 복사한다.
select cron.schedule('fcm-kw-push', '*/30 * * * *',
  replace((select command from cron.job where jobname = 'fcm-open-push'), 'send-fcm-push?mode=open', 'send-fcm-push?mode=kw'));
-- 매일 00:10 KST(UTC 15:10) 180일 지난 가격 이력 삭제
select cron.schedule('price-history-prune', '10 15 * * *', $$delete from public.price_history where day < (now() at time zone 'Asia/Seoul')::date - 180$$);
select jobname, schedule, position('mode=kw' in command) > 0 as kw_ok from cron.job where jobname in ('fcm-kw-push','price-history-prune');

-- 아이폰 판 (2026-11-02 추가): push_ios 토큰으로 같은 키워드 핫딜 알림. 안드로이드와 같은 규칙(하루 5건·90분 안 새 핫딜).
create or replace function public.kw_push_targets_ios()
returns table(device_id text, apns_token text, env text, hotdeal_id bigint, keyword text, title text, price int, discount_rate int, mall text, img_url text, unit_price int, unit_label text)
language sql stable security definer set search_path to 'public' as $$
  select distinct on (s.device_id, h.id)
         s.device_id, s.apns_token, s.env, h.id, k.keyword, h.title, h.price, h.discount_rate, h.mall, h.img_url, h.unit_price, h.unit_label
  from kw_push_subs k
  join push_ios s on s.device_id = k.device_id
  join hotdeals h on position(lower(k.keyword) in lower(h.title)) > 0
  where h.created_at > now() - interval '90 minutes'
    and h.price > 0 and h.img_url is not null
    and (h.expires_at is null or h.expires_at > now())
    and s.fail_count < 5
    and not exists (select 1 from kw_push_log l where l.device_id = s.device_id and l.hotdeal_id = h.id)
    and (select count(*) from kw_push_log l2 where l2.device_id = s.device_id and l2.sent_at > now() - interval '24 hours') < 5
  order by s.device_id, h.id, length(k.keyword) desc;
$$;
revoke all on function public.kw_push_targets_ios() from anon, authenticated;
select cron.schedule('ios-kw-push', '*/30 * * * *',
  replace(replace((select command from cron.job where jobname = 'fcm-open-push'), 'send-fcm-push?mode=open', 'send-open-push-ios?mode=kw'), 'push_targets_fcm()', 'kw_push_targets_ios()'));

-- 보정: 안드로이드 키워드 크론도 「키워드 대상이 있을 때만」 부르게(복사한 조건이 오픈 알림 대상이라 어긋나 있었다)
select cron.schedule('fcm-kw-push', '*/30 * * * *', replace((select command from cron.job where jobname='fcm-kw-push'), 'public.push_targets_fcm()', 'public.kw_push_targets_fcm()'));
