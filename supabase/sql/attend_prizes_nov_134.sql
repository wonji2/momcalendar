-- 출석 경품 개편 — 11월분부터 (사장님 2026-11-05): 20일 이상 3명 커피 기프티콘 · 25일 이상 2명 다이소 3천원권 · 개근 1명 맥도날드 버거세트, 전부 추첨
--   내려가기(캐스케이드): 높은 등급부터 뽑고, 개근 추첨에서 안 뽑힌 개근자는 25일 이상 후보에, 거기서도 안 뽑히면 20일 이상 후보에 그대로 남아 함께 추첨된다
--   (후보 조건이 days >= 기준 이라 자동으로 그렇게 된다 · 한 사람은 한 달에 한 번만 당첨). 신규 우선(attend_draw_fair_133.sql)·승인 대기 규칙은 그대로.
--   이미 뽑은 달은 건너뛰므로 10월 이전 결과는 바뀌지 않는다. 다음 자동 추첨 = 12월 1일(11월분)

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
      (3, lastd, 1, '맥도날드 버거세트'),
      (2, 25,    2, '다이소 3천원권'),
      (1, 20,    3, '커피 기프티콘')
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
