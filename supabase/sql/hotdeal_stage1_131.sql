-- 핫딜 1단계 (설계서 scratchpad/designs/2026-11-01_핫딜감시_맘캘봇.md v2, 사장님 결정 2026-11-01: 쿠팡 40회/일 불변 · 손님 검색어 30개를 그 안에서)
--   ① hotdeals 칸: badge(lowest/super/sale) · unit_price·unit_label(단위 가격) · ship_note(배송 — 아는 값만) · current_price·price_status·last_checked_at·price_diff(가격 추적 설계 1판 129)
--   ② coupang_keywords.src — 손 등록(manual) / 손님 검색어(search) / 봇 질문(bot). major/minor 는 NULL 허용(쿠팡 함수가 상품명으로 분류)
--   ③ hotdeal_unit(title, price): 상품명에서 수량·용량을 읽어 단위 가격. 못 읽거나 애매하면 NULL (엄격). ⚠ PostgreSQL 정규식의 단어 경계는 \y (\b 아님 — 11-01 전부 NULL 사고)
--   ④ refresh_hotdeal_watch_terms(): 최근 7일 손님 검색어·챗봇 질문 상위 30 → coupang_keywords(src='search') upsert, 14일 못 든 것은 active=false
--   ⑤ 트리거·크론·기존 행 채우기는 hotdeal_stage1b_132.sql (회귀 검수 뒤)
-- 되돌리기: alter table hotdeals drop column badge, unit_price, unit_label, ship_note, current_price, price_status, last_checked_at, price_diff; drop function hotdeal_unit, refresh_hotdeal_watch_terms;
-- 적용: supabase db query --linked --file supabase/sql/hotdeal_stage1_131.sql   (2026-11-01 적용됨)

alter table public.hotdeals
  add column if not exists badge text,
  add column if not exists unit_price integer,
  add column if not exists unit_label text,
  add column if not exists ship_note text,
  add column if not exists current_price integer,
  add column if not exists price_status text not null default 'unknown',
  add column if not exists last_checked_at timestamptz,
  add column if not exists price_diff integer;
alter table public.coupang_keywords add column if not exists src text not null default 'manual';
create unique index if not exists coupang_keywords_keyword_uk on public.coupang_keywords (keyword);
alter table public.coupang_keywords alter column major drop not null, alter column minor drop not null;

-- ③ 단위 가격 ─ 규칙: 용량(g/kg · ml/L)이 먼저, 없으면 매·장·입·p(시트/개수). 곱셈 표기(N개·N팩)는 단위 **뒤에** 오는 첫 개수만.
--    애매하면 NULL: 「2+1」「세트」「혼합」「택1」, 같은 단위가 두 번(500g+300g), 수량 토큰 없음.
create or replace function public.hotdeal_unit(p_title text, p_price integer, out unit_price integer, out unit_label text)
language plpgsql immutable as $$
declare
  t text := lower(coalesce(p_title,''));
  m text[]; mult int := 1; base numeric; per numeric; n int;
