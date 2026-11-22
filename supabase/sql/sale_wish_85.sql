-- 세일 일정 찜(♡)·알림(🔔) + 수익링크 칸 — 2026-10-13 사장님 "알림벨 찜하기 기능도 작업해놔"
--  · 손님(anon)은 sale_wishes 에 직접 못 쓴다(RLS 켜고 정책 없음) → 보안 함수 sale_wish_set / sale_wish_list 만 쓴다
--  · 알림은 세일 시작일 09:05(KST) 한 번. 발송은 Edge Function send-sale-push, 대상은 sale_push_targets()
--  · 새 표·RPC 는 명시 grant 없이는 손님이 못 본다(2026-09-28 보안 잠금) — 아래에 grant 를 적었다

alter table public.sale_events add column if not exists aff_merchant text not null default '';  -- 링크프라이스 머천트 코드(승인된 곳만). 비면 공식 주소 그대로

create table if not exists public.sale_wishes (
  device_id  text   not null,
  sale_id    bigint not null references public.sale_events(id) on delete cascade,
  wish       boolean not null default true,   -- ♡
  bell       boolean not null default false,  -- 🔔 시작일 아침 알림
  created_at timestamptz not null default now(),
  primary key (device_id, sale_id)
);
alter table public.sale_wishes enable row level security;
revoke all on public.sale_wishes from anon, authenticated;

create table if not exists public.sale_push_log (
  device_id text   not null,
  sale_id   bigint not null,
  kind      text   not null default 'start',
  sent_at   timestamptz not null default now(),
  primary key (device_id, sale_id, kind)
);
alter table public.sale_push_log enable row level security;
revoke all on public.sale_push_log from anon, authenticated;

create or replace function public.sale_wish_set(p_device text, p_sale bigint, p_wish boolean, p_bell boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if coalesce(length(p_device),0) < 8 or p_sale is null then return; end if;
  if not exists (select 1 from sale_events where id = p_sale) then return; end if;
  if not coalesce(p_wish,false) and not coalesce(p_bell,false) then
    delete from sale_wishes where device_id = p_device and sale_id = p_sale;
  else
    insert into sale_wishes(device_id, sale_id, wish, bell)
    values (p_device, p_sale, coalesce(p_wish,false), coalesce(p_bell,false))
    on conflict (device_id, sale_id) do update set wish = excluded.wish, bell = excluded.bell;
  end if;
end $$;

create or replace function public.sale_wish_list(p_device text)
returns table(sale_id bigint, wish boolean, bell boolean)
language sql stable security definer set search_path = public as $$
  select w.sale_id, w.wish, w.bell from sale_wishes w where w.device_id = p_device;
$$;

-- 오늘(KST) 시작하는 세일 중 🔔 를 켜 둔 기기. 이미 보낸 건 제외, 죽은 구독(fail_count>=5) 제외
create or replace function public.sale_push_targets()
returns table(device_id text, endpoint text, p256dh text, auth text, sale_id bigint, brand text, title text)
language sql stable security definer set search_path = public as $$
  select s.device_id, s.endpoint, s.p256dh, s.auth, e.id, e.brand, e.title
  from sale_wishes w
  join push_subs  s on s.device_id = w.device_id
  join sale_events e on e.id = w.sale_id
  where w.bell
    and e.approved
    and e.start_date = to_char((now() at time zone 'Asia/Seoul')::date, 'YYYY-MM-DD')
    and s.fail_count < 5
    and not exists (select 1 from sale_push_log l where l.device_id = s.device_id and l.sale_id = e.id and l.kind = 'start');
$$;

revoke all on function public.sale_wish_set(text,bigint,boolean,boolean) from public;
revoke all on function public.sale_wish_list(text) from public;
revoke all on function public.sale_push_targets() from public, anon, authenticated;
grant execute on function public.sale_wish_set(text,bigint,boolean,boolean) to anon, authenticated;
grant execute on function public.sale_wish_list(text) to anon, authenticated;
grant execute on function public.sale_push_targets() to service_role;

-- 매일 09:05 KST(= 00:05 UTC) — 기존 open-push 잡의 호출문(비밀 헤더 포함)을 그대로 복사해 함수 이름만 바꾼다. 이미 있으면 건너뜀
do $$
declare cmd text;
begin
  if exists (select 1 from cron.job where jobname = 'sale-push') then return; end if;
  select command into cmd from cron.job where jobname = 'open-push' limit 1;
  if cmd is null then raise notice 'open-push 잡이 없어 sale-push 를 만들지 못했다'; return; end if;
  perform cron.schedule('sale-push', '5 0 * * *', replace(cmd, 'send-open-push', 'send-sale-push'));
end $$;

notify pgrst, 'reload schema';
select (select count(*) from cron.job where jobname = 'sale-push') as sale_push_job,
       (select count(*) from information_schema.columns where table_name = 'sale_events' and column_name = 'aff_merchant') as aff_col;
