-- 셀러 「내 링크」: 인스타 아이디가 확인 중이면 인포크 슬러그도 확인 중으로 둔다 (코덱스 검사 2026-11-20 · seller_links_pending_172 뒤에 적용)
--   문제: 172 는 아이디가 확인 중(v_pending)이어도 넣은 슬러그를 sellers.inpock_slug 에 바로 썼다.
--         seller-banner-auto 등 sellers.inpock_slug 를 읽는 곳이 확인 안 된 아이디의 인포크 페이지를 그 셀러 것으로 쓸 수 있었다(규칙 0-I).
--   고침: 확인 중이면 sellers.inpock_slug_pending 에만 적고, seller_insta_resolve 가 아이디를 반영할 때 함께 반영(seller_inpock 짝도 그 슬러그로)·거절하면 지운다.
--         아이디를 원래대로 되돌려 확인 중이 풀리면 확인 중 슬러그도 지운다.

alter table public.sellers add column if not exists inpock_slug_pending text;

create or replace function public.seller_links_apply(p_token text, p_insta text, p_insta_ok boolean, p_bio text, p_bio_kind text, p_slug text, p_bio_has_insta boolean) returns json
language plpgsql security definer set search_path to 'public', 'extensions', 'pg_temp' as $fn$
declare v_id bigint; s sellers%rowtype; v_new text; v_cur text; v_changed boolean := false; v_pending boolean := false; v_bio text; v_slug_ok boolean;
begin
  v_id := public._plan_seller_id(p_token);
  if v_id is null then return json_build_object('ok', false, 'msg', 'unauthorized'); end if;
  select * into s from sellers where id = v_id for update;
  v_cur := lower(replace(coalesce(s.insta, ''), '@', ''));
  v_new := lower(replace(trim(coalesce(p_insta, '')), '@', ''));
  if v_new !~ '^[a-z0-9._]{1,30}$' then return json_build_object('ok', false, 'msg', 'bad_insta'); end if;
  if v_new <> v_cur then
    -- 다른 셀러가 쓰는 아이디로는 못 바꾼다(남의 공구에 이웃셀러 표시가 붙는 일 방지)
    if exists (select 1 from sellers o where o.id <> v_id and v_new in (lower(replace(coalesce(o.insta, ''), '@', '')), lower(replace(coalesce(o.login_insta, ''), '@', '')), lower(replace(coalesce(o.seller_insta, ''), '@', '')))) then
      return json_build_object('ok', false, 'msg', 'insta_taken');
    end if;
    if p_insta_ok is true then
      update sellers set insta = v_new, insta_pending = null, insta_pending_at = null, inpock_slug_pending = null where id = v_id;
      v_changed := true;
      insert into health_alerts (kind, detail) values ('셀러인스타변경', format('%s(로그인 %s)가 인스타 아이디를 %s → %s 로 바꿈(본인 링크 페이지에서 확인됨) — 다르면 관리자에서 되돌리기', s.name, s.login_insta, v_cur, v_new));
    else
      update sellers set insta_pending = v_new, insta_pending_at = now() where id = v_id;
      v_pending := true;
    end if;
  else
    update sellers set insta_pending = null, insta_pending_at = null, inpock_slug_pending = null where id = v_id and (insta_pending is not null or inpock_slug_pending is not null);
  end if;
  v_bio := trim(coalesce(p_bio, ''));
  if v_bio <> '' then
    if v_bio !~* '^https?://[^\s"''<>]+$' or char_length(v_bio) > 300 then return json_build_object('ok', false, 'msg', 'bad_bio'); end if;
    v_slug_ok := p_bio_kind = 'inpock' and coalesce(p_slug, '') ~ '^[A-Za-z0-9._-]{1,60}$';
    -- 🔴 확인 중인 아이디의 슬러그는 inpock_slug 에 쓰지 않는다 — inpock_slug_pending 에만(확인되면 seller_insta_resolve 가 옮긴다)
    update sellers set bio_link = v_bio,
           inpock_slug = case when v_slug_ok and not v_pending then p_slug else inpock_slug end,
           inpock_slug_pending = case when v_slug_ok and v_pending then p_slug when v_pending then inpock_slug_pending else null end
     where id = v_id;
    -- 슬러그 짝은 확정된 인스타 아이디에만 적는다(확인 중인 아이디로는 적지 않는다 — 규칙 0-I)
    if v_slug_ok and not v_pending then
      insert into seller_inpock (insta, slug) values (v_new, p_slug) on conflict (insta) do update set slug = excluded.slug;
    end if;
    if p_bio_has_insta is not true and coalesce(s.bio_link, '') is distinct from v_bio then
      insert into health_alerts (kind, detail) values ('셀러링크확인', format('%s 가 넣은 링크 %s 에 인스타 아이디 %s 가 안 보인다 — 본인 링크가 맞는지 확인', s.name, v_bio, v_new));
    end if;
  end if;
  update sellers set links_checked_at = now() where id = v_id;
  return json_build_object('ok', true, 'insta', case when v_pending then v_cur else v_new end, 'insta_changed', v_changed, 'insta_pending', case when v_pending then v_new end, 'bio', v_bio);