begin
  unit_price := null; unit_label := null;
  if p_price is null or p_price < 100 then return; end if;
  -- 앞머리 태그([쿠폰+신한] 등)와 증정·사은품·옵션 꼬리는 수량 판단에서 뺀다 (회귀 11-01: 「린스750ml 증정」을 용량으로 읽었다)
  t := regexp_replace(t, '^(\s*[\[(][^\])]*[\])]\s*)+', '');
  t := regexp_replace(t, '\([^)]*(증정|사은품)[^)]*\)', ' ', 'g');
  t := regexp_replace(t, '(\+\s*증정|증정|사은품|\(옵션\s*\d*\)|옵션\s*\d+).*$', '');
  if t ~ '쿠션|파운데이션|립스틱|틴트|마스카라|아이라이너|향수' then return; end if;
  if t ~ '\+|세트|혼합|골라|택1|선택|[0-9]\s*종\y' then return; end if;
  -- 비소모품(용기·가전)은 용량당 가격이 뜻이 없다
  if t ~ '텀블러|저그|용기|보틀|물병|냄비|프라이팬|밥솥|가습기|정수기|제습기|에어프라이어|청소기|세탁기|건조기|블렌더|믹서|정리함|수납|욕조|매트리스' then return; end if;
  -- 물티슈·티슈는 매 수가 기준(65g 같은 무게가 같이 적혀도 무시)
  if t ~ '물티슈|티슈|화장지|키친타월|휴지' then t := regexp_replace(t, '\d+(?:\.\d+)?\s*(kg|g|ml|l)\y', ' ', 'g'); end if;
  -- 용량: g/kg
  n := (select count(*) from regexp_matches(t, '(\d+(?:\.\d+)?)\s*(kg|g)\y', 'g'));
  if n = 1 then
    m := regexp_match(t, '(\d+(?:\.\d+)?)\s*(kg|g)\y');
    base := m[1]::numeric * (case when m[2]='kg' then 1000 else 1 end);
    m := regexp_match(t, '(?:kg|g)\y[^0-9]{0,12}(\d+)\s*(개|팩|봉|캔|병|통|입|박스|포|스틱)');
    if m is null then m := regexp_match(t, '(\d+)\s*(개|팩|봉|캔|병|통|입|박스)[^0-9]{0,8}\d+(?:\.\d+)?\s*(?:kg|g)\y'); end if;
    if m is not null then mult := m[1]::int; end if;
    -- 「0.9g, 100개입, 3개」처럼 개수가 두 번이면 곱한다
    m := regexp_match(t, '(\d+)\s*(개입|입|포|스틱|p)\y[^0-9]{0,6}(\d+)\s*(개|팩|박스|봉|통)'); if m is not null then mult := m[1]::int * m[3]::int; end if;
    if base*mult <= 0 then return; end if;
    per := p_price::numeric / (base*mult) * 100;
    if per < 1 or per > 500000 then return; end if;
    unit_price := round(per)::int; unit_label := '100g당 '||to_char(round(per),'FM999,999,999')||'원'; return;
  elsif n > 1 then return; end if;
  -- 용량: ml/L
  n := (select count(*) from regexp_matches(t, '(\d+(?:\.\d+)?)\s*(ml|l)\y', 'g'));
  if n = 1 then
    m := regexp_match(t, '(\d+(?:\.\d+)?)\s*(ml|l)\y');
    base := m[1]::numeric * (case when m[2]='l' then 1000 else 1 end);
    m := regexp_match(t, '(?:ml|l)\y[^0-9]{0,12}(\d+)\s*(개|팩|봉|캔|병|통|입|박스|포)');
    if m is null then m := regexp_match(t, '(\d+)\s*(개|팩|봉|캔|병|통|입|박스)[^0-9]{0,8}\d+(?:\.\d+)?\s*(?:ml|l)\y'); end if;
    if m is not null then mult := m[1]::int; end if;
    -- 「0.9g, 100개입, 3개」처럼 개수가 두 번이면 곱한다
    m := regexp_match(t, '(\d+)\s*(개입|입|포|스틱|p)\y[^0-9]{0,6}(\d+)\s*(개|팩|박스|봉|통)'); if m is not null then mult := m[1]::int * m[3]::int; end if;
    if base*mult <= 0 then return; end if;
    per := p_price::numeric / (base*mult) * 100;
    if per < 1 or per > 500000 then return; end if;
    unit_price := round(per)::int; unit_label := '100ml당 '||to_char(round(per),'FM999,999,999')||'원'; return;
  elsif n > 1 then return; end if;
  -- 시트·개수: 매·장·입·p
  n := (select count(*) from regexp_matches(t, '(\d+)\s*(매|장|입|p)\y', 'g'));
  if n = 1 then
    m := regexp_match(t, '(\d+)\s*(매|장|입|p)\y');
    base := m[1]::numeric;
    m := regexp_match(t, '(?:매|장|입|p)\y[^0-9]{0,12}(\d+)\s*(개|팩|봉|박스|묶음)');
    if m is not null then mult := m[1]::int; end if;
    if base*mult <= 0 then return; end if;
    if t ~ '물티슈|티슈|화장지|키친타월|휴지' then
      per := p_price::numeric / (base*mult) * 100;
      if per < 1 or per > 500000 then return; end if;
      unit_price := round(per)::int; unit_label := '100매당 '||to_char(round(per),'FM999,999,999')||'원';
    else
      per := p_price::numeric / (base*mult);
      if per < 1 or per > 5000000 then return; end if;
      unit_price := round(per)::int; unit_label := '장당 '||to_char(round(per),'FM999,999,999')||'원';
    end if;
    return;
  end if;
  return;
