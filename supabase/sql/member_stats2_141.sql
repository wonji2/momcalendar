-- 관리자 「👥 회원」 탭 통계 보강 (사장님 2026-11-08 「우리 회원수 통계가 없어」 — 참고: 전체 회원·오늘 가입·기준 시각·탈퇴 제외)
--  · 읽기 전용 · 관리자만(is_app_admin) · 회원 표는 탈퇴하면 행이 지워지므로 「전체」는 탈퇴 제외 값이다
--  · 기존 member_stats(p_days) 는 그대로 둔다(5칸). 이 함수가 기준 시각·어제·7일·30일·활성·로그인 방식·성별·연령·일별 추이를 한 번에 준다
create or replace function public.member_stats2()
returns json language plpgsql security definer set search_path = public as $$
declare r json; kd date := (now() at time zone 'Asia/Seoul')::date;
begin
  if not is_app_admin() then raise exception 'admin only'; end if;
  select json_build_object(
    'asof', to_char(now() at time zone 'Asia/Seoul', 'YYYY. MM. DD. HH24:MI:SS'),
    'total', (select count(*) from members),
    'today', (select count(*) from members where (created_at at time zone 'Asia/Seoul')::date = kd),
    'yesterday', (select count(*) from members where (created_at at time zone 'Asia/Seoul')::date = kd - 1),
    'd7', (select count(*) from members where created_at >= now() - interval '7 days'),
    'd30', (select count(*) from members where created_at >= now() - interval '30 days'),
    'active7', (select count(*) from members where last_login_at >= now() - interval '7 days'),
    'active1', (select count(*) from members where last_login_at >= now() - interval '1 day'),
    'by_provider', (select coalesce(json_object_agg(k, c), '{}'::json) from (select coalesce(nullif(provider, ''), '미상') k, count(*) c from members group by 1) t),
    'by_gender', (select coalesce(json_object_agg(k, c), '{}'::json) from (select coalesce(nullif(gender, ''), '미상') k, count(*) c from members group by 1) t),
    'by_age', (select coalesce(json_object_agg(k, c), '{}'::json) from (select coalesce(nullif(age_range, ''), '미상') k, count(*) c from members group by 1) t),
    'daily', (select coalesce(json_agg(json_build_object('d', to_char(d, 'MM/DD'), 'n', n) order by d), '[]'::json)
              from (select g.d, (select count(*) from members m where (m.created_at at time zone 'Asia/Seoul')::date = g.d) n
                    from generate_series(kd - 13, kd, interval '1 day') as g(d)) t)
  ) into r;
  return r;
end $$;
revoke all on function public.member_stats2() from public, anon;
grant execute on function public.member_stats2() to authenticated;
notify pgrst, 'reload schema';
