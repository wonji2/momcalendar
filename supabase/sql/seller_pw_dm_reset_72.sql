-- ═══════════════════════════════════════════════════════════════════════
--  셀러 비밀번호 찾기 — 인스타 DM 코드 방식 (사장님 지시 2026-10-15)
--
--   "인플루언서 소유 계정을 인증해야하니 인스타 디엠이 나을듯" · "셀러 비번 변경 방법을 짜라고"
--
--  흐름
--    ① 셀러(register 로그인 화면 「비밀번호 찾기」)가 아이디를 넣으면 6자리 코드가 **그 셀러 화면에만** 뜬다  → seller_pw_request
--    ② 셀러가 자기 인스타 계정으로 @momcal_ 에 그 코드를 DM 으로 보낸다 (보낸 아이디는 위조할 수 없다 = 계정 소유 증명)
--    ③ 방장이 관리자 화면에서 (아이디·코드)와 DM 이 같은지 보고 「승인」                         → admin_pw_requests / admin_pw_approve
--    ④ 셀러 화면이 승인을 알아채고(seller_pw_status) 새 비밀번호 입력칸을 연다                   → seller_pw_confirm
--
--  지킬 것
--    · 승인 전에는 비밀번호를 못 바꾼다 — 코드만 알아서는 안 된다(방장 승인이 둘째 열쇠)
--    · 요청 10분 유효 · 승인 후 30분 안에 새 비밀번호를 넣어야 한다 · 코드 틀리면 5번까지
--    · 같은 아이디 1시간 5번 요청 상한 · 테이블은 아무도 직접 못 읽는다(RPC 로만)
--    · 🔴 새 함수는 명시 grant 가 없으면 손님이 못 쓴다(2026-09-28 보안 잠금) — 아래 grant 를 빼지 말 것
-- ═══════════════════════════════════════════════════════════════════════

create table if not exists public.seller_pw_requests (
  id          bigserial primary key,
  login_insta text        not null,
  code        text        not null,
  status      text        not null default 'pending',   -- pending → approved → used | expired
  attempts    int         not null default 0,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '10 minutes',
  approved_at timestamptz,
  used_at     timestamptz
);
alter table public.seller_pw_requests enable row level security;
revoke all on public.seller_pw_requests from anon, authenticated;
revoke all on sequence public.seller_pw_requests_id_seq from anon, authenticated;
create index if not exists seller_pw_requests_insta_idx on public.seller_pw_requests (login_insta, created_at desc);

-- ── ① 셀러: 코드 요청 ────────────────────────────────────────────────
create or replace function public.seller_pw_request(p_insta text)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare v text; v_code text; v_n int;
begin
  v := public.seller_id_norm(p_insta);
  if v = '' or length(v) > 60 then return json_build_object('ok', false, 'msg', 'invalid'); end if;
  if not exists (select 1 from sellers where public.seller_id_norm(login_insta) = v and coalesce(login_active, true)) then
    return json_build_object('ok', false, 'msg', 'notfound');
  end if;
  select count(*) into v_n from seller_pw_requests where login_insta = v and created_at > now() - interval '1 hour';
  if v_n >= 5 then return json_build_object('ok', false, 'msg', 'toomany'); end if;
  update seller_pw_requests set status = 'expired' where login_insta = v and status in ('pending', 'approved');
  v_code := lpad((('x' || encode(extensions.gen_random_bytes(4), 'hex'))::bit(32)::bigint % 1000000)::text, 6, '0');
  insert into seller_pw_requests (login_insta, code) values (v, v_code);
  return json_build_object('ok', true, 'code', v_code, 'expires_in', 600);
end $$;

-- ── ① 셀러: 승인 여부 확인(코드를 아는 사람만) ────────────────────────
create or replace function public.seller_pw_status(p_insta text, p_code text)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare v text; r record;
begin
  v := public.seller_id_norm(p_insta);
  select * into r from seller_pw_requests where login_insta = v and code = btrim(coalesce(p_code,'')) order by id desc limit 1;
  if not found then return json_build_object('ok', false, 'status', 'none'); end if;
  if r.status = 'pending'  and r.expires_at < now() then return json_build_object('ok', true, 'status', 'expired'); end if;
  if r.status = 'approved' and r.approved_at + interval '30 minutes' < now() then return json_build_object('ok', true, 'status', 'expired'); end if;
  return json_build_object('ok', true, 'status', r.status);
