-- 셀러 「내 링크」 — 인스타 아이디 · 인포크/리틀리 주소를 셀러가 직접 넣는다 (사장님 2026-11-19)
--   「필요한 모든 링크를 셀러가 직접 입력 · 인스타 핸들만 적으면 instagram.com 뒤에 붙여 그 계정으로 연결되는지 확인해서 자동으로」
--   · 메인 화면 이웃셀러 동그라미는 sellers.insta 로 instagram.com/<아이디> 를 연다(index.html renderSellers) → 이 값을 셀러가 확인·수정한다.
--   · 인포크 주소는 일정 자동 등록(수확)에 쓴다: sellers.inpock_slug + seller_inpock(insta ↔ slug, 규칙 0-I 인스타 아이디와 슬러그는 따로).
--   · 실제로 열리는지 확인은 Edge 함수 seller-links 가 한다(밖으로 나가는 요청). 이 파일의 seller_links_apply 는 그 함수(service_role)만 부른다.
--   · 인스타 아이디를 바꾸는 건 확인된 계정일 때만, 다른 셀러가 쓰는 아이디면 거절. 바꾸면 관리자 「고장 난 것」에 한 줄(사후 확인).
--   PC 가 꺼져도 돈다(DB + Edge).
--   되돌리기: drop function seller_links_get(text), seller_links_apply(text,text,boolean,text,text,text,boolean); alter table sellers drop column bio_link, drop column links_checked_at;

alter table public.sellers add column if not exists bio_link text;
alter table public.sellers add column if not exists links_checked_at timestamptz;

create or replace function public.seller_links_get(p_token text) returns json
language plpgsql security definer set search_path to 'public', 'extensions', 'pg_temp' as $fn$
declare v_id bigint; s sellers%rowtype;
begin
  v_id := public._plan_seller_id(p_token);
  if v_id is null then raise exception 'unauthorized' using errcode = '28000'; end if;
  select * into s from sellers where id = v_id;
  return json_build_object('ok', true,
    'insta', replace(coalesce(nullif(s.insta, ''), nullif(s.seller_insta, ''), s.login_insta), '@', ''),
    'bio', coalesce(nullif(s.bio_link, ''), case when coalesce(s.inpock_slug, '') <> '' then 'https://link.inpock.co.kr/' || s.inpock_slug end, ''),
    'checked', s.links_checked_at is not null);
end $fn$;

-- Edge seller-links 가 확인을 마친 값을 적는다.
--   p_insta_ok: 인스타에서 그 계정을 실제로 봤는가 · p_bio_kind: 'inpock' | 'littly' | 'other' | '' · p_bio_has_insta: 그 링크 페이지에 이 인스타 아이디가 적혀 있는가
create or replace function public.seller_links_apply(p_token text, p_insta text, p_insta_ok boolean, p_bio text, p_bio_kind text, p_slug text, p_bio_has_insta boolean) returns json
language plpgsql security definer set search_path to 'public', 'extensions', 'pg_temp' as $fn$
declare v_id bigint; s sellers%rowtype; v_new text; v_cur text; v_changed boolean := false; v_bio text;
begin
  v_id := public._plan_seller_id(p_token);
  if v_id is null then return json_build_object('ok', false, 'msg', 'unauthorized'); end if;
  select * into s from sellers where id = v_id for update;
  v_cur := lower(replace(coalesce(s.insta, ''), '@', ''));
  v_new := lower(replace(trim(coalesce(p_insta, '')), '@', ''));
  if v_new !~ '^[a-z0-9._]{1,30}$' then return json_build_object('ok', false, 'msg', 'bad_insta'); end if;
  if v_new <> v_cur then
    if p_insta_ok is not true then return json_build_object('ok', false, 'msg', 'insta_unverified'); end if;
    -- 다른 셀러가 쓰는 아이디로는 못 바꾼다(남의 공구에 이웃셀러 표시가 붙는 일 방지)
    if exists (select 1 from sellers o where o.id <> v_id and v_new in (lower(replace(coalesce(o.insta, ''), '@', '')), lower(replace(coalesce(o.login_insta, ''), '@', '')), lower(replace(coalesce(o.seller_insta, ''), '@', '')))) then
      return json_build_object('ok', false, 'msg', 'insta_taken');
    end if;
    update sellers set insta = v_new where id = v_id;
    v_changed := true;
    insert into health_alerts (kind, detail) values ('셀러인스타변경', format('%s(로그인 %s)가 인스타 아이디를 %s → %s 로 바꿈(인스타에서 계정 확인됨) — 다르면 관리자에서 되돌리기', s.name, s.login_insta, v_cur, v_new));
  end if;
  v_bio := trim(coalesce(p_bio, ''));
  if v_bio <> '' then
    if v_bio !~* '^https?://[^\s"''<>]+$' or char_length(v_bio) > 300 then return json_build_object('ok', false, 'msg', 'bad_bio'); end if;
    update sellers set bio_link = v_bio,
           inpock_slug = case when p_bio_kind = 'inpock' and coalesce(p_slug, '') ~ '^[A-Za-z0-9._-]{1,60}$' then p_slug else inpock_slug end
     where id = v_id;
    if p_bio_kind = 'inpock' and coalesce(p_slug, '') ~ '^[A-Za-z0-9._-]{1,60}$' then
      insert into seller_inpock (insta, slug) values (v_new, p_slug) on conflict (insta) do update set slug = excluded.slug;
    end if;
    if p_bio_has_insta is not true and coalesce(s.bio_link, '') is distinct from v_bio then
      insert into health_alerts (kind, detail) values ('셀러링크확인', format('%s 가 넣은 링크 %s 에 인스타 아이디 %s 가 안 보인다 — 본인 링크가 맞는지 확인', s.name, v_bio, v_new));
    end if;
  end if;
  update sellers set links_checked_at = now() where id = v_id;
  return json_build_object('ok', true, 'insta', v_new, 'insta_changed', v_changed, 'bio', v_bio);
end $fn$;

revoke all on function public.seller_links_apply(text, text, boolean, text, text, text, boolean) from public, anon, authenticated;
grant execute on function public.seller_links_apply(text, text, boolean, text, text, text, boolean) to service_role;
revoke all on function public.seller_links_get(text) from public;
grant execute on function public.seller_links_get(text) to anon, authenticated;
