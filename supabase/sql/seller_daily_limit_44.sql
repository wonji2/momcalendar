-- 셀러 셀프 등록: 같은 오픈일 최대 3건 (사장님 지시 2026-09-01)
--
-- 왜: 한 셀러가 특정 날짜에 여러 건을 몰아 올려 그날 캘린더를 점유하는 일이 있었다
--     ("동시다발적으로 물량치기"). 손님이 보는 건 날짜별 캘린더라 하루를 도배하면 다른 셀러가 밀린다.
--
-- 규칙: 같은 셀러(insta) + 같은 open_date 로 **최대 3건**.
--       · 이미 DB 에 있는 건수 + 이번에 넣는 건수 를 합쳐서 센다
--       · 미승인(approved=false) 건도 센다 — 안 그러면 대기 상태로 무한히 쌓을 수 있다
--       · 한도를 넘는 행은 조용히 버리지 않고 **몇 건이 빠졌는지 돌려준다**
--       · 관리자(내가 직접 INSERT)는 이 제한과 무관하다 — 이 RPC 는 셀러 페이지 전용이다
create or replace function public.seller_add_gonggu(p_token text, p_rows jsonb)
returns json
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  v_login text; v_insta text; v_infl text; v_handle text;
  v_cnt int; v_try int; v_limit constant int := 3;
begin
  select t.login_insta, t.seller_insta, t.seller_influencer
    into v_login, v_insta, v_infl
    from _seller_from_token(p_token) t;
  if v_login is null then raise exception 'unauthorized' using errcode = '28000'; end if;

  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    return json_build_object('ok', false, 'msg', 'empty');
  end if;
  if jsonb_array_length(p_rows) > 50 then
    return json_build_object('ok', false, 'msg', 'toomany');
  end if;

  v_handle := replace(coalesce(nullif(v_insta,''), v_login), '@', '');

  with src as (
    select left(trim(x->>'name'), 120)      as nm,
           left(x->>'major', 40)            as mj,
           left(x->>'minor', 40)            as mn,
           x->>'open_date'                  as od,
           nullif(x->>'end_date', '')       as ed,
           left(x->>'color', 20)            as co,
           nullif(left(x->>'pay_link', 500), '') as pl,
           row_number() over (partition by x->>'open_date' order by ord) as rn
      from jsonb_array_elements(p_rows) with ordinality t(x, ord)
     where coalesce(trim(x->>'name'), '') <> ''
       and (x->>'open_date') ~ '^\d{4}-\d{2}-\d{2}$'
       and (coalesce(x->>'end_date','') = '' or (x->>'end_date') ~ '^\d{4}-\d{2}-\d{2}$')
  ), counted as (
    select s.*,
           (select count(*) from gonggu g
             where g.insta = v_handle and g.open_date = s.od) as have
      from src s
  )
  select count(*) into v_try from counted;

  with src as (
    select left(trim(x->>'name'), 120)      as nm,
           left(x->>'major', 40)            as mj,
           left(x->>'minor', 40)            as mn,
           x->>'open_date'                  as od,
           nullif(x->>'end_date', '')       as ed,
           left(x->>'color', 20)            as co,
           nullif(left(x->>'pay_link', 500), '') as pl,
           row_number() over (partition by x->>'open_date' order by ord) as rn
      from jsonb_array_elements(p_rows) with ordinality t(x, ord)
     where coalesce(trim(x->>'name'), '') <> ''
       and (x->>'open_date') ~ '^\d{4}-\d{2}-\d{2}$'
       and (coalesce(x->>'end_date','') = '' or (x->>'end_date') ~ '^\d{4}-\d{2}-\d{2}$')
  )
  insert into gonggu (name, major, minor, open_date, end_date, color, pay_link, insta, influencer, approved)
  select s.nm, s.mj, s.mn, s.od, s.ed, s.co, s.pl,
         v_handle, coalesce(nullif(v_infl,''), v_login), false
    from src s
   where (select count(*) from gonggu g
           where g.insta = v_handle and g.open_date = s.od) + s.rn <= v_limit;

  get diagnostics v_cnt = row_count;

  return json_build_object(
    'ok', true,
    'count', v_cnt,
    'skipped', greatest(v_try - v_cnt, 0),
    'limit', v_limit,
    'msg', case when v_try > v_cnt
                then '같은 오픈일에는 최대 ' || v_limit || '건까지 등록할 수 있어요. ' ||
                     (v_try - v_cnt) || '건은 등록되지 않았습니다.'
                else '' end
  );
end;
$function$;
