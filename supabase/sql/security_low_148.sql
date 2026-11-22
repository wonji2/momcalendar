-- 2026-11-13 보안 점검 「덜 급한 것」 묶음 (사장님 「덜급한거 먼저 고쳐」)
-- 원본 점검표 scratchpad/security/2026-11-13-public-source/backend_findings.json
--   F6 문의·방문 기록 무제한 쓰기 → 같은 접속 주소(IP)당 횟수 제한 + 칸 길이 상한
--   F7 셀러 로그인 시도 제한 없음 → 아이디당 15분 10회·IP당 15분 30회 실패하면 잠금(msg 'locked')
--   F8 승인 전 셀러가 손님 목록에 보임 → anon 읽기 정책을 active = true 로
--   F10 배너 노출 부풀리기 → 같은 IP·같은 배너는 10분에 10번까지만 센다
--   F16 RLS 꺼진 표 9개 → 켠다(정책 없음 = API 로 전부 막힘, 서버·cron 은 영향 없음)
-- IP 는 PostgREST 가 넘겨주는 cf-connecting-ip(실측 2026-11-13). api.momcalendar.com(Worker) 경유는
--   Cloudflare 공용 주소(2a06:98c0:…)로 보여 여러 손님이 한 주소가 되므로 상한을 10배로 둔다.
-- 셀러 로그인 응답의 notfound/wrongpw 구분은 그대로 둔다 — 가입(seller_signup)이 'exists' 로 이미 알려 주므로 막아도 효과가 없고 셀러만 헷갈린다.

-- ── 공용: 요청 IP · 고정 창 카운터 ─────────────────────────────
create or replace function public._req_ip() returns text
language sql stable set search_path = public as $$
  select coalesce(nullif(h->>'cf-connecting-ip',''),
                  nullif(btrim(split_part(coalesce(h->>'x-forwarded-for',''), ',', 1)),''),
                  'none')
  from (select nullif(current_setting('request.headers', true), '')::json as h) z
$$;

create table if not exists public.rate_ctr (
  bucket text not null, k text not null, win timestamptz not null, n int not null default 0,
  primary key (bucket, k, win));
alter table public.rate_ctr enable row level security;
revoke all on public.rate_ctr from public, anon, authenticated;

-- 이번 창의 횟수를 1 올리고, 상한 안이면 true
create or replace function public._rate_hit(p_bucket text, p_k text, p_max int, p_secs int) returns boolean
language plpgsql security definer set search_path = public as $$
declare w timestamptz := to_timestamp(floor(extract(epoch from now()) / p_secs) * p_secs); c int;
begin
  insert into rate_ctr (bucket, k, win, n) values (p_bucket, left(coalesce(p_k, 'none'), 200), w, 1)
  on conflict (bucket, k, win) do update set n = rate_ctr.n + 1
  returning n into c;
  if random() < 0.002 then delete from rate_ctr where win < now() - interval '2 days'; end if;
  return c <= p_max;
end $$;

-- 이번 창의 횟수(올리지 않음)
create or replace function public._rate_n(p_bucket text, p_k text, p_secs int) returns int
language sql stable security definer set search_path = public as $$
  select coalesce((select n from rate_ctr
    where bucket = p_bucket and k = left(coalesce(p_k, 'none'), 200)
      and win = to_timestamp(floor(extract(epoch from now()) / p_secs) * p_secs)), 0)
$$;

revoke execute on function public._req_ip() from public, anon, authenticated;
revoke execute on function public._rate_hit(text, text, int, int) from public, anon, authenticated;
revoke execute on function public._rate_n(text, text, int) from public, anon, authenticated;
grant execute on function public._req_ip() to service_role;
grant execute on function public._rate_hit(text, text, int, int) to service_role;
grant execute on function public._rate_n(text, text, int) to service_role;

-- ── F6 events·visits·visitors: 손님 키 쓰기만 IP 당 10분 상한 ──────────
--   전체 손님 합계가 최고 시간당 2,525건(11-13 실측, 10분 ≈ 420)이라 한 IP 600 은 실손님이 닿지 않는다.
create or replace function public._anon_write_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare ip text; mx int; r text;
begin
  r := coalesce(nullif(current_setting('request.jwt.claims', true), '')::json->>'role', '');
  if r <> 'anon' then return new; end if;
  ip := _req_ip();
  mx := case tg_table_name when 'events' then 600 else 120 end;
  if ip like '2a06:98c0:%' then mx := mx * 10; end if;
  if not _rate_hit('w_' || tg_table_name, ip, mx, 600) then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke execute on function public._anon_write_guard() from public, anon, authenticated;

