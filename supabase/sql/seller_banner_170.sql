-- 이웃셀러 「내 배너」 1구좌 — 셀러가 직접 사진·링크·상품명·멘트를 관리 (사장님 2026-11-19, 기획서 2026-11-17_이웃셀러_패키지.md 「배너는 셀러당 1구좌」)
--   메인 화면 이웃셀러 배너(type='seller')는 원래 열 때마다 무작위로 섞인다(index.html renderSellerBanners) — 그대로 쓴다.
--   · banners.seller_id: 셀러가 직접 관리하는 배너 표시(셀러당 1행). 자동 교체기(tools/daily/seller_banner.mjs)는 이 셀러를 건너뛴다.
--   · 제목은 기존 꼴 그대로 「상품명 - 셀러명」(메인 화면이 마지막 ' - ' 로 나눠 그린다), 멘트는 subtitle.
--   · 사진은 Edge 함수 seller-banner 가 저장소 banners/seller/<셀러id>_… 에 올린 것만 받는다(남의 주소를 배너 사진으로 못 넣게).
--   · 이웃셀러가 아니게 되면 10분 안에 배너를 내린다(크론 seller-banner-tidy). 다시 이웃셀러가 되면 저장할 때 다시 켜진다.
--   · 저장할 때마다 관리자 「고장 난 것」에 한 줄(사후 검수). 사전 승인은 없다(사장님 「셀러가 직접」).
--   PC 가 꺼져도 돈다(DB 함수 + pg_cron).
--   되돌리기: select cron.unschedule('seller-banner-tidy'); drop function seller_banner_get(text), seller_banner_save(text,text,text,text,text), seller_banner_can(text), seller_banner_tidy();
--             delete from banners where seller_id is not null; alter table banners drop column seller_id;

alter table public.banners add column if not exists seller_id bigint references public.sellers(id);
create unique index if not exists banners_one_per_seller on public.banners (seller_id) where seller_id is not null;

-- 이 토큰의 셀러가 지금 배너를 쓸 수 있는가(이웃셀러 노출 중) → {ok, seller_id, name, end_date}
create or replace function public.seller_banner_can(p_token text) returns json
language plpgsql security definer set search_path to 'public', 'extensions', 'pg_temp' as $fn$
declare v_id bigint; s sellers%rowtype; v_today date := (now() at time zone 'Asia/Seoul')::date;
begin
  v_id := public._plan_seller_id(p_token);
  if v_id is null then return json_build_object('ok', false, 'msg', 'unauthorized'); end if;
  select * into s from sellers where id = v_id;
  if not (s.is_partner is true and s.active is true and (s.end_date is null or s.end_date >= v_today) and (s.start_date is null or s.start_date <= v_today)) then
    return json_build_object('ok', false, 'msg', 'not_partner');
  end if;
  return json_build_object('ok', true, 'seller_id', v_id, 'name', coalesce(nullif(s.seller_influencer, ''), s.name), 'end_date', s.end_date);
end $fn$;

create or replace function public.seller_banner_get(p_token text) returns json
language plpgsql security definer set search_path to 'public', 'extensions', 'pg_temp' as $fn$
declare c json; b banners%rowtype; v_cut int;
begin
  c := public.seller_banner_can(p_token);
  if c->>'msg' = 'unauthorized' then raise exception 'unauthorized' using errcode = '28000'; end if;
  if (c->>'ok')::boolean is not true then return json_build_object('ok', true, 'can', false); end if;
  select * into b from banners where seller_id = (c->>'seller_id')::bigint;
  if not found then return json_build_object('ok', true, 'can', true, 'seller', c->>'name', 'banner', null); end if;
  v_cut := length(b.title) - position(' - ' in reverse(b.title)) - 2;      -- 마지막 ' - ' 앞까지가 상품명
  return json_build_object('ok', true, 'can', true, 'seller', c->>'name', 'banner', json_build_object(
    'name', case when position(' - ' in b.title) > 0 then left(b.title, v_cut) else b.title end,
    'desc', coalesce(b.subtitle, ''), 'link', coalesce(b.link, ''), 'img', b.img_url, 'active', b.active));
end $fn$;

create or replace function public.seller_banner_save(p_token text, p_name text, p_desc text, p_link text, p_img text) returns json
language plpgsql security definer set search_path to 'public', 'extensions', 'pg_temp' as $fn$
declare c json; v_id bigint; v_name text; v_desc text; v_link text; v_title text; v_until timestamptz; v_new boolean;
        v_base constant text := 'https://hycaqsqeogjtbscmzrtm.supabase.co/storage/v1/object/public/banners/seller/';
