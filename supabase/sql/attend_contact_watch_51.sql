-- 당첨자 연락처가 다 들어오면 알린다 (사장님 지시 2026-09-02 "전화번호 3개 다 들어오면 말해줘")
--
-- 당첨 안내는 손님이 사이트에 들어와야 보이므로 번호가 언제 들어올지 모른다.
-- 매시간 서버가 대신 지켜보다가 **그 달 당첨자 전원이 번호를 남기면** 경보를 남긴다.
-- 세션 시작 루틴(/이어서)이 health_alerts 를 보므로, 다음 세션이 사장님께 보고한다.
--   ⚠ 경보에 전화번호는 넣지 않는다 — 개인정보다. 이름·경품까지만.
create or replace function public.attendance_contact_check()
returns json language plpgsql security definer set search_path to 'public' as $function$
declare r record; made int := 0; tag text;
begin
  for r in
    select month,
           count(*) as total,
           count(contact) as got,
           count(*) filter (where sent_at is not null) as sent,
           string_agg(nickname || '(' || prize || ')', ', ' order by tier desc) as who
      from attendance_winners
     where approved_at is not null
     group by month
  loop
    -- 전원 번호를 남겼고 아직 아무에게도 안 보냈을 때만
    if r.total > 0 and r.got = r.total and r.sent = 0 then
      tag := to_char(r.month, 'YYYY-MM');
      -- 같은 달로 이미 알렸으면 다시 만들지 않는다 (매시간 도므로 중복 방지)
      if not exists (select 1 from health_alerts
                      where kind = '출석경품연락처완료' and detail like tag || '%') then
        insert into health_alerts(kind, detail)
        values ('출석경품연락처완료',
                tag || ' 당첨자 ' || r.total || '명 전원 연락처 입력 완료 — 기프티콘 보내시면 됩니다: ' || r.who);
        made := made + 1;
      end if;
    end if;
  end loop;
  return json_build_object('ok', true, 'alerted', made);
end $function$;

revoke all on function public.attendance_contact_check() from public, anon, authenticated;
