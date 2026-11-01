-- 챗봇 "혹시 이거 찾으세요?" (2026-09-01, 사장님 지시 — 시간마다 학습)
--   손님이 친 말로 공구를 못 찾았을 때, 진행중·예정 공구의 상품명 낱말과 대조해 가까운 걸 되묻는다.
--   ⚠ 자동으로 다른 걸 보여주지 않는다 — 되묻기만 한다(오탐이어도 손님이 무시하면 끝).
--   실측 케이스 ① 머그컵 → 머그(DB 낱말이 더 짧다)  ② 알테리 → 알텐바흐(오타)
create extension if not exists fuzzystrmatch;

create or replace function public.bot_guess(p_kw text)
returns table(word text, cnt bigint)
language plpgsql stable security definer set search_path = public as $$
declare k text := lower(regexp_replace(coalesce(p_kw,''), '\s', '', 'g'));
begin
  if length(k) < 2 then return; end if;
  return query
  with w as (
    select lower(t) tok
      from gonggu g,
           lateral regexp_split_to_table(
             regexp_replace(g.name, '[^가-힣a-zA-Z0-9]+', ' ', 'g'), '\s+') t
     where g.approved
       and to_char(g.end_date::date,'YYYY-MM-DD') >= to_char((now() at time zone 'Asia/Seoul')::date,'YYYY-MM-DD')
       and length(t) between 2 and 12
  ), agg as (
    select tok, count(*)::bigint c from w group by tok having count(*) >= 2
  )
  select a.tok, a.c from agg a
   where a.tok <> k
     and (
       -- 오타만 되묻는다. '손님 말이 더 길다'(머그컵→머그) 규칙은 뺐다 —
       --   머그컵을 찾는 사람에게 머그를 권하는 꼴이라 오히려 틀린 안내였다 (사장님 지적 2026-09-01)
       -- 오타: 첫 글자 같고 편집거리 1~2 (짧은 낱말은 1까지만)
       (left(a.tok,1) = left(k,1)
           and levenshtein(a.tok, k) <= (case when length(k) <= 3 then 1 else 2 end))
     )
   order by levenshtein(a.tok, k), a.c desc
   limit 3;
end $$;

grant execute on function public.bot_guess(text) to anon, authenticated, service_role;
