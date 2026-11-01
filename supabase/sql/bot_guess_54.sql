-- 챗봇 되묻기: **치환 오타만** 되묻는다 (2026-09-02)
--
-- 문제: 편집거리만 보니 '글자가 빠진 것' 도 오타로 쳐서 브랜드를 깎아 되물었다.
--   디자인스킨 → "혹시 '디자인' 찾으셨을까요?"   (디자인스킨을 찾는 사람에게 '디자인' 을 권한다)
--   미니국자   → "혹시 '미니' · '미니웨건' …"     (미니국자와 미니웨건은 다른 물건이다)
--
-- 🔑 이건 2026-09-02 자동학습(bot_learn)에서 이미 고친 것과 **같은 결함**이다:
--    "편집거리 1 만 봤다 → 길이가 달라도 통과('브라운'→'브라' 는 삭제 1회).
--     오타는 보통 치환이지 글자가 빠지는 게 아니다" → 그때는 bot_learn 만 고쳤다.
--    같은 사상을 쓰는 곳을 그날 같이 찾았어야 했다.
--
-- 고친 것 두 가지
--   ① 길이가 같을 때만 (치환 오타만. 글자를 빼거나 더한 건 오타가 아니라 다른 말이다)
--   ② 4글자 이하는 편집거리 1 까지만 (짧은 말은 2글자만 달라도 완전히 다른 물건이다)
create or replace function public.bot_guess(p_kw text)
returns table(word text, cnt bigint)
language plpgsql stable security definer
set search_path to 'public'
as $function$
declare k text := lower(regexp_replace(coalesce(p_kw,''), '[[:space:]]', '', 'g'));
begin
  if length(k) < 2 then return; end if;
  return query
  with w as (
    select lower(t) tok
      from gonggu g,
           lateral regexp_split_to_table(
             regexp_replace(g.name, '[^가-힣a-zA-Z0-9]+', ' ', 'g'), '[[:space:]]+') t
     where g.approved
       and to_char(g.end_date::date,'YYYY-MM-DD') >= to_char((now() at time zone 'Asia/Seoul')::date,'YYYY-MM-DD')
       and length(t) between 2 and 12
  ), agg as (
    select tok, count(*)::bigint c from w group by tok having count(*) >= 2
  )
  select a.tok, a.c from agg a
   where a.tok <> k
     and left(a.tok,1) = left(k,1)              -- 첫 글자는 같아야 한다
     and length(a.tok) = length(k)              -- ① 길이가 같을 때만 = 치환 오타만
     and levenshtein(a.tok, k) <= (case when length(k) <= 4 then 1 else 2 end)  -- ②
   order by levenshtein(a.tok, k), a.c desc
   limit 3;
end $function$;

revoke all on function public.bot_guess(text) from anon, authenticated, public;
grant execute on function public.bot_guess(text) to anon, authenticated;
