-- 관리자 화면용 챗봇 대화 조회 (2026-09-01, 사장님 지시)
--   카카오 관리자센터에는 챗봇 대화가 남지 않는다 → 우리가 events 에 쌓고 여기서 보여준다.
--   ⚠ events 는 경쟁사 방어로 anon 열람 차단 상태 → SECURITY DEFINER + is_app_admin() 게이트로만 연다.
--   ⚠ event_data 형식: '발화 | uid=xxxxxx:타입:UA | 응답형태'  (uid=CLAUDETE/HEALTHCH = 개발 테스트)

-- ① 최근 대화 목록
create or replace function public.admin_bot_log(p_days int default 3, p_limit int default 100)
returns table(kst timestamp, utterance text, who text, answer text, is_test boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_app_admin() then return; end if;
  return query
  select (e.visited_at at time zone 'Asia/Seoul')::timestamp(0),
         split_part(e.event_data, ' | ', 1),
         split_part(split_part(e.event_data, ' | ', 2), ':', 1),
         split_part(e.event_data, ' | ', 3),
         (e.event_data like '%CLAUDETE%' or e.event_data like '%HEALTHCH%' or e.event_data not like '%AHC%')
    from events e
   where e.event_type = 'kakao_bot'
     and e.visited_at > now() - (p_days || ' days')::interval
   order by e.id desc
   limit greatest(1, least(p_limit, 300));
end $$;

-- ② 못 알아들은 말 (많이 물어본 순) — 이걸 보고 말투 규칙·bot_alias 를 채운다
create or replace function public.admin_bot_miss(p_days int default 7, p_limit int default 50)
returns table(keyword text, cnt bigint, last_kst timestamp, sample text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_app_admin() then return; end if;
  return query
  select split_part(e.event_data, ' <= ', 1) as kw,
         count(*)::bigint,
         max(e.visited_at at time zone 'Asia/Seoul')::timestamp(0),
         max(split_part(e.event_data, ' <= ', 2))
    from events e
   where e.event_type = 'kakao_bot_miss'
     and e.visited_at > now() - (p_days || ' days')::interval
   group by 1
   order by 2 desc, 3 desc
   limit greatest(1, least(p_limit, 200));
end $$;

-- ③ 많이 물어본 말 (실제 손님만)
create or replace function public.admin_bot_top(p_days int default 7, p_limit int default 30)
returns table(utterance text, cnt bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_app_admin() then return; end if;
  return query
  select split_part(e.event_data, ' | ', 1) as ut, count(*)::bigint
    from events e
   where e.event_type = 'kakao_bot'
     and e.event_data like '%AHC%'
     and e.visited_at > now() - (p_days || ' days')::interval
   group by 1 order by 2 desc limit greatest(1, least(p_limit, 100));
end $$;

revoke all on function public.admin_bot_log(int,int)  from public, anon;
revoke all on function public.admin_bot_miss(int,int) from public, anon;
revoke all on function public.admin_bot_top(int,int)  from public, anon;
grant execute on function public.admin_bot_log(int,int)  to authenticated, service_role;
grant execute on function public.admin_bot_miss(int,int) to authenticated, service_role;
grant execute on function public.admin_bot_top(int,int)  to authenticated, service_role;
