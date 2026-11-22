-- 개근 경품 날짜별 예약 (사장님 2026-11-05): 12월분(2027-01-01 추첨)부터 개근 = 올리브영 1만원권. 11월분(12-01 추첨)까지는 맥도날드 버거세트. 20일↑ 3명 커피·25일↑ 2명 다이소는 그대로
--   뽑는 달(m)을 보고 고르므로 추첨 날 사람이 아무것도 안 해도 맞는 경품이 들어간다. 나머지 규칙(신규 우선·승인 대기)은 그대로.

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
      (3, lastd, 1, case when m >= date '2026-12-01' then '올리브영 1만원권' else '맥도날드 버거세트' end),
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
