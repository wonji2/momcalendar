-- 출석 경품 추첨을 「공평하게」 — 지난 당첨 이력을 기억해 새 사람이 뽑힐 확률을 높인다 (사장님 2026-11-05
--   「9월 10월 치킨 당첨자가 똑같은데 새로운 사람이 될 확률 더 높게」「당첨자 정보 정도는 기억해서 공평하게」)
--
-- 이력은 이미 attendance_winners(month, tier, kakao_id) 에 남아 있다(발송 체크로 지워지는 건 연락처뿐). 이 표를 추첨에 쓴다.
--
-- 가중치 w = 1 / (1 + 2×(이전 당첨 횟수) + 3×(이전 최상위 등급 3(개근 치킨·피자) 당첨 횟수))
--   · 한 번도 당첨 안 된 사람 = 1
--   · 지난 달 다이소 1번 당첨 = 1/3 (신규의 3분의 1)
--   · 치킨을 1번 받은 사람이 다시 치킨 후보일 때 = 1/6 (치킨은 개근자가 몇 명 안 돼 같은 사람이 반복되기 쉬워서 더 낮춘다)
--   · 후보가 이전 당첨자뿐이어도 뽑힌다(가중치는 후보끼리의 상대 비교일 뿐 — 아무도 영영 제외되지 않는다)
-- 뽑는 법: 가중치 비복원 추출(지수 경쟁) — key = -ln(U)/w 가 작은 순서. 기존 order by random() 자리만 바뀐다.
-- 한 사람이 한 달에 한 번만 당첨·높은 등급부터 뽑는 규칙은 그대로.

create or replace function public._att_weight(p_kakao text, p_month date)
returns double precision language sql stable security definer set search_path to 'public' as $$
  select 1.0 / (1 + 2.0 * count(*) + 3.0 * count(*) filter (where tier = 3))
    from attendance_winners w
   where w.kakao_id = p_kakao and w.month < p_month
$$;
revoke all on function public._att_weight(text, date) from public, anon, authenticated;

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
  order by -ln(1.0 - random()) / _att_weight(a.kakao_id, m)
  limit greatest(p_count, 0)
  on conflict (month, kakao_id) do nothing;

  get diagnostics n = row_count;
  return json_build_object('ok', true, 'drawn', n);
end $function$;

create or replace function public.attendance_auto_draw()
 returns json language plpgsql security definer set search_path to 'public' as $function$
declare m date; lastd int; total int := 0; n int;
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
    insert into attendance_winners (month, tier, kakao_id, nickname, days, prize, approved_at)
    select m, t.tier, a.kakao_id, mb.nickname, a.days, t.prize, now()
    from _att_days(m) a
    left join members mb on mb.kakao_id = a.kakao_id
    where a.days >= t.need
      and not exists (select 1 from attendance_winners w where w.month = m and w.kakao_id = a.kakao_id)
    order by -ln(1.0 - random()) / _att_weight(a.kakao_id, m)
    limit t.cnt
    on conflict (month, kakao_id) do nothing;
    get diagnostics n = row_count;
    total := total + n;
  end loop;

  if total > 0 then
    insert into health_alerts(kind, detail)
    values ('출석경품추첨완료',
            to_char(m,'YYYY-MM') || ' 출석 경품 ' || total || '명 자동 추첨·승인됨(지난 당첨 이력 반영 — 새 사람 우선) — 당첨자 화면에 안내가 떴고 연락처를 받는 중 (/당첨자 로 명단 확인)');
  end if;
  return json_build_object('ok', true, 'month', m, 'drawn', total);
end $function$;
