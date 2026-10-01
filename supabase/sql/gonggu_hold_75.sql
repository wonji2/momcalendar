-- 🔴 사장님이 "내려" 한 공구가 다시 올라오는 것을 막는다 (2026-10-01)
--
-- 사고: 「더헬스 오메가젤리」(#14636) 를 09-29 에 내렸는데 09-30 에 승인이 다시 true 가 돼 카드에 나왔다.
--   사장님이 09-30 저녁에 또 "내려" 하셨는데 **10-01 아침에 또 true** 였다. 두 번 되돌아왔다.
--   gonggu 에 updated_at 이 없어 무엇이 되돌렸는지 못 밝혔다 — 그래서 **범인을 찾는 대신 못 올라오게 막는다.**
--
-- 방법: 내린 공구를 gonggu_hold 에 적어두면 트리거가 approved 를 **무조건 false 로 되돌린다.**
--   어느 경로(크론·셀러데스크·관리자·손등록)로 들어와도 같다. 되살리려면 hold 에서 그 줄을 지운다.
--   되돌리려 한 시도는 events 에 남아 **다음에 범인을 알 수 있다.**

create table if not exists public.gonggu_hold (
  id bigint primary key,
  reason text,
  created_at timestamptz not null default now()
);
revoke all on table public.gonggu_hold from public, anon, authenticated;

create or replace function public.trg_gonggu_hold()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.approved and exists (select 1 from gonggu_hold h where h.id = new.id) then
    begin
      insert into events(event_type, event_data)
      values ('gonggu_hold', format('#%s %s — 승인을 켜려는 시도를 되돌렸다', new.id, left(coalesce(new.name,''), 40)));
    exception when others then null;
    end;
    new.approved := false;
  end if;
  return new;
end $$;

drop trigger if exists gonggu_hold_guard on public.gonggu;
create trigger gonggu_hold_guard before insert or update on public.gonggu
  for each row execute function public.trg_gonggu_hold();

-- 지금 내려야 할 것 — 사장님이 두 번 "내려" 하신 건
insert into gonggu_hold(id, reason) values (14636, '더헬스 오메가젤리 — 사장님 "오메가젤리는 공구 빼놔" (2026-09-29·09-30 두 번)')
on conflict (id) do nothing;
update gonggu set approved = false where id = 14636;

select (select approved::text from gonggu where id = 14636) 오메가젤리_승인,
       (select count(*) from gonggu_hold) 내린_공구수;
