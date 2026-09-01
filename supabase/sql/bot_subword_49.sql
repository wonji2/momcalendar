-- 붙여 쓴 말에서 상품명 낱말을 찾아낸다 (2026-09-01, 사장님 지시)
--   "동결건조국 있냐고 하면 상품명이랑 대조해서 높은 확률인걸 알려줘야해"
--   예) 아기곰탕 → '곰탕'(진행중 9건) · 오징어블록 → '블록'
--   ⚠ 되묻기(bot_guess)와 달리 이건 **바로 결과를 보여주기 위한** 것이다.
--      그래서 진행중 건수가 많은(=흔한 품목) 낱말을 고르고, 2글자 이상만 본다.
create or replace function public.bot_subword(p_kw text)
returns table(word text, cnt bigint)
language plpgsql stable security definer set search_path = public as $$
declare k text := lower(regexp_replace(coalesce(p_kw,''), '\s', '', 'g'));
begin
  if length(k) < 3 then return; end if;
  return query
  with w as (
    select lower(t) tok
      from gonggu g,
           lateral regexp_split_to_table(
             regexp_replace(g.name, '[^가-힣a-zA-Z0-9]+', ' ', 'g'), '\s+') t
     where g.approved
       and to_char(g.end_date::date,'YYYY-MM-DD') >= to_char((now() at time zone 'Asia/Seoul')::date,'YYYY-MM-DD')
       and length(t) between 2 and 10
  ), agg as (
    select tok, count(*)::bigint c from w group by tok
  )
  select a.tok, a.c from agg a
   where a.tok <> k
     and length(a.tok) >= 2
     and position(a.tok in k) > 0          -- 손님 말 안에 그 낱말이 들어 있다
   order by length(a.tok) desc, a.c desc   -- 긴 낱말 우선(아기곰탕 → 곰탕)
   limit 3;
end $$;
grant execute on function public.bot_subword(text) to anon, authenticated, service_role;