end $fn$;

-- PC 확인기가 부른다: 확인 중인 아이디를 반영(p_ok=true)하거나 지운다(false). 확인 중 슬러그도 같이 반영·삭제
create or replace function public.seller_insta_resolve(p_id bigint, p_handle text, p_ok boolean) returns json
language plpgsql security definer set search_path to 'public', 'pg_temp' as $fn$
declare s sellers%rowtype; v_new text := lower(replace(coalesce(p_handle, ''), '@', '')); v_cur text; v_slug text;
begin
  select * into s from sellers where id = p_id for update;
  if not found or coalesce(lower(s.insta_pending), '') <> v_new then return json_build_object('ok', false, 'msg', 'stale'); end if;
  v_cur := lower(replace(coalesce(s.insta, ''), '@', ''));
  if p_ok is true and not exists (select 1 from sellers o where o.id <> p_id and v_new in (lower(replace(coalesce(o.insta, ''), '@', '')), lower(replace(coalesce(o.login_insta, ''), '@', '')), lower(replace(coalesce(o.seller_insta, ''), '@', '')))) then
    v_slug := coalesce(nullif(s.inpock_slug_pending, ''), nullif(s.inpock_slug, ''));
    update sellers set insta = v_new, insta_pending = null, insta_pending_at = null,
           inpock_slug = coalesce(nullif(s.inpock_slug_pending, ''), inpock_slug), inpock_slug_pending = null where id = p_id;
    if v_slug is not null then
      insert into seller_inpock (insta, slug) values (v_new, v_slug) on conflict (insta) do update set slug = excluded.slug;
    end if;
    insert into health_alerts (kind, detail) values ('셀러인스타변경', format('%s(로그인 %s)가 인스타 아이디를 %s → %s 로 바꿈(인스타에서 계정 확인됨) — 다르면 관리자에서 되돌리기', s.name, s.login_insta, v_cur, v_new));
    return json_build_object('ok', true, 'applied', true);
  end if;
  update sellers set insta_pending = null, insta_pending_at = null, inpock_slug_pending = null where id = p_id;
  insert into health_alerts (kind, detail) values ('셀러인스타거절', format('%s 가 넣은 인스타 아이디 %s 는 인스타에 없는 계정(또는 다른 셀러 아이디)이라 반영하지 않음', s.name, v_new));
  return json_build_object('ok', true, 'applied', false);
end $fn$;

revoke all on function public.seller_links_apply(text, text, boolean, text, text, text, boolean), public.seller_insta_resolve(bigint, text, boolean) from public, anon, authenticated;
grant execute on function public.seller_links_apply(text, text, boolean, text, text, text, boolean) to service_role;