drop trigger if exists zz_anon_write_guard on public.events;
create trigger zz_anon_write_guard before insert on public.events for each row execute function public._anon_write_guard();
drop trigger if exists zz_anon_write_guard on public.visits;
create trigger zz_anon_write_guard before insert on public.visits for each row execute function public._anon_write_guard();
drop trigger if exists zz_anon_write_guard on public.visitors;
create trigger zz_anon_write_guard before insert on public.visitors for each row execute function public._anon_write_guard();

-- 칸 길이 상한(지난 7일 최대 event_data 856자 · referrer/landing_path 300자). 기존 행은 검사하지 않는다(not valid).
alter table public.events drop constraint if exists events_len_chk;
alter table public.events add constraint events_len_chk
  check (length(event_data) <= 8000 and length(event_type) <= 200) not valid;
alter table public.visits drop constraint if exists visits_len_chk;
alter table public.visits add constraint visits_len_chk
  check (length(referrer) <= 2000 and length(landing_path) <= 2000
         and length(anonymous_id) <= 200 and length(user_id) <= 200) not valid;

-- ── F6 문의: IP 당 하루 10건 · 전체 하루 300건 · 캡처는 하루 60장까지 ───────
create or replace function public.submit_inquiry(p_kind text, p_content text, p_contact text DEFAULT NULL::text, p_device text DEFAULT NULL::text, p_page text DEFAULT NULL::text, p_token text DEFAULT NULL::text, p_meta jsonb DEFAULT NULL::jsonb, p_shot text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare kid text; nick text; n int; shot text;
begin
  if p_content is null or length(btrim(p_content)) < 5 then
    return json_build_object('ok', false, 'error', 'too_short');
  end if;
  if length(p_content) > 2000 then
    return json_build_object('ok', false, 'error', 'too_long');
  end if;

  -- 로그인했으면 누가 보냈는지 같이 남긴다(답변하기 쉬우라고)
  if p_token is not null then
    kid := _member_from_token(p_token);
    if kid is not null then select nickname into nick from members where kakao_id = kid; end if;
  end if;

  -- 도배 방지: 같은 기기에서 하루 5건까지
  select count(*) into n from inquiries
   where device_id = p_device and created_at > now() - interval '1 day';
  if p_device is not null and n >= 5 then
    return json_build_object('ok', false, 'error', 'too_many');
  end if;
  -- 보안 점검 2026-11-13 F6: 기기번호를 비우면 위 검사를 건너뛰었다 → 접속 주소당 하루 10건 · 전체 하루 300건
  if not _rate_hit('inq_ip', _req_ip(), 10, 86400) then
    return json_build_object('ok', false, 'error', 'too_many');
  end if;
  if (select count(*) from inquiries where created_at > now() - interval '1 day') >= 300 then
    return json_build_object('ok', false, 'error', 'too_many');
  end if;

  -- 화면 캡처: JPEG/PNG data URL 이고 300KB 이하일 때만 받는다(그 밖엔 버리고 글은 받는다)
  shot := case when p_shot ~ '^data:image/(jpeg|png);base64,[A-Za-z0-9+/=]+$' and length(p_shot) <= 300000 then p_shot else null end;
  -- 캡처는 전체 하루 60장까지(장당 300KB → DB 를 채우지 못하게). 넘으면 글만 받는다
  if shot is not null and (select count(*) from inquiries where shot is not null and created_at > now() - interval '1 day') >= 60 then
    shot := null;
  end if;

  insert into inquiries (kind, content, contact, kakao_id, nickname, device_id, page_url, user_agent, status, meta, shot)
  values (coalesce(nullif(btrim(p_kind),''), 'etc'), btrim(p_content), nullif(btrim(p_contact),''),
          kid, nick, p_device, left(coalesce(p_page,''), 300), left(coalesce(p_meta->>'ua',''), 300), 'new',
          case when p_meta is not null and length(p_meta::text) <= 8000 then p_meta else null end, shot);

  return json_build_object('ok', true, 'shot', shot is not null);
end $function$;

-- ── F7 셀러 로그인·비번 변경: 실패가 아이디당 15분 10회 · IP 당 15분 30회면 잠금 ─────
create or replace function public.seller_login(p_insta text, p_pw text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare r sellers%rowtype; v_hash text; v_token text; v_norm text; v_ip text;
begin
  v_norm := coalesce(public.seller_id_norm(p_insta), '');
  v_ip := public._req_ip();
  if public._rate_n('login_fail_id', v_norm, 900) >= 10 or public._rate_n('login_fail_ip', v_ip, 900) >= 30 then
    return json_build_object('ok', false, 'msg', 'locked');
  end if;

  select * into r from sellers
   where public.seller_id_norm(sellers.login_insta) = v_norm
   order by sellers.id limit 1;
  if not found then
    perform public._rate_hit('login_fail_id', v_norm, 1000000, 900);
    perform public._rate_hit('login_fail_ip', v_ip, 1000000, 900);
    return json_build_object('ok', false, 'msg', 'notfound');
  end if;

  select a.login_pw into v_hash from seller_auth a where a.seller_id = r.id;
  if v_hash is null or v_hash <> crypt(p_pw, v_hash) then
    perform public._rate_hit('login_fail_id', v_norm, 1000000, 900);
    perform public._rate_hit('login_fail_ip', v_ip, 1000000, 900);
    return json_build_object('ok', false, 'msg', 'wrongpw');
  end if;
  if not r.login_active then return json_build_object('ok', false, 'msg', 'pending'); end if;

  -- 약한 비용(00~09)으로 만들어진 해시면 이번 로그인에 조용히 재해시
  if v_hash ~ '^\$2[aby]\$0[0-9]\$' then
    update seller_auth set login_pw = crypt(p_pw, gen_salt('bf', 12)), updated_at = now()
     where seller_id = r.id;
  end if;

  delete from seller_sessions where expires_at < now();

  v_token := encode(gen_random_bytes(32), 'hex');
  insert into seller_sessions (token_hash, login_insta, seller_insta, seller_influencer, expires_at)
  values (encode(digest(v_token, 'sha256'), 'hex'),
          r.login_insta, r.seller_insta, r.seller_influencer,
          now() + interval '30 days');

  return json_build_object('ok', true, 'token', v_token,
    'seller_influencer', r.seller_influencer, 'seller_insta', r.seller_insta, 'login_insta', r.login_insta);
end;
$function$;

create or replace function public.seller_change_pw(p_insta text, p_old text, p_new text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare v_id bigint; v_login text; v_hash text; v_norm text; v_ip text;
begin
  if p_new is null or length(p_new) < 6 then
    return json_build_object('ok', false, 'msg', 'weak');
  end if;
  v_norm := coalesce(public.seller_id_norm(p_insta), '');
  v_ip := public._req_ip();
  if public._rate_n('login_fail_id', v_norm, 900) >= 10 or public._rate_n('login_fail_ip', v_ip, 900) >= 30 then
    return json_build_object('ok', false, 'msg', 'locked');
  end if;

  select id, login_insta into v_id, v_login from sellers
   where public.seller_id_norm(sellers.login_insta) = v_norm
   order by id limit 1;
  if v_id is null then
    perform public._rate_hit('login_fail_id', v_norm, 1000000, 900);
    perform public._rate_hit('login_fail_ip', v_ip, 1000000, 900);
    return json_build_object('ok', false, 'msg', 'notfound');
  end if;

  select a.login_pw into v_hash from seller_auth a where a.seller_id = v_id;
  if v_hash is null or v_hash <> crypt(p_old, v_hash) then
    perform public._rate_hit('login_fail_id', v_norm, 1000000, 900);
    perform public._rate_hit('login_fail_ip', v_ip, 1000000, 900);
    return json_build_object('ok', false, 'msg', 'wrongpw');
  end if;

  update seller_auth set login_pw = crypt(p_new, gen_salt('bf', 12)), updated_at = now()
   where seller_id = v_id;

  -- 비밀번호를 바꾸면 기존 로그인 세션은 모두 끊는다 (⚠ 실제 저장된 login_insta 로 지운다)
  delete from seller_sessions where login_insta = v_login;
  return json_build_object('ok', true);
end;
$function$;

-- ── F10 배너 노출: 같은 IP·같은 배너 10분에 10번까지만 센다(화면은 기기당 하루 1번만 부른다) ──
create or replace function public.bump_banner_view(p_banner_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public._rate_hit('bv', public._req_ip() || ':' || p_banner_id, 10, 600) then return; end if;
  insert into banner_impressions (banner_id, day, views)
  values (p_banner_id, (now() at time zone 'Asia/Seoul')::date, 1)
  on conflict (banner_id, day)
  do update set views = banner_impressions.views + 1;
end;
$function$;

-- ── F8 셀러 공개 목록은 활성 셀러만 ──────────────────────────
alter policy sellers_anon_read on public.sellers using (active = true);

-- ── F16 RLS 꺼진 표 9개 켜기 (rls_audit_140 의 나머지) ─────────────
alter table public._tq_res enable row level security;
alter table public.events_daily enable row level security;
alter table public.gonggu_dup_lamour_20260928 enable row level security;
alter table public.gonggu_dupnorm2_backup_20260929 enable row level security;
alter table public.gonggu_dupnorm_backup_20260928 enable row level security;
alter table public.gonggu_hold enable row level security;
alter table public.visitors_daily enable row level security;
alter table public.visits_daily enable row level security;
alter table public.wish_counts_cache enable row level security;

notify pgrst, 'reload schema';
select json_build_object(
  'rls_off', (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
              where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity),
  'triggers', (select count(*) from pg_trigger where tgname = 'zz_anon_write_guard'),
  'sellers_policy', (select qual from pg_policies where tablename = 'sellers' and policyname = 'sellers_anon_read'));
