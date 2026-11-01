-- 🔴 규칙 0-M 트리거의 구멍 셋 (2026-10-06 검증자 지적)
--
-- ① **재스윕이 없었다.** 76번 트리거는 「지금 쓰이는 행」만 본다. 그래서 내가 **새 공구를 올리면**
--    그 창 안에 **이미 올라와 있던** 타셀러 공구는 그대로 노출된 채 남았다. 규칙 0-M 의
--    *"이미 등록된 것은 approved=false 로 내린다"* 가 배포일 1회 UPDATE 말고는 어디서도 안 돌았다.
--    (`gg_in_own_window` 호출처 grep = 트리거 + 점검 SQL 뿐 · pg_cron 0건 ·
--     `parsing_nightly.mjs` 가 도는 `_q_own_live.sql` 은 「마이키즈|롤팬|우랩」 세 낱말 하드코딩 리포트지 스윕이 아니다)
--    → **내 공구 행이 들어오거나 승인될 때** 그 창을 쓸고 내린다. 사람·크론에 기대지 않는다(규칙 0-Y).
--
-- ② `m.end_date` 에 **날짜 형식 가드가 없었다.** 내 공구 한 행의 마감일이 깨지면
--    `::date` 캐스팅이 터져 **gonggu INSERT 가 통째로 실패**할 수 있었다(지금은 25행 전부 멀쩡해 안 터졌다).
--
-- ③ `insta = 'momcal_'` 를 **대소문자 그대로** 봤다. `MOMCAL_` 로 들어오면 **내 공구인데 내려갔다**.

create or replace function public.gg_in_own_window(p_name text, p_insta text, p_open text)
returns bigint language sql stable as $$
  select m.id
    from public.gonggu m
   where lower(coalesce(m.insta,'')) = 'momcal_'
     and m.approved
     and lower(coalesce(p_insta,'')) is distinct from 'momcal_'
     and m.open_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
     -- ② 내 마감일이 깨져 있으면 그 행은 건너뛴다 (오픈일+3 으로 대신하지 않는다 — 조용히 틀린 창을 만들지 않는다)
     and (coalesce(m.end_date,'') = '' or m.end_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
     and coalesce(p_open,'') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
     and p_open::date between m.open_date::date - 14
                          and coalesce(nullif(m.end_date,'')::date, m.open_date::date + 3)
     and public.gg_same_product(m.name, p_name)
   order by m.id
   limit 1
$$;

create or replace function public.trg_gonggu_own_window()
returns trigger language plpgsql security definer set search_path = public as $$
declare hit bigint;
begin
  if not coalesce(new.approved, false) then return new; end if;
  if lower(coalesce(new.insta, '')) = 'momcal_' then return new; end if;   -- ③ 대소문자 무시
  hit := public.gg_in_own_window(new.name, new.insta, new.open_date);
  if hit is not null then
    begin
      insert into events(event_type, event_data)
      values ('own_window_block',
              format('규칙 0-M: %s (%s %s) — 내 공구 #%s 창 안이라 내렸다',
                     left(coalesce(new.name,''), 60), coalesce(new.insta,'?'), coalesce(new.open_date,'?'), hit));
    exception when others then null;
    end;
    new.approved := false;
  end if;
  return new;
end $$;

-- ① **내 공구가 들어오면 그 창을 쓴다** — 이미 올라와 있던 타셀러 공구를 그 자리에서 내린다.
create or replace function public.trg_gonggu_own_resweep()
returns trigger language plpgsql security definer set search_path = public as $$
declare n int;
begin
  -- 되돌이 방지: 아래 update 가 before 트리거를 깨우지만 그쪽은 momcal_ 가 아니라 바로 되돌아온다.
  --   그래도 깊이를 재서 한 겹만 돈다.
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
     -- ⚠ **아직 노출중인 것만** 내린다. 지난 행까지 건드리면 손님 찜·검색 페이지에서 과거 공구가 사라진다.
     and g.end_date >= to_char((now() at time zone 'Asia/Seoul')::date, 'YYYY-MM-DD')
     and public.gg_same_product(new.name, g.name);
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

drop trigger if exists gonggu_own_resweep on public.gonggu;
create trigger gonggu_own_resweep after insert or update on public.gonggu
  for each row execute function public.trg_gonggu_own_resweep();

-- ⚠ 확인 쿼리를 **여기에 붙이지 말 것.** 이 파일은 한 트랜잭션으로 간다 —
--   13,000행에 gg_in_own_window 를 거는 전수검사를 꼬리에 뒀다가 문 타임아웃이 나서
--   **함수·트리거 생성까지 통째로 되감겼다**(2026-10-06 실측). 확인은 따로 돌린다:
--     supabase.exe db query --linked -f scratchpad/_q_own_check.sql     (가벼움)
--     supabase.exe db query --linked -f scratchpad/_q_own_window_v2.sql (무거움 — 창 전수)
select (select count(*) from pg_trigger where tgname = 'gonggu_own_window')  as 막기_트리거,
       (select count(*) from pg_trigger where tgname = 'gonggu_own_resweep') as 쓸기_트리거;
