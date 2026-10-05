-- 🔴🔴 규칙 0-M 을 **서버 한 곳**에서 막는다 (사장님 지시 2026-10-05)
--
-- > *"내가 공구하는 상품은 2주전부터 타셀러 db는 넣지마 내거만 띄워 **모든곳에 공통사항**이야"*
--
-- 왜 서버인가: 2026-10-06 에 세어 보니 `cal_reg.mjs` 한 곳에만 들어 있었다.
--   `gen_insert_gonggu.mjs`·`pending_check.sh`·`parsing_nightly.mjs` 에는 `momcal_` 이라는 글자조차 없다(grep 0건).
--   무인 회차는 **하루 600건까지** 등록한다 — 등록기마다 따로 넣으면 또 어딘가가 빠진다.
--   `brand_block_gonggu`·`gonggu_hold_guard` 와 같은 자리에 두면 크론·카페·셀러데스크·관리자·손등록이 **전부** 걸린다.
--
-- 무엇을 하나: 창 안이면 **approved 를 false 로 되돌린다.**
--   ⚠ 행을 버리지(return null) 않는다 — 두 가지 이유다.
--     ① 규칙 0-M 이 「이미 등록된 것은 approved=false 로 내린다(**DELETE 금지** — 창이 지나면 되살릴 수 있어야 한다)」고 못박았다.
--     ② 조용히 버리면 등록기가 **매 회차 같은 행을 다시 넣으려 한다**(중복검사에도 안 잡힌다).
--        2026-10-05 에 「이젠 가습기」가 brand_block 에 조용히 버려진 걸 「등록됐다」고 세었던 사고와 같은 뿌리다.
--   되돌리려 한 시도는 events('own_window_block') 에 남는다.
--   🔑 **`update … approved=false` 한 번으로는 안 된다** — 세 번이나 되살아난 전력이 있다(메모리 hide-needs-gonggu-hold).
--     트리거는 insert·update 마다 다시 걸리니 어느 경로가 켜도 그 자리에서 다시 꺼진다. gonggu_hold 와 같은 구조다.
--
-- 창 = 내_오픈일 − 14일 ~ 내_마감일   (판정 도구: scratchpad/_q_my_gonggu_window.sql)
-- 같은 상품 판정 = **`gg_same_product` 하나만** 쓴다(어순·띄어쓰기·포함·브랜드 가드까지 본다).
--   ⚠ 완전일치만 보면 샌다 — 「룰라러브 천연해면**스펀지**」(내) vs 「룰라러브 천연해면」(타셀러)은
--     글자가 달라 안 걸렸다(2026-10-05 실측). → gg_same_product 의 **포함검사**가 이걸 잡는다(true 확인).
--   🔴 **브랜드 접두사(첫 낱말로 시작)를 같은 상품으로 보면 안 된다** — 2026-10-06 실측으로 기각했다.
--     `_q_my_gonggu_window.sql` 의 브랜드 갈래가 내 「**티니핑** 멀티비타민저당젤리」에
--     타셀러 「**티니핑** 완구」(#23365)·「**티니핑** & 카봇 식기」(#26941)를 물어 왔다.
--     **티니핑은 캐릭터 라이선스지 상품이 아니다** — 완구와 젤리는 서로 경쟁하지 않는다.
--     브랜드 갈래를 트리거에 넣었으면 멀쩡한 타셀러 공구 2건이 조용히 내려갔을 것이다.
--     (gg_same_product 로 보면 둘 다 false · 「마이키즈 4차」↔「마이키즈 영양음료」는 true — 의도대로다)
--
-- ⚠ 창 **밖**의 같은 상품은 정상이다(다른 시기 재공구). 창 안인 것만 막는다.
-- ⚠ 창이 지나도 **자동으로 되살아나지는 않는다.** 되살리려면 그 행의 approved 를 다시 켜면 된다
--   (창 밖이면 이 트리거가 더 이상 되돌리지 않는다). 명단: scratchpad/_q_own_window_released.sql

create or replace function public.gg_in_own_window(p_name text, p_insta text, p_open text)
returns bigint language sql stable as $$
  select m.id
    from public.gonggu m
   where m.insta = 'momcal_'
     and m.approved
     and coalesce(p_insta,'') is distinct from 'momcal_'
     and m.open_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
     and coalesce(p_open,'') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
     -- 날짜창을 **먼저** 본다 (이름 비교는 무거우니 창 안인 것만 본다)
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
  if coalesce(new.insta, '') = 'momcal_' then return new; end if;
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

drop trigger if exists gonggu_own_window on public.gonggu;
create trigger gonggu_own_window before insert or update on public.gonggu
  for each row execute function public.trg_gonggu_own_window();

-- 이미 올라와 있는 것도 같은 기준으로 내린다 (DELETE 아님)
-- ⚠ **아직 노출중인 것만** 내린다. 창 안이었던 지난 행(2026-10-06 기준 27건)까지 건드리면
--   손님 찜 목록·검색 페이지에서 과거 공구가 사라진다. 규칙 0-M 은 「지금 손님에게 뭘 보이느냐」의 규칙이다.
update public.gonggu g
   set approved = false
 where g.approved
   and coalesce(g.insta,'') <> 'momcal_'
   and g.end_date >= to_char((now() at time zone 'Asia/Seoul')::date, 'YYYY-MM-DD')
   and public.gg_in_own_window(g.name, g.insta, g.open_date) is not null;

select (select count(*) from public.gonggu where insta = 'momcal_' and approved)           as 내_공구,
       (select count(*) from public.gonggu g where g.approved and coalesce(g.insta,'') <> 'momcal_'
          and public.gg_in_own_window(g.name, g.insta, g.open_date) is not null)           as 남은_위반,
       (select count(*) from events where event_type = 'own_window_block')                 as 막은_기록;
