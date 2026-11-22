-- 규칙 0-M 품목 예외: 내 공구와 「브랜드만 같은」 타 셀러 행을 전부 내리지 않고, 정한 품목만 정한 기간에 내린다 (사장님 2026-11-17)
--   「로지오가닉 전체가 아니라 로지오가닉 + 배도라지(배/도라지/배도라지즙) 품목만 내 공구 기간(11/13~11/22) 동안 숨김 · 떡뻥·퓨레 등은 그대로 노출」
--   · own_window_item_rule 에 내 공구 번호별로 한 줄. 줄이 있는 내 공구는 gg_in_own_window 가 「상품명이 item_re 에 맞고 오픈일이 기간에 걸리는 행」만 막는다.
--     줄이 없는 내 공구는 예전 그대로(브랜드 첫 낱말·같은 상품이면 오픈−14일~마감).
--   · 함수는 오픈일만 받는다. 타 셀러 마감 상한이 오픈+7 이라 「오픈일이 from−7 ~ to」면 기간에 걸리는 행을 빠짐없이 덮는다.
--   · 되돌리기: delete from own_window_item_rule where mine_id=40802;  (예전 판정으로 돌아간다)
create table if not exists public.own_window_item_rule (
  mine_id bigint primary key,
  item_re text not null,
  from_date text not null,
  to_date text not null,
  note text,
  created_at timestamptz not null default now()
);
alter table public.own_window_item_rule enable row level security;
revoke all on public.own_window_item_rule from anon, authenticated;

create or replace function public.gg_in_own_window(p_name text, p_insta text, p_open text)
 returns bigint language sql stable as $function$
  select m.id
    from public.gonggu m
    left join public.own_window_item_rule r on r.mine_id = m.id
   where lower(coalesce(m.insta,'')) = 'momcal_'
     and m.approved
     and lower(coalesce(p_insta,'')) is distinct from 'momcal_'
     and m.open_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
     and (coalesce(m.end_date,'') = '' or m.end_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
     and coalesce(p_open,'') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
     and p_open::date between m.open_date::date - 14
                          and coalesce(nullif(m.end_date,'')::date, m.open_date::date + 3)
     -- 품목 예외 줄이 있으면: 그 품목이고 기간에 걸리는 행만 막는다
     and ( r.mine_id is null
           or ( p_name ~* r.item_re and p_open::date between r.from_date::date - 7 and r.to_date::date ) )
     and (
       (   length(public.gg_own_head(m.name)) >= 2
       and public.gg_own_head(m.name) !~* '(티니핑|포켓몬|뽀로로|핑크퐁|캐치티니핑)'
       and public.gg_own_head(m.name) !~* '^(정품|정식|공식)$'   -- 수식어는 브랜드가 아니다(96)
       and lower(p_name) ~ ('(^|[^가-힣a-z0-9])' || public.gg_own_head(m.name) || '([^가-힣a-z0-9]|$)') )
       or ( public.gg_same_product(m.name, p_name)
            and ( not ( length(public.gg_norm(p_name)) >= 4
                        and public.gg_norm(m.name) like '%' || public.gg_norm(p_name) || '%' )
                  or public.gg_norm(p_name) like '%' || public.gg_norm(public.gg_head_word(m.name)) || '%' ) )
     )
   order by m.id
   limit 1
$function$;

insert into public.own_window_item_rule(mine_id, item_re, from_date, to_date, note)
values (40802, '도라지|배즙', '2026-11-13', '2026-11-22', '사장님 2026-11-17 — 로지오가닉은 배도라지 품목만 내 공구 기간 동안 숨김(떡뻥·퓨레·쌀과자·보리차는 노출)')
on conflict (mine_id) do update set item_re=excluded.item_re, from_date=excluded.from_date, to_date=excluded.to_date, note=excluded.note;
