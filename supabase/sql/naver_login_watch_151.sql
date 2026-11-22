-- 네이버 로그인 감시 (2026-11-16 · 사장님 「니가 계속 지켜봐 나 아이폰없어」) — 서버에서 매시간, PC 가 꺼져도 돈다
--   11-16 에 네이버 버튼을 웹·갤럭시 앱·아이폰 앱 전부에 열었다. 실제 계정으로 끝까지 되는지는 손님 기록으로만 알 수 있다.
--   events 의 naver_login_start / naver_login_done 에 어디서 눌렀는지(web·app_android·app_ios)가 event_data 로 들어온다(index.html _nvWhere).
--   최근 24시간에 한 곳에서 4번 이상 시작했는데 완료가 0이면 health_alerts 'naver로그인:<곳>' 에 한 줄. 완료가 생기면 스스로 지운다.
--   옛 기록(event_data 'app'·'')은 'app' 으로 묶는다. 자동 시험(e2e)은 세지 않는다.
--   한도: health_alerts 는 곳마다 최대 1행(지우고 다시 넣는다). events 읽기는 24시간 창 + event_type 조건.
create or replace function public.naver_login_watch()
 returns json language plpgsql security definer set search_path to 'public'
as $function$
declare r record; v_out json;
begin
  for r in
    with ev as (
      select event_type t,
             case when coalesce(event_data::text,'') in ('web','app_android','app_ios') then event_data::text
                  when coalesce(event_data::text,'') = 'e2e' then 'e2e' else 'app' end w
      from events
      where visited_at > greatest(now() - interval '24 hours', timestamptz '2026-11-16T01:51:00Z')   -- 그 전 기록은 배포 날 자동 도구로 누른 시험(웹 6번)이라 세지 않는다. 앞으로 자동 시험은 주소에 e2e=nv 를 붙여 e2e 로 남긴다
        and event_type in ('naver_login_start','naver_login_done')
    ), agg as (
      select w, count(*) filter (where t='naver_login_start') s, count(*) filter (where t='naver_login_done') d
      from ev where w <> 'e2e' group by w
    )
    select x.w, coalesce(a.s,0) s, coalesce(a.d,0) d
    from (values ('web'),('app_android'),('app_ios'),('app')) x(w) left join agg a on a.w = x.w
  loop
    delete from health_alerts where kind = 'naver로그인:' || r.w;
    if r.s >= 4 and r.d = 0 then
      insert into health_alerts(kind, detail)
      values ('naver로그인:' || r.w,
              '최근 24시간 네이버 로그인 시작 ' || r.s || '번 · 완료 0번 (' || r.w || '). 실패 사유: ' ||
              coalesce((select string_agg(k || ' ' || n, ', ') from (
                 select coalesce(nullif(event_data::text,''),'(빈값)') k, count(*) n from events
                 where visited_at > now() - interval '24 hours' and event_type in ('naver_login_fail','naver_login_cancel')
                 group by 1 order by 2 desc limit 5) f), '기록 없음(네이버 화면에서 멈춤)') ||
              case when r.w = 'app_ios' then ' — 아이폰 앱에서 네이버 화면이 사파리로 넘어가는지 의심. index.html nvAvail 의 ios 를 끄는 것을 검토' else '' end);
    end if;
  end loop;
  select json_agg(json_build_object('kind', kind, 'detail', left(detail, 80))) into v_out from health_alerts where kind like 'naver로그인:%';
  return coalesce(v_out, '[]'::json);
end $function$;
revoke all on function public.naver_login_watch() from public, anon, authenticated;
grant execute on function public.naver_login_watch() to service_role;
select cron.unschedule('naver-login-watch') where exists (select 1 from cron.job where jobname = 'naver-login-watch');
select cron.schedule('naver-login-watch', '7 * * * *', $$select public.naver_login_watch()$$);
select json_build_object('run', public.naver_login_watch(), 'job', (select schedule from cron.job where jobname = 'naver-login-watch')) j;
