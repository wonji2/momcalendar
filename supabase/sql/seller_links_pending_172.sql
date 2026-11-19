-- 셀러 「내 링크」: 인스타 아이디 확인을 두 길로 (2026-11-19, seller_links_171 뒤에 적용)
--   실측: Supabase Edge(해외 데이터센터)에서 instagram.com/<아이디> 를 열면 로그인 화면으로 밀려 계정 확인이 안 된다. PC(가정 회선)에서는 된다.
--   ① 셀러가 넣은 인포크/리틀리 페이지에 그 인스타 아이디가 적혀 있으면 그 자리에서 확정(p_insta_ok=true)
--   ② 아니면 sellers.insta_pending 에 적어 두고 「확인 중」 → PC 의 tools/daily/seller_insta_verify.mjs 가 인스타를 열어 보고 seller_insta_resolve 로 반영·거절
--   🔴 ②는 PC 에 묶인다(인스타가 서버 요청을 막아서). PC 가 꺼져 있으면 확인이 늦어지고, 그동안 메인 화면은 예전 아이디로 연결된다.
--      24시간 넘게 확인 중이면 plan-pay-watch 와 같은 식으로 관리자 「고장 난 것」에 올린다(크론 seller-insta-pending-watch).

alter table public.sellers add column if not exists insta_pending text;
alter table public.sellers add column if not exists insta_pending_at timestamptz;

create or replace function public.seller_links_get(p_token text) returns json
language plpgsql security definer set search_path to 'public', 'extensions', 'pg_temp' as $fn$
declare v_id bigint; s sellers%rowtype;
begin
  v_id := public._plan_seller_id(p_token);
  if v_id is null then raise exception 'unauthorized' using errcode = '28000'; end if;
  select * into s from sellers where id = v_id;
  return json_build_object('ok', true,
    'insta', replace(coalesce(nullif(s.insta, ''), nullif(s.seller_insta, ''), s.login_insta), '@', ''),
    'insta_pending', nullif(s.insta_pending, ''),
    'bio', coalesce(nullif(s.bio_link, ''), case when coalesce(s.inpock_slug, '') <> '' then 'https://link.inpock.co.kr/' || s.inpock_slug end, ''),
    'checked', s.links_checked_at is not null);
end $fn$;

create or replace function public.seller_links_apply(p_token text, p_insta text, p_insta_ok boolean, p_bio text, p_bio_kind text, p_slug text, p_bio_has_insta boolean) returns json
language plpgsql security definer set search_path to 'public', 'extensions', 'pg_temp' as $fn$
declare v_id bigint; s sellers%rowtype; v_new text; v_cur text; v_changed boolean := false; v_pending boolean := false; v_bio text;
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
      update sellers set insta = v_new, insta_pending = null, insta_pending_at = null where id = v_id;
      v_changed := true;
      insert into health_alerts (kind, detail) values ('셀러인스타변경', format('%s(로그인 %s)가 인스타 아이디를 %s → %s 로 바꿈(본인 링크 페이지에서 확인됨) — 다르면 관리자에서 되돌리기', s.name, s.login_insta, v_cur, v_new));
    else
      update sellers set insta_pending = v_new, insta_pending_at = now() where id = v_id;
      v_pending := true;
    end if;
  else
    update sellers set insta_pending = null, insta_pending_at = null where id = v_id and insta_pending is not null;
  end if;
  v_bio := trim(coalesce(p_bio, ''));
  if v_bio <> '' then
    if v_bio !~* '^https?://[^\s"''<>]+$' or char_length(v_bio) > 300 then return json_build_object('ok', false, 'msg', 'bad_bio'); end if;
    update sellers set bio_link = v_bio,
           inpock_slug = case when p_bio_kind = 'inpock' and coalesce(p_slug, '') ~ '^[A-Za-z0-9._-]{1,60}$' then p_slug else inpock_slug end
     where id = v_id;
    -- 슬러그 짝은 확정된 인스타 아이디에만 적는다(확인 중인 아이디로는 적지 않는다 — 규칙 0-I)
    if p_bio_kind = 'inpock' and coalesce(p_slug, '') ~ '^[A-Za-z0-9._-]{1,60}$' and not v_pending then
      insert into seller_inpock (insta, slug) values (v_new, p_slug) on conflict (insta) do update set slug = excluded.slug;
    end if;
    if p_bio_has_insta is not true and coalesce(s.bio_link, '') is distinct from v_bio then
      insert into health_alerts (kind, detail) values ('셀러링크확인', format('%s 가 넣은 링크 %s 에 인스타 아이디 %s 가 안 보인다 — 본인 링크가 맞는지 확인', s.name, v_bio, v_new));
    end if;
  end if;
  update sellers set links_checked_at = now() where id = v_id;
  return json_build_object('ok', true, 'insta', case when v_pending then v_cur else v_new end, 'insta_changed', v_changed, 'insta_pending', case when v_pending then v_new end, 'bio', v_bio);
