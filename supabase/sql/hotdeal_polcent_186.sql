-- 핫딜 2단계 스키마: 상품키 통일 · 판정 칸 · 가격 이력 출처 (2026-11-23 ORDER_HOTDEAL_POLCENT §5-2)
--   product_key = <mall_code>:<상품번호>. 유니크 인덱스는 만들지 않는다(중복 행이 있을 수 있다).
--   price_status 값: unknown | reported(제보가를 옮긴 값) | measured(몰 API 가 준 값) | soldout
alter table public.hotdeals
  add column if not exists product_key text,
  add column if not exists mall_code   text,
  add column if not exists option_no   text,
  add column if not exists key_src     text,               -- backfill | collector | engine | unknown
  add column if not exists judge_stage text,               -- none | collecting | provisional | confirmed
  add column if not exists judge_basis text,               -- none | measured | reported | mixed
  add column if not exists avg_price   integer,
  add column if not exists min_price   integer,
  add column if not exists drop_pct    integer,
  add column if not exists judge_at    timestamptz,
  add column if not exists track       boolean not null default true;   -- 여행·정가 상품은 false

alter table public.price_history
  add column if not exists product_key text,
  add column if not exists src text not null default 'measured';        -- measured | reported

create index if not exists hotdeals_product_key_idx on public.hotdeals (product_key, created_at desc);
create index if not exists price_history_key_day_idx on public.price_history (product_key, day);

-- 한 번에 unknown 을 없앤다 — 값의 출처로 가른다
update public.hotdeals set price_status = case
    when product_id like 'cp\_%' then 'reported'                 -- 지름알림 경유 쿠팡 = 제보가(몰 확인 아님)
    when source in ('coupang','goldbox','toss','adpick') then 'measured'
    else 'reported' end
 where price_status = 'unknown';

-- 새 행이 unknown 으로 시작하지 않게(수집 경로가 여럿이라 한 곳에서 채운다 — 토스·네이버·판정엔진·수기 포함). 위 UPDATE 와 같은 규칙.
create or replace function public.hotdeal_price_status_default() returns trigger
language plpgsql as $$
begin
  if new.price_status is null or new.price_status = 'unknown' then
    new.price_status := case
      when new.product_id like 'cp\_%' then 'reported'
      when new.source in ('coupang','goldbox','toss','adpick') then 'measured'
      else 'reported' end;
  end if;
  return new;
end $$;
drop trigger if exists hotdeals_price_status_default on public.hotdeals;
create trigger hotdeals_price_status_default before insert on public.hotdeals
  for each row execute function public.hotdeal_price_status_default();
update public.hotdeals set price_status = case
    when product_id like 'cp\_%' then 'reported'
    when source in ('coupang','goldbox','toss','adpick') then 'measured'
    else 'reported' end
 where price_status = 'unknown';
