-- 내정보: 닉네임 수정 + 방해금지 시간 (2026-11-12, 사장님 「다 고쳐야지」)
--
-- ① 닉네임 수정
--    문제: kakao-auth·naver-auth 가 로그인할 때마다 members.nickname 을 카카오·네이버 닉네임으로 upsert 해서, 손님이 고쳐도 다음 로그인에 되돌아간다.
--    방법: 손님이 정한 이름은 nick_custom 에 따로 두고, 트리거가 members 에 쓰는 모든 길(로그인 upsert 포함)에서 nickname 을 그 값으로 맞춘다.
--          → 로그인 함수(Edge)는 손대지 않는다. 지우려면 nick_custom 을 null 로.
--    부르는 곳: 내정보 → 닉네임 옆 연필 → member_set_nickname(토큰, 새 이름) · 화면을 열 때 member_profile(토큰)으로 서버 값과 맞춘다.
-- ② 방해금지 시간
--    prefs 에 quiet_from·quiet_to(0~23시, 한국 시각)를 같이 저장한다. 실시간으로 나가는 알림(키워드 핫딜 30분마다·라방 시작 전)만 이 시간에 쉰다.
--    공구 오픈·세일 알림은 하루 한 번 아침 9시에 나가는 것이라 여기에 걸지 않는다(걸면 그날 알림을 통째로 못 받는다).

-- ───────── ① 닉네임 ─────────
alter table public.members add column if not exists nick_custom text;
alter table public.members add column if not exists nick_changed_at timestamptz;

create or replace function public._members_keep_nick() returns trigger
language plpgsql as $f$
begin
  if new.nick_custom is not null and new.nick_custom <> '' then new.nickname := new.nick_custom; end if;
  return new;
end $f$;
drop trigger if exists members_keep_nick on public.members;
create trigger members_keep_nick before insert or update on public.members
  for each row execute function public._members_keep_nick();

create or replace function public.member_set_nickname(p_token text, p_nick text)
returns json language plpgsql security definer set search_path to 'public' as $f$
declare kid text; v text; n int;
begin
  kid := _member_from_token(p_token);
  if kid is null then return json_build_object('ok', false, 'reason', 'auth'); end if;
  v := btrim(coalesce(p_nick, ''));
  if char_length(v) < 2 or char_length(v) > 10 then return json_build_object('ok', false, 'reason', 'len'); end if;
  if v !~ '^[가-힣A-Za-z0-9_]+$' then return json_build_object('ok', false, 'reason', 'chars'); end if;
  if lower(v) ~ '(맘캘|momcal|관리자|운영자|방장|admin|official)' then return json_build_object('ok', false, 'reason', 'reserved'); end if;
  update members set nick_custom = v, nick_changed_at = now(), updated_at = now() where kakao_id = kid;
  get diagnostics n = row_count;
  if n = 0 then return json_build_object('ok', false, 'reason', 'auth'); end if;
  return json_build_object('ok', true, 'nickname', v);
end $f$;

create or replace function public.member_profile(p_token text)
returns json language plpgsql stable security definer set search_path to 'public' as $f$
declare kid text; r record;
begin
  kid := _member_from_token(p_token);
  if kid is null then return json_build_object('ok', false); end if;
  select nickname, (nick_custom is not null and nick_custom <> '') as custom into r from members where kakao_id = kid;
  if not found then return json_build_object('ok', false); end if;
  return json_build_object('ok', true, 'nickname', coalesce(r.nickname, ''), 'custom', r.custom);
end $f$;
revoke all on function public.member_set_nickname(text, text) from public;
revoke all on function public.member_profile(text) from public;
grant execute on function public.member_set_nickname(text, text) to anon, authenticated;
grant execute on function public.member_profile(text) to anon, authenticated;

