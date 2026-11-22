-- 📋 출석 통계 고도화 (사장님 지시 2026-08-18)
--   "출석한사람 오늘자 명단도 내가 볼 수 있어야 될 것 같은데 출석 통계 고도화 시켜봐"
--
-- 기존 admin_attendance_stats 는 **숫자만** 준다(등급별 인원 등). 누가 찍었는지는 볼 수 없었다.
-- → 날짜별 명단 + 요약 지표를 함께 주는 함수를 새로 만든다.
--
-- ⚠ 개인정보: 닉네임과 카카오 회원번호만 쓴다(연락처는 당첨자 입력분이라 여기서 다루지 않는다).
-- ⚠ 관리자 전용 — is_app_admin() 통과해야만 응답한다.
create or replace function public.admin_attendance_day(p_day date default null)
returns json language plpgsql security definer set search_path to 'public' as $function$
declare d date; res json;
begin
  if not is_app_admin() then raise exception 'forbidden'; end if;
  d := coalesce(p_day, (now() at time zone 'Asia/Seoul')::date);

  select json_build_object(
    'day', d,
    -- ① 오늘 요약
    'today_count',  (select count(*) from attendance where day = d),
    'yday_count',   (select count(*) from attendance where day = d - 1),
    'week_count',   (select count(distinct kakao_id) from attendance where day > d - 7 and day <= d),
    'month_count',  (select count(distinct kakao_id) from attendance
                       where day >= date_trunc('month', d)::date and day <= d),
    'total_members',(select count(*) from members),
    -- ② 오늘 찍은 사람 명단 (연속일수·누적일수·이달일수 포함, 연속 긴 순)
    'list', coalesce((
      select json_agg(x order by x.streak desc, x.month_days desc, x.nickname)
      from (
        select a.kakao_id,
               coalesce(nullif(m.nickname,''), '(닉네임없음)') nickname,
               to_char(a.created_at at time zone 'Asia/Seoul', 'HH24:MI') at_time,
               (select count(*) from attendance a2 where a2.kakao_id = a.kakao_id) total_days,
               (select count(*) from attendance a3 where a3.kakao_id = a.kakao_id
                  and a3.day >= date_trunc('month', d)::date and a3.day <= d) month_days,
               -- 연속 출석: 오늘부터 하루씩 거슬러 올라가며 끊기는 지점을 찾는다
               (select count(*) from generate_series(0, 400) g(i)
                 where exists (select 1 from attendance a4 where a4.kakao_id = a.kakao_id and a4.day = d - g.i)
                   and not exists (
                     select 1 from generate_series(0, g.i) h(j)
                     where not exists (select 1 from attendance a5
                                        where a5.kakao_id = a.kakao_id and a5.day = d - h.j))
               ) streak
        from attendance a
        left join members m on m.kakao_id = a.kakao_id
        where a.day = d
      ) x), '[]'::json),
    -- ③ 최근 14일 추이 (그래프용)
    'trend', coalesce((
      select json_agg(json_build_object('day', g.dd, 'n', (select count(*) from attendance a where a.day = g.dd))
                      order by g.dd)
      from generate_series(d - 13, d, interval '1 day') g(dd)), '[]'::json),
    -- ④ 이달 상위 출석자 (경품 등급 판단용)
    'top', coalesce((
      select json_agg(json_build_object('nickname', coalesce(nullif(m.nickname,''),'(닉네임없음)'),
                                        'kakao_id', t.kakao_id, 'days', t.days) order by t.days desc)
      from (select kakao_id, count(*) days from attendance
             where day >= date_trunc('month', d)::date and day <= d
             group by kakao_id order by count(*) desc limit 20) t
      left join members m on m.kakao_id = t.kakao_id), '[]'::json)
  ) into res;
  return res;
end $function$;

revoke all on function public.admin_attendance_day(date) from public, anon;
grant execute on function public.admin_attendance_day(date) to authenticated;