end $fn$;

-- PC 확인기가 부른다: 확인 중인 아이디를 반영(p_ok=true)하거나 지운다(false)
create or replace function public.seller_insta_resolve(p_id bigint, p_handle text, p_ok boolean) returns json
language plpgsql security definer set search_path to 'public', 'pg_temp' as $fn$
declare s sellers%rowtype; v_new text := lower(replace(coalesce(p_handle, ''), '@', '')); v_cur text;
begin
  select * into s from sellers where id = p_id for update;
  if not found or coalesce(lower(s.insta_pending), '') <> v_new then return json_build_object('ok', false, 'msg', 'stale'); end if;
  v_cur := lower(replace(coalesce(s.insta, ''), '@', ''));
  if p_ok is true and not exists (select 1 from sellers o where o.id <> p_id and v_new in (lower(replace(coalesce(o.insta, ''), '@', '')), lower(replace(coalesce(o.login_insta, ''), '@', '')), lower(replace(coalesce(o.seller_insta, ''), '@', '')))) then
    update sellers set insta = v_new, insta_pending = null, insta_pending_at = null where id = p_id;
    if coalesce(s.inpock_slug, '') <> '' then
      insert into seller_inpock (insta, slug) values (v_new, s.inpock_slug) on conflict (insta) do update set slug = excluded.slug;
    end if;
    insert into health_alerts (kind, detail) values ('셀러인스타변경', format('%s(로그인 %s)가 인스타 아이디를 %s → %s 로 바꿈(인스타에서 계정 확인됨) — 다르면 관리자에서 되돌리기', s.name, s.login_insta, v_cur, v_new));
    return json_build_object('ok', true, 'applied', true);
  end if;
  update sellers set insta_pending = null, insta_pending_at = null where id = p_id;
  insert into health_alerts (kind, detail) values ('셀러인스타거절', format('%s 가 넣은 인스타 아이디 %s 는 인스타에 없는 계정(또는 다른 셀러 아이디)이라 반영하지 않음', s.name, v_new));
  return json_build_object('ok', true, 'applied', false);
end $fn$;

revoke all on function public.seller_links_apply(text, text, boolean, text, text, text, boolean), public.seller_insta_resolve(bigint, text, boolean) from public, anon, authenticated;
grant execute on function public.seller_links_apply(text, text, boolean, text, text, text, boolean) to service_role;
revoke all on function public.seller_links_get(text) from public;
grant execute on function public.seller_links_get(text) to anon, authenticated;

select cron.unschedule('seller-insta-pending-watch') where exists (select 1 from cron.job where jobname = 'seller-insta-pending-watch');
select cron.schedule('seller-insta-pending-watch', '20 * * * *', $c$
  insert into public.health_alerts (kind, detail)
  select '셀러인스타확인지연:' || s.id, format('%s 의 인스타 아이디 %s 가 24시간 넘게 확인 중 — PC 확인기(seller_insta_verify)가 안 돌았다. 인스타에서 직접 보고 관리자에서 반영', s.name, s.insta_pending)
    from public.sellers s where s.insta_pending is not null and s.insta_pending_at < now() - interval '24 hours'
     and not exists (select 1 from public.health_alerts h where h.kind = '셀러인스타확인지연:' || s.id and h.created_at > now() - interval '3 days');
$c$);