begin
  c := public.seller_banner_can(p_token);
  if c->>'msg' = 'unauthorized' then raise exception 'unauthorized' using errcode = '28000'; end if;
  if (c->>'ok')::boolean is not true then return json_build_object('ok', false, 'msg', 'not_partner'); end if;
  v_id := (c->>'seller_id')::bigint;
  -- 줄바꿈·꺾쇠·제어문자는 지우고 앞뒤 공백을 다듬는다
  v_name := trim(regexp_replace(coalesce(p_name, ''), '[\r\n\t<>]+', ' ', 'g'));
  v_desc := trim(regexp_replace(coalesce(p_desc, ''), '[\r\n\t<>]+', ' ', 'g'));
  v_link := trim(coalesce(p_link, ''));
  if char_length(v_name) < 1 or char_length(v_name) > 20 then return json_build_object('ok', false, 'msg', 'bad_name'); end if;
  if position(' - ' in v_name) > 0 then v_name := replace(v_name, ' - ', ' '); end if;     -- 제목 구분자와 겹치지 않게
  if char_length(v_desc) > 24 then return json_build_object('ok', false, 'msg', 'bad_desc'); end if;
  if v_link !~* '^https?://[^\s"''<>]+$' or char_length(v_link) < 12 or char_length(v_link) > 480 then return json_build_object('ok', false, 'msg', 'bad_link'); end if;
  -- 사진은 우리 저장소의 이 셀러 폴더 것만
  if coalesce(p_img, '') !~ ('^' || replace(v_base, '.', '\.') || v_id || '_[A-Za-z0-9]{6,40}\.(jpg|jpeg|png|webp)$') then
    return json_build_object('ok', false, 'msg', 'bad_img');
  end if;
  v_title := v_name || ' - ' || (c->>'name');
  v_until := case when c->>'end_date' is null then null else ((c->>'end_date') || ' 23:59:59+09')::timestamptz end;
  v_new := not exists (select 1 from banners where seller_id = v_id);
  insert into banners (type, title, subtitle, link, img_url, img_size, img_position, active, stage, sort_order, show_until, seller_id)
  values ('seller', v_title, nullif(v_desc, ''), v_link, p_img, 'cover', 'center', true, 'live', 0, v_until, v_id)
  on conflict (seller_id) where seller_id is not null do update
    set title = excluded.title, subtitle = excluded.subtitle, link = excluded.link, img_url = excluded.img_url,
        img_size = 'cover', img_position = 'center', active = true, stage = 'live', show_until = excluded.show_until;
  -- 이 셀러의 자동 교체 배너(셀러 표시 없는 옛 행)는 내린다 — 한 셀러 한 구좌
  update banners set active = false where type = 'seller' and seller_id is null and active and title like '% - ' || (c->>'name');
  insert into health_alerts (kind, detail)
  values ('이웃셀러배너', format('%s 가 내 배너를 %s: 「%s」 %s — 문제면 관리자 🖼 배너에서 내리기', c->>'name', case when v_new then '올림' else '바꿈' end, v_name, v_link));
  return json_build_object('ok', true);
end $fn$;

-- 이웃셀러가 아니게 된 셀러의 배너를 내린다 · 기간이 바뀌었으면 노출 끝 날짜를 맞춘다
create or replace function public.seller_banner_tidy() returns int
language plpgsql security definer set search_path to 'public', 'pg_temp' as $fn$
declare n int; v_today date := (now() at time zone 'Asia/Seoul')::date;
begin
  update banners b set active = false
   where b.seller_id is not null and b.active
     and not exists (select 1 from sellers s where s.id = b.seller_id and s.is_partner is true and s.active is true
                       and (s.end_date is null or s.end_date >= v_today) and (s.start_date is null or s.start_date <= v_today));
  get diagnostics n = row_count;
  update banners b set show_until = case when s.end_date is null then null else (s.end_date::text || ' 23:59:59+09')::timestamptz end
    from sellers s where s.id = b.seller_id and b.active
     and b.show_until is distinct from case when s.end_date is null then null else (s.end_date::text || ' 23:59:59+09')::timestamptz end;
  return n;
end $fn$;

revoke all on function public.seller_banner_can(text), public.seller_banner_tidy() from public, anon, authenticated;
grant execute on function public.seller_banner_can(text) to service_role;
revoke all on function public.seller_banner_get(text), public.seller_banner_save(text, text, text, text, text) from public;
grant execute on function public.seller_banner_get(text), public.seller_banner_save(text, text, text, text, text) to anon, authenticated;

select cron.unschedule('seller-banner-tidy') where exists (select 1 from cron.job where jobname = 'seller-banner-tidy');
select cron.schedule('seller-banner-tidy', '8-59/10 * * * *', $c$ set statement_timeout = '20s'; select public.seller_banner_tidy() where exists (select 1 from public.banners where seller_id is not null and active); $c$);