-- ───────── ② 방해금지 시간 ─────────
create or replace function public._push_quiet(p_prefs jsonb) returns boolean
language plpgsql stable as $f$
declare a int; b int; h int;
begin
  if p_prefs is null or (p_prefs->>'quiet_from') is null or (p_prefs->>'quiet_to') is null then return false; end if;
  a := (p_prefs->>'quiet_from')::int; b := (p_prefs->>'quiet_to')::int;
  if a = b then return false; end if;
  h := extract(hour from (now() at time zone 'Asia/Seoul'))::int;
  if a < b then return h >= a and h < b; end if;
  return h >= a or h < b;          -- 자정을 넘기는 구간(예: 22~8)
exception when others then return false;
end $f$;

-- 알림 종류 + 방해금지 시간 저장 (세 표: 웹·아이폰·안드)
create or replace function public.push_set_prefs(p_device text, p_prefs jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v jsonb; n1 int := 0; n2 int := 0; n3 int := 0; a int; b int;
begin
  if p_device is null or length(p_device) < 8 or length(p_device) > 80 then return '{"ok":false}'::jsonb; end if;
  v := jsonb_build_object(
    'gonggu',  coalesce((p_prefs->>'gonggu')::boolean,  true),
    'hotdeal', coalesce((p_prefs->>'hotdeal')::boolean, true),
    'sale',    coalesce((p_prefs->>'sale')::boolean,    true),
    'event',   coalesce((p_prefs->>'event')::boolean,   true));
  -- 방해금지: 두 값이 다 0~23 정수일 때만 받는다. 아니면 「없음」
  begin
    a := (p_prefs->>'quiet_from')::int; b := (p_prefs->>'quiet_to')::int;
    if a between 0 and 23 and b between 0 and 23 and a <> b then
      v := v || jsonb_build_object('quiet_from', a, 'quiet_to', b);
    end if;
  exception when others then null;
  end;
  update public.push_subs set prefs = v where device_id = p_device; get diagnostics n1 = row_count;
  update public.push_ios  set prefs = v where device_id = p_device; get diagnostics n2 = row_count;
  update public.push_fcm  set prefs = v where device_id = p_device; get diagnostics n3 = row_count;
  return jsonb_build_object('ok', true, 'prefs', v, 'rows', n1 + n2 + n3);
end $function$;
grant execute on function public.push_set_prefs(text, jsonb) to anon, authenticated;

-- 실시간 알림 4종에 방해금지 한 줄
create or replace function public.kw_push_targets_ios()
 returns table(device_id text, apns_token text, env text, hotdeal_id bigint, keyword text, title text, price integer, discount_rate integer, mall text, img_url text, unit_price integer, unit_label text)
 language sql stable security definer set search_path to 'public'
as $function$
  select distinct on (s.device_id, h.id)
         s.device_id, s.apns_token, s.env, h.id, k.keyword, h.title, h.price, h.discount_rate, h.mall, h.img_url, h.unit_price, h.unit_label
  from kw_push_subs k
  join push_ios s on s.device_id = k.device_id
  join hotdeals h on position(lower(k.keyword) in lower(h.title)) > 0
  where h.created_at > now() - interval '90 minutes'
    and h.price > 0 and h.img_url is not null
    and (h.expires_at is null or h.expires_at > now())
    and s.fail_count < 5
    and coalesce((s.prefs->>'hotdeal')::boolean, true)
    and not public._push_quiet(s.prefs)
    and not exists (select 1 from kw_push_log l where l.device_id = s.device_id and l.hotdeal_id = h.id)
    and (select count(*) from kw_push_log l2 where l2.device_id = s.device_id and l2.sent_at > now() - interval '24 hours') < 5
  order by s.device_id, h.id, length(k.keyword) desc;
$function$;

create or replace function public.kw_push_targets_fcm()
 returns table(device_id text, fcm_token text, hotdeal_id bigint, keyword text, title text, price integer, discount_rate integer, mall text, img_url text, unit_price integer, unit_label text)
 language sql stable security definer set search_path to 'public'
as $function$
  select distinct on (s.device_id, h.id)
         s.device_id, s.fcm_token, h.id, k.keyword, h.title, h.price, h.discount_rate, h.mall, h.img_url, h.unit_price, h.unit_label
  from kw_push_subs k
  join push_fcm s on s.device_id = k.device_id
  join hotdeals h on position(lower(k.keyword) in lower(h.title)) > 0
  where h.created_at > now() - interval '90 minutes'
    and h.price > 0 and h.img_url is not null
    and (h.expires_at is null or h.expires_at > now())
    and s.fail_count < 5
    and coalesce((s.prefs->>'hotdeal')::boolean, true)
    and not public._push_quiet(s.prefs)
    and not exists (select 1 from kw_push_log l where l.device_id = s.device_id and l.hotdeal_id = h.id)
    and (select count(*) from kw_push_log l2 where l2.device_id = s.device_id and l2.sent_at > now() - interval '24 hours') < 5
  order by s.device_id, h.id, length(k.keyword) desc;
$function$;

create or replace function public.live_push_targets()
 returns table(device_id text, endpoint text, p256dh text, auth text, show_id bigint, title text, channel_name text, start_at timestamp with time zone)
 language sql stable security definer set search_path to 'public'
as $function$
  select s.device_id, s.endpoint, s.p256dh, s.auth, l.id, l.title, l.channel_name, l.start_at
  from live_wishes w
  join push_subs  s on s.device_id = w.device_id
  join live_shows l on l.id = w.show_id
  where l.start_at > now() and l.start_at <= now() + interval '12 minutes'
    and s.fail_count < 5
    and coalesce((s.prefs->>'sale')::boolean, true)
    and not public._push_quiet(s.prefs)
    and not exists (select 1 from live_push_log g where g.device_id = s.device_id and g.show_id = l.id);
$function$;

create or replace function public.live_push_targets_fcm()
 returns table(device_id text, fcm_token text, show_id bigint, title text, channel_name text, start_at timestamp with time zone)
 language sql stable security definer set search_path to 'public'
as $function$
  select s.device_id, s.fcm_token, l.id, l.title, l.channel_name, l.start_at
  from live_wishes_acct w   -- 계정의 다른 기기 찜도 (2026-10-26)
  join push_fcm   s on s.device_id = w.device_id
  join live_shows l on l.id = w.show_id
  where l.start_at > now() and l.start_at <= now() + interval '12 minutes'
    and s.fail_count < 5
    and coalesce((s.prefs->>'sale')::boolean, true)
    and not public._push_quiet(s.prefs)
    and not exists (select 1 from live_push_log g where g.device_id = s.device_id and g.show_id = l.id);
$function$;

-- ───────── 확인 ─────────
select
  public._push_quiet(jsonb_build_object('quiet_from', extract(hour from (now() at time zone 'Asia/Seoul'))::int, 'quiet_to', (extract(hour from (now() at time zone 'Asia/Seoul'))::int + 1) % 24)) as quiet_now_true,
  public._push_quiet(jsonb_build_object('quiet_from', (extract(hour from (now() at time zone 'Asia/Seoul'))::int + 2) % 24, 'quiet_to', (extract(hour from (now() at time zone 'Asia/Seoul'))::int + 3) % 24)) as quiet_later_false,
  public._push_quiet('{"sale":false}'::jsonb) as quiet_none_false,
  public.push_set_prefs('selftest-no-such-device', '{"quiet_from":13,"quiet_to":15,"sale":false}'::jsonb) as set_ok,
  public.push_set_prefs('selftest-no-such-device', '{"quiet_from":99,"quiet_to":"x"}'::jsonb) as set_bad,
  public.member_set_nickname('no-such-token', '시험') as nick_noauth,
  public.member_profile('no-such-token') as prof_noauth,
  (select count(*) from public.kw_push_targets_fcm()) as kw_fcm, (select count(*) from public.kw_push_targets_ios()) as kw_ios,
  (select count(*) from public.live_push_targets()) as live_web, (select count(*) from public.live_push_targets_fcm()) as live_fcm;