end $$;

-- ④ 동적 감시 키워드 (하루 1회, 쿠팡 호출 수는 그대로 — coupang_keywords 의 last_seen 순환에 섞여 돈다)
--    원천: site_search_stats(c7) · events kakao_bot/momcal_bot(「질문 | uid=… | 종류」, 로봇 uid=BOT… 제외) · events search_fix({"from","to","n"})
create or replace function public.refresh_hotdeal_watch_terms() returns integer
language plpgsql security definer set search_path = public as $$
declare v_n integer := 0;
begin
  with raw as (
    select term, c7::numeric as w from site_search_stats where c7 >= 2
    union all
    select split_part(event_data,'|',1) as term, 1 from events
      where event_type in ('kakao_bot','momcal_bot') and visited_at > now() - interval '7 days' and event_data !~ 'uid=BOT'
    union all
    select (event_data::jsonb->>'to'), 2 from events
      where event_type='search_fix' and visited_at > now() - interval '7 days' and event_data ~ '^\s*\{'
  ), norm as (
    select trim(regexp_replace(lower(term),'[^가-힣a-z0-9 ]',' ','g')) as term, w from raw where term is not null
  ), agg as (
    select term, sum(w) as score from norm
    where length(term) between 2 and 20 and term !~ '^[0-9 ]+$' and term !~ '공구|핫딜|맘캘|캘린더|테스트'
      and not exists (select 1 from brand_block b where position(lower(b.pattern) in term) > 0)
    group by term order by score desc limit 30
  ), up as (
    insert into coupang_keywords (keyword, major, minor, active, src)
    select term, null, null, true, 'search' from agg
    on conflict (keyword) do update set active = true, src = case when coupang_keywords.src='manual' then 'manual' else 'search' end
    returning 1
  )
  select count(*) into v_n from up;
  -- 14일 동안 상위에 못 든 손님 검색어 키워드는 쉰다(손 등록 manual 은 손대지 않는다)
  update coupang_keywords k set active=false
   where k.src='search' and k.active and k.keyword not in (
     select term from (
       select trim(regexp_replace(lower(term),'[^가-힣a-z0-9 ]',' ','g')) as term from site_search_stats where c30 >= 2
       union select trim(regexp_replace(lower(split_part(event_data,'|',1)),'[^가-힣a-z0-9 ]',' ','g')) from events where event_type in ('kakao_bot','momcal_bot') and visited_at > now() - interval '14 days' and event_data !~ 'uid=BOT'
       -- 검색 교정(search_fix)에서 발굴한 키워드도 유지 대상이다 — 빠져 있으면 같은 실행에서 바로 active=false 가 됐다(2026-11-02 코덱스 지적)
       union select trim(regexp_replace(lower(case when event_data ~ '^\s*\{' then event_data::jsonb->>'to' end),'[^가-힣a-z0-9 ]',' ','g')) from events where event_type='search_fix' and visited_at > now() - interval '14 days' and event_data ~ '^\s*\{'
     ) s where term is not null);
  return v_n;
end $$;
revoke all on function public.refresh_hotdeal_watch_terms() from public, anon, authenticated;
