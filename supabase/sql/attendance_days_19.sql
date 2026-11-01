-- member_check_in 이 도장판(days)까지 돌려주도록 보완.
-- 안 그러면 출석 직후 화면에서 도장이 안 채워져 '된 건지 안 된 건지' 알 수 없다.
create or replace function member_check_in(p_token text)
returns json language plpgsql security definer set search_path = public as $$
declare
  kid text; d date; fresh boolean; n int; total int; streak int := 0; probe date; days int[];
begin
  kid := _member_from_token(p_token);
  if kid is null then return json_build_object('ok', false, 'error', 'login_required'); end if;

  d := (now() at time zone 'Asia/Seoul')::date;   -- ⚠ DB는 UTC라 반드시 한국시간
  insert into attendance (kakao_id, day) values (kid, d) on conflict do nothing;
  get diagnostics n = row_count;
  fresh := (n = 1);

  select coalesce(array_agg(extract(day from day)::int order by day), '{}')
    into days from attendance
   where kakao_id = kid and day >= date_trunc('month', d)::date and day <= d;
  total := coalesce(array_length(days,1), 0);

  probe := d;
  loop
    exit when not exists (select 1 from attendance where kakao_id = kid and day = probe);
    streak := streak + 1;
    probe := probe - 1;
  end loop;

  return json_build_object('ok', true, 'first_today', fresh, 'today', d, 'day', d,
                           'days', days, 'month_days', total, 'streak', streak,
                           'checked_today', true);
end $$;

grant execute on function member_check_in(text) to anon, authenticated;
select 'ok' as result;
