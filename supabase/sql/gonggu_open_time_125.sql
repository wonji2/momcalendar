-- 공구 오픈 시각 (사장님 2026-10-27 「공구팡팡은 몇시 오픈인지까지 나오는데 우리도 셀러 캡션 전문을 읽고 …」)
--   open_time     'HH:MM' (KST) — 셀러 원본(인포크 블록 시작 시각·캡션 「오전 10시 오픈」·집계처)에서만 채운다. 모르면 null
--   open_time_src 'inpock' | 'caption' | 'caption_ai' | 'manual'   (공구팡팡은 원본이 아니라 충돌 판정에만)
--   채우는 곳: tools/daily/open_time_fill.mjs (매시간)
--   🔴 오픈일이 바뀌면(날짜 대조가 고침) 그 시각은 옛 날짜의 것이다 → 같은 update 에서 시각을 직접 주지 않았으면 비운다
alter table public.gonggu add column if not exists open_time text;
alter table public.gonggu add column if not exists open_time_src text;

do $$ begin
  alter table public.gonggu add constraint gonggu_open_time_fmt check (open_time is null or open_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
exception when duplicate_object then null; end $$;

create or replace function public.gonggu_open_time_reset() returns trigger
language plpgsql as $$
begin
  if new.open_date is distinct from old.open_date and new.open_time is not distinct from old.open_time then
    new.open_time := null;
    new.open_time_src := null;
  end if;
  return new;
end; $$;

drop trigger if exists trg_gonggu_open_time_reset on public.gonggu;
create trigger trg_gonggu_open_time_reset before update of open_date on public.gonggu
  for each row execute function public.gonggu_open_time_reset();

-- 손님 화면이 읽는다(gonggu 는 칸 단위 grant — security_lockdown_66)
grant select (open_time) on public.gonggu to anon, authenticated;