end $$;

-- ── ④ 셀러: 승인된 요청으로 새 비밀번호 설정 ──────────────────────────
create or replace function public.seller_pw_confirm(p_insta text, p_code text, p_new text)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare v text; r record; v_id bigint; v_login text;
begin
  v := public.seller_id_norm(p_insta);
  if p_new is null or length(p_new) < 6 or length(p_new) > 100 then return json_build_object('ok', false, 'msg', 'weak'); end if;
  select * into r from seller_pw_requests where login_insta = v and status = 'approved' order by id desc limit 1 for update;
  if not found then return json_build_object('ok', false, 'msg', 'notapproved'); end if;
  if r.approved_at + interval '30 minutes' < now() then
    update seller_pw_requests set status = 'expired' where id = r.id;
    return json_build_object('ok', false, 'msg', 'expired');
  end if;
  if r.attempts >= 5 then
    update seller_pw_requests set status = 'expired' where id = r.id;
    return json_build_object('ok', false, 'msg', 'locked');
  end if;
  if r.code <> btrim(coalesce(p_code, '')) then
    update seller_pw_requests set attempts = attempts + 1 where id = r.id;
    return json_build_object('ok', false, 'msg', 'wrongcode');
  end if;
  select id, login_insta into v_id, v_login from sellers where public.seller_id_norm(login_insta) = v order by id limit 1;
  if v_id is null then return json_build_object('ok', false, 'msg', 'notfound'); end if;
  -- 비밀번호는 seller_auth 에 있다(2026-07-23 분리). admin_reset_pw 와 같은 방식으로 쓴다
  insert into seller_auth (seller_id, login_pw) values (v_id, crypt(p_new, gen_salt('bf', 12)))
  on conflict (seller_id) do update set login_pw = excluded.login_pw, updated_at = now();
  delete from seller_sessions where login_insta = v_login;   -- 기존 로그인 세션은 모두 끊는다
  update seller_pw_requests set status = 'used', used_at = now() where id = r.id;
  return json_build_object('ok', true);
end $$;

-- ── ③ 방장: 대기 목록 / 승인 (관리자만) ───────────────────────────────
create or replace function public.admin_pw_requests()
returns json language plpgsql security definer set search_path = public, extensions as $$
begin
  if not public.is_app_admin() then return json_build_object('ok', false, 'msg', 'forbidden'); end if;
  return json_build_object('ok', true, 'items', coalesce((
    select json_agg(json_build_object('id', id, 'insta', login_insta, 'code', code, 'status', status,
                                      'created_at', created_at, 'expires_at', expires_at) order by id desc)
      from seller_pw_requests
     where created_at > now() - interval '1 day'
  ), '[]'::json));
end $$;

create or replace function public.admin_pw_approve(p_id bigint)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare r record;
begin
  if not public.is_app_admin() then return json_build_object('ok', false, 'msg', 'forbidden'); end if;
  select * into r from seller_pw_requests where id = p_id for update;
  if not found then return json_build_object('ok', false, 'msg', 'notfound'); end if;
  if r.status <> 'pending' then return json_build_object('ok', false, 'msg', 'notpending'); end if;
  if r.expires_at < now() then
    update seller_pw_requests set status = 'expired' where id = p_id;
    return json_build_object('ok', false, 'msg', 'expired');
  end if;
  update seller_pw_requests set status = 'approved', approved_at = now() where id = p_id;
  return json_build_object('ok', true);
end $$;

-- ── 권한: 셀러용 3개는 anon, 관리자용 2개는 로그인한 관리자만 ─────────────
revoke execute on function public.seller_pw_request(text)                from public, anon, authenticated;
revoke execute on function public.seller_pw_status(text, text)           from public, anon, authenticated;
revoke execute on function public.seller_pw_confirm(text, text, text)    from public, anon, authenticated;
revoke execute on function public.admin_pw_requests()                    from public, anon, authenticated;
revoke execute on function public.admin_pw_approve(bigint)               from public, anon, authenticated;
grant  execute on function public.seller_pw_request(text)                to anon, authenticated;
grant  execute on function public.seller_pw_status(text, text)           to anon, authenticated;
grant  execute on function public.seller_pw_confirm(text, text, text)    to anon, authenticated;
grant  execute on function public.admin_pw_requests()                    to authenticated;
grant  execute on function public.admin_pw_approve(bigint)               to authenticated;
