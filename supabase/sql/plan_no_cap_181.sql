-- 이웃셀러 동시 12명 제한 풀기 (사장님 2026-11-23 「12명이라고 정해두지마 걍 인원을 더 받을 수 있음 더받게」)
--   다섯 함수(seller_plan_start · seller_plan_card_order · plan_card_begin · _plan_show · seller_plan_status)에 박힌 12 를
--   public._plan_cap() 하나로 바꾼다. 기본값 = 제한 없음(1,000,000). 다시 정원을 두려면:
--     insert into app_private_config(key,value) values ('plan_cap','20') on conflict (key) do update set value=excluded.value, updated_at=now();
--   함수 본문은 운영 DB 의 지금 정의를 읽어 글자만 바꿔 다시 만든다(다른 판 파일로 되돌아가지 않게). 바꿀 자리가 없으면 멈춘다.
-- 되돌리기: insert … ('plan_cap','12') 로 정원만 되돌리면 된다(함수는 그대로 _plan_cap 을 읽는다).

create or replace function public._plan_cap() returns int
language sql stable security definer set search_path to 'public', 'pg_temp' as $$
  select coalesce((select nullif(value, '')::int from app_private_config where key = 'plan_cap'), 1000000)
$$;
revoke all on function public._plan_cap() from public, anon, authenticated;

do $$
declare f text; d text; n int := 0;
begin
  foreach f in array array['public.seller_plan_start(text,integer,text)', 'public.seller_plan_card_order(text)', 'public.plan_card_begin', 'public._plan_show(bigint,date,date)', 'public.seller_plan_status(text)'] loop
    if f = 'public.plan_card_begin' then
      select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname = 'plan_card_begin' limit 1;
    else
      d := pg_get_functiondef(f::regprocedure);
    end if;
    if d is null then raise exception '함수 없음: %', f; end if;
    if d !~ '(>= 12\M|\m12 - public\._plan_slots_used)' then raise exception '바꿀 자리 없음: %', f; end if;
    d := regexp_replace(d, '>= 12\M', '>= public._plan_cap()', 'g');
    d := regexp_replace(d, '\m12 - public\._plan_slots_used', 'public._plan_cap() - public._plan_slots_used', 'g');
    execute d;
    n := n + 1;
  end loop;
  raise notice '바꾼 함수 %개', n;
end $$;

select p.proname, pg_get_functiondef(p.oid) ~ '_plan_cap' uses_cap, pg_get_functiondef(p.oid) ~ '>= 12\M' still_12
  from pg_proc p join pg_namespace s on s.oid = p.pronamespace
 where s.nspname = 'public' and p.prokind = 'f' and p.proname in ('seller_plan_start', 'seller_plan_card_order', 'plan_card_begin', '_plan_show', 'seller_plan_status');
