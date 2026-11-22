-- 🔴 규칙 0-M 이 **브랜드 없는 막연한 이름**까지 끌어내렸다 (사장님 지시 2026-10-06)
--
--   *"자석블럭들은 그냥 둬 이건 겹치는템 거의 없어 똑같이 마인크래프트라는 이름 들어간 상품만 2주내로 내리면 됨"*
--
-- 무슨 일이었나: 내 「마인크래프트 미니자석블럭」(10/20~10/25)을 넣으면 창 안의
--   `kongal.pick` #24679 「자석블럭」 · `kongal.mom` #27753 「자석블럭」 **2건이 내려갈 참이었다.**
--   둘 다 브랜드가 없는 그냥 「자석블럭」이라 내 마인크래프트와 겹치는 상품이 아니다.
--
-- 원인: `gg_same_product` 의 **포함검사** 갈래. 글자를 정규화하면
--   「자석블럭」 ⊂ 「마인크래프트미니자석블럭」 이라 그대로 통과한다.
--   이 갈래에는 브랜드 가드가 없다(낱말겹침 갈래에만 있다). 실측:
--     「자석블럭」           포함검사=true  내브랜드품나=false → 🔴 걸렸다
--     「벨베이비 자석블럭」    포함검사=false              → ✅ 안 걸린다(브랜드 가드가 막는다)
--     「맥씽크 마인크래프트 자석블럭 300pcs」 포함검사=false 내브랜드품나=true → ✅ 걸린다(내려야 할 것)
--
-- 고침: **포함검사로만 걸린 경우에는, 상대 이름이 내 앞 낱말(브랜드)을 품고 있어야** 내린다.
--   사장님 말씀 그대로 — 「똑같이 마인크래프트라는 이름 들어간 상품만」.
--   ⚠ 규칙 0-M 원문 사례는 그대로 산다: 내 「룰라러브 천연해면스펀지」 ↔ 「룰라러브 천연해면」 은
--     포함검사=true 이면서 **룰라러브를 품고 있어** 계속 내려간다(확인함).
--   ⚠ 포함검사가 아닌 갈래(낱말겹침·오타·어순)는 **건드리지 않았다** — 브랜드 가드가 이미 들어 있다.
--     「우리별피자」 ↔ 「우리별 수제 화덕피자 10인치」 는 포함검사가 아니라 그대로 내려간다(확인함).
--
-- ⚠ 이 변경으로 **더는 안 걸리게 되는 과거 건**: 내 「룰라러브 천연해면스펀지」 ↔ #23967 「해면스펀지」.
--   브랜드가 없는 이름이라 새 규칙에선 안 내린다. 되살릴지는 사장님께 여쭌다(이 파일은 되살리지 않는다).

create or replace function public.gg_in_own_window(p_name text, p_insta text, p_open text)
returns bigint language sql stable as $$
  select m.id
    from public.gonggu m
   where lower(coalesce(m.insta,'')) = 'momcal_'
     and m.approved
     and lower(coalesce(p_insta,'')) is distinct from 'momcal_'
     and m.open_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
     and (coalesce(m.end_date,'') = '' or m.end_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
     and coalesce(p_open,'') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
     and p_open::date between m.open_date::date - 14
                          and coalesce(nullif(m.end_date,'')::date, m.open_date::date + 3)
     and public.gg_same_product(m.name, p_name)
     -- 🔑 포함검사로만 걸린 것은 **내 브랜드 낱말을 품은 경우에만** 내린다
     and (
       not (
         length(public.gg_norm(p_name)) >= 4
         and public.gg_norm(m.name) like '%' || public.gg_norm(p_name) || '%'
       )
       or public.gg_norm(p_name) like '%' || public.gg_norm(public.gg_head_word(m.name)) || '%'
     )
   order by m.id
   limit 1
$$;

-- 재스윕 트리거도 같은 잣대를 쓰게 한다 (내 공구를 올릴 때 창 안을 쓰는 쪽)
create or replace function public.trg_gonggu_own_resweep()
returns trigger language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if pg_trigger_depth() > 1 then return null; end if;
  if lower(coalesce(new.insta,'')) <> 'momcal_' or not coalesce(new.approved,false) then return null; end if;
  if coalesce(new.open_date,'') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then return null; end if;
  if coalesce(new.end_date,'') <> '' and new.end_date !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then return null; end if;

  with win as (select new.open_date::date - 14 as f,
                      coalesce(nullif(new.end_date,'')::date, new.open_date::date + 3) as t)
  update public.gonggu g
     set approved = false
    from win
   where g.approved
     and lower(coalesce(g.insta,'')) <> 'momcal_'
     and g.open_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
     and g.open_date::date between win.f and win.t
     and g.end_date >= to_char((now() at time zone 'Asia/Seoul')::date, 'YYYY-MM-DD')
     and public.gg_same_product(new.name, g.name)
     -- 🔑 위와 같은 잣대 — 포함검사로만 걸린 막연한 이름은 내리지 않는다
     and (
       not (
         length(public.gg_norm(g.name)) >= 4
         and public.gg_norm(new.name) like '%' || public.gg_norm(g.name) || '%'
       )
       or public.gg_norm(g.name) like '%' || public.gg_norm(public.gg_head_word(new.name)) || '%'
     );
  get diagnostics n = row_count;

  if n > 0 then
    begin
      insert into events(event_type, event_data)
      values ('own_window_sweep',
              format('규칙 0-M: 내 공구 #%s %s 가 올라와 창 안 타셀러 %s건을 내렸다',
                     new.id, left(coalesce(new.name,''), 40), n));
    exception when others then null;
    end;
  end if;
  return null;
end $$;

-- ⚠ 무거운 전수검사를 이 파일 꼬리에 붙이지 말 것 — 한 트랜잭션이라 통째로 되감긴다(2026-10-06 실측).
select (select count(*) from pg_trigger where tgname = 'gonggu_own_window')  as 막기_트리거,
       (select count(*) from pg_trigger where tgname = 'gonggu_own_resweep') as 쓸기_트리거;
