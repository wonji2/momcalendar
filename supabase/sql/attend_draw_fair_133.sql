-- 출석 경품 추첨 규칙 (사장님 2026-11-05 · 매 이벤트 공통)
--   「9월 10월 치킨 당첨자가 똑같은데 새로운 사람이 될 확률 더 높게」「당첨자 정보 정도는 기억해서 공평하게」
--   「당첨자는 니가 뽑아서 맘대로 안내 나가지 말고 나한테 물어보고 보고하고 안내해 · 왠만하면 한번도 안 뽑혔던 사람이 뽑히게 · 정말 어쩔 수 없이 기당첨자뿐일 때 빼고는」
--
-- ① 한 번도 당첨 안 된 사람이 먼저 뽑힌다. 자리가 남을 때만 기당첨자를 쓰고, 그 안에서도 이전 당첨 횟수가 적은 사람부터.
--    (같은 조건 안에서는 무작위) — 이력은 attendance_winners(month, kakao_id) 에 이미 남아 있다(발송 체크로 지워지는 건 연락처뿐)
-- ② 자동 추첨은 뽑기만 한다 — 당첨 안내(본인 화면·연락처 받기)는 **사장님께 보고하고 승인한 뒤에만** 나간다(approved_at 비워 둔다).
--    승인: 관리자 💜 출석·추첨 탭 또는 /당첨자 에서 사장님이 「안내해」 하신 뒤에만 (winner_report.mjs --approve)
-- 한 사람이 한 달에 한 번만 당첨·높은 등급부터 뽑는 규칙은 그대로.

create or replace function public._att_prior(p_kakao text, p_month date)
returns integer language sql stable security definer set search_path to 'public' as $$
  select count(*)::int from attendance_winners w where w.kakao_id = p_kakao and w.month < p_month
$$;
revoke all on function public._att_prior(text, date) from public, anon, authenticated;
drop function if exists public._att_weight(text, date);

create or replace function public.admin_attendance_draw(p_month date, p_tier integer, p_count integer, p_prize text)
 returns json language plpgsql security definer set search_path to 'public' as $function$
declare m date; lastd int; need int; n int;
begin
  if not is_app_admin() then raise exception 'forbidden'; end if;
  m := date_trunc('month', p_month)::date;
  lastd := _month_last(m);
  need := case p_tier when 3 then lastd when 2 then 25 else 20 end;

  insert into attendance_winners (month, tier, kakao_id, nickname, days, prize)
  select m, p_tier, a.kakao_id, mb.nickname, a.days, p_prize
  from _att_days(m) a
  left join members mb on mb.kakao_id = a.kakao_id
  where a.days >= need
    and not exists (select 1 from attendance_winners w where w.month = m and w.kakao_id = a.kakao_id)
  order by (_att_prior(a.kakao_id, m) > 0), _att_prior(a.kakao_id, m), random()
  limit greatest(p_count, 0)
  on conflict (month, kakao_id) do nothing;

  get diagnostics n = row_count;
  return json_build_object('ok', true, 'drawn', n);
end $function$;

create or replace function public.attendance_auto_draw()
 returns json language plpgsql security definer set search_path to 'public' as $function$
declare m date; lastd int; total int := 0; n int; repeat_n int;
        t record;
begin
  m := (date_trunc('month', (now() at time zone 'Asia/Seoul')::date) - interval '1 month')::date;
  lastd := _month_last(m);

  if exists (select 1 from attendance_winners where month = m) then
    return json_build_object('ok', true, 'skipped', 'already_drawn', 'month', m);
  end if;

  for t in select * from (values
      (3, lastd, 1, '치킨 or 피자'),
      (2, 25,    3, '다이소 3천원권'),
      (1, 20,    5, '커피 기프티콘')
    ) as v(tier, need, cnt, prize)
  loop
    -- 승인(approved_at)은 비워 둔다 — 사장님께 보고하고 승인한 뒤에만 안내가 나간다
    insert into attendance_winners (month, tier, kakao_id, nickname, days, prize)
    select m, t.tier, a.kakao_id, mb.nickname, a.days, t.prize
    from _att_days(m) a
    left join members mb on mb.kakao_id = a.kakao_id
    where a.days >= t.need
      and not exists (select 1 from attendance_winners w where w.month = m and w.kakao_id = a.kakao_id)
    order by (_att_prior(a.kakao_id, m) > 0), _att_prior(a.kakao_id, m), random()
    limit t.cnt
    on conflict (month, kakao_id) do nothing;
    get diagnostics n = row_count;
    total := total + n;
  end loop;

  select count(*) into repeat_n from attendance_winners w where w.month = m and _att_prior(w.kakao_id, m) > 0;

  if total > 0 then
    insert into health_alerts(kind, detail)
    values ('출석경품추첨완료',
            to_char(m,'YYYY-MM') || ' 출석 경품 ' || total || '명 추첨됨(아직 안내 안 나감) — 이전 당첨자 ' || repeat_n
            || '명 포함. /당첨자 로 명단 보고 받으시고, 사장님이 「안내해」 하시면 승인');
  end if;
  return json_build_object('ok', true, 'month', m, 'drawn', total, 'repeat', repeat_n);
end $function$;
