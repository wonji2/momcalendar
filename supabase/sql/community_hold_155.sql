-- 커뮤니티 탭: 외부 링크가 든 글은 자동 보류 → 관리자가 「노출」을 눌러야 손님에게 보인다 (사장님 2026-11-17)
--   배경: 카페 자유수다에 올라온 판매 링크 글(srok.kr · mkt.shopping.naver.com)이 커뮤니티 탭 맨 위에 그대로 떴다.
--   · 판정은 DB 트리거 한 곳(cafe-feed 가 30분마다 덮어써도 다시 판정한다). 손님은 RLS 로 hold=false 인 글만 읽는다 — 사이트 코드·주소는 그대로.
--   · 우리 주소(cafe.naver.com · momcalendar.com)와 공지 글은 보류하지 않는다.
--   · 관리자: admin_community_hold_list() 로 보고 admin_community_set(글번호, true=노출/false=숨김) 으로 정한다. 정한 값은 수집기가 못 바꾼다.
--   · 되돌리기: drop trigger community_hold_biu, community_hold_alert on community_posts; 정책을 using (true) 로; update community_posts set hold=false;
alter table public.community_posts
  add column if not exists hold boolean not null default false,
  add column if not exists hold_reason text,
  add column if not exists approved_at timestamptz;

create or replace function public.community_ext_url(p text) returns text language sql immutable as $$
  select (regexp_match(
    regexp_replace(coalesce(p,''), '(https?://)?([a-z0-9-]+\.)*(cafe\.naver\.com|momcalendar\.com)[^[:space:]]*', ' ', 'gi'),
    '(https?://[^[:space:]]+|www\.[a-z0-9-]+\.[a-z]{2,}[^[:space:]]*|[a-z0-9-]+\.(kr|com|me|ly|co|net|link|io|shop|store|page|site|app)/[^[:space:]]+)', 'i'))[1]
$$;

create or replace function public.community_hold_judge() returns trigger language plpgsql set search_path to 'public' as $$
declare ext text;
begin
  if new.approved_at is not null then new.hold := false; return new; end if;          -- 관리자가 노출로 정한 글
  if new.hold_reason = '관리자 숨김' then new.hold := true; return new; end if;        -- 관리자가 숨긴 글
  if coalesce(new.is_notice, false) then new.hold := false; new.hold_reason := null; return new; end if;
  ext := public.community_ext_url(coalesce(new.title,'') || ' ' || coalesce(new.summary,''));
  if ext is not null then new.hold := true; new.hold_reason := '외부 링크: ' || left(ext, 80);
  else new.hold := false; new.hold_reason := null; end if;
  return new;
end $$;
drop trigger if exists community_hold_biu on public.community_posts;
create trigger community_hold_biu before insert or update on public.community_posts
  for each row execute function public.community_hold_judge();

-- 새로 보류된 글은 관리자 홈 「고장 난 것」에 한 줄(같은 글은 한 번만)
create or replace function public.community_hold_alert() returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if new.hold and new.hold_reason like '외부 링크:%' and (tg_op = 'INSERT' or not coalesce(old.hold, false)) then
    begin
      insert into health_alerts(kind, detail) values ('커뮤니티글보류', '글 ' || new.article_id || ' 「' || left(coalesce(new.title,''), 30) || '」 ' || coalesce(new.nick,'') || ' · ' || new.hold_reason || ' — 관리자 홈 「커뮤니티 보류 글」에서 노출/숨김');
    exception when others then null; end;
  end if;
  return null;
end $$;
drop trigger if exists community_hold_alert on public.community_posts;
create trigger community_hold_alert after insert or update on public.community_posts
  for each row execute function public.community_hold_alert();

drop policy if exists community_posts_public_read on public.community_posts;
create policy community_posts_public_read on public.community_posts for select to anon, authenticated using (not hold);

create or replace function public.admin_community_hold_list() returns json language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not is_app_admin() then raise exception 'forbidden' using errcode='28000'; end if;
  return coalesce((select json_agg(x order by x.posted_at desc) from (
    select article_id, board, title, nick, left(summary, 200) summary, url, posted_at, hold, hold_reason, approved_at
      from community_posts
     where posted_at > now() - interval '45 days' and (hold or approved_at is not null)) x), '[]'::json);
end $$;
create or replace function public.admin_community_set(p_article bigint, p_show boolean) returns json language plpgsql security definer set search_path to 'public' as $$
declare n int;
begin
  if not is_app_admin() then raise exception 'forbidden' using errcode='28000'; end if;
  if p_show then update community_posts set approved_at = now(), hold = false, hold_reason = null where article_id = p_article;
  else update community_posts set approved_at = null, hold = true, hold_reason = '관리자 숨김' where article_id = p_article; end if;
  get diagnostics n = row_count;
  delete from health_alerts where kind = '커뮤니티글보류' and detail like '글 ' || p_article || ' %';
  return json_build_object('ok', n > 0, 'n', n);
end $$;
revoke all on function public.admin_community_hold_list() from public, anon;
revoke all on function public.admin_community_set(bigint, boolean) from public, anon;
grant execute on function public.admin_community_hold_list() to authenticated;
grant execute on function public.admin_community_set(bigint, boolean) to authenticated;

-- 기존 글 다시 판정(최근 45일) — 트리거가 판정한다
update public.community_posts set fetched_at = fetched_at where posted_at > now() - interval '45 days';

-- ── 2026-11-17 검증자 지적 반영 ──
--   A 우리 주소 글자만 붙이면 보류를 피함(srok.kr/cafe.naver.com · evil-momcalendar.com) → 주소를 먼저 뽑고 「호스트」가 우리 것인지 본다
--   B http 없는 단축 주소(me2.do · coupa.ng · han.gl …)와 경로 없는 주소(srok.kr)를 놓침 → 경로가 있으면 어떤 끝자리든, 경로가 없으면 아는 끝자리만
--   E 30일 지난 글은 목록·경보에서 빠지거나 매일 경보가 다시 생김 → 목록은 보류 글 전부, 경보는 최근 30일 글만
create or replace function public.community_ext_url(p text) returns text language plpgsql immutable as $$
declare m text[]; u text; host text;
begin
  for m in select regexp_matches(coalesce(p,''),
      '((?:https?://|www\.)[^[:space:]]+|(?:[a-z0-9-]+\.)+[a-z]{2,}/[^[:space:]]+|(?:[a-z0-9-]+\.)+(?:kr|com|net|me|ly|do|gl|la|ng|im|gle|be|co|io|link|shop|store|page|site|app)(?![a-z0-9-]))', 'gi') loop
    u := m[1];
    host := lower(regexp_replace(regexp_replace(u, '^https?://', '', 'i'), '[/?#:].*$', ''));
    if host ~ '^([a-z0-9-]+\.)*(cafe\.naver\.com|momcalendar\.com)$' then continue; end if;
    return u;
  end loop;
  return null;
end $$;

create or replace function public.community_hold_alert() returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if new.hold and new.hold_reason like '외부 링크:%' and (tg_op = 'INSERT' or not coalesce(old.hold, false))
     and new.posted_at > now() - interval '30 days' then
    begin
      insert into health_alerts(kind, detail) values ('커뮤니티글보류', '글 ' || new.article_id || ' 「' || left(coalesce(new.title,''), 30) || '」 ' || coalesce(new.nick,'') || ' · ' || new.hold_reason || ' — 관리자 홈 「커뮤니티 보류 글」에서 노출/숨김');
    exception when others then null; end;
  end if;
  return null;
end $$;

create or replace function public.admin_community_hold_list() returns json language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not is_app_admin() then raise exception 'forbidden' using errcode='28000'; end if;
  return coalesce((select json_agg(x order by x.posted_at desc) from (
    select article_id, board, title, nick, left(summary, 200) summary, url, posted_at, hold, hold_reason, approved_at
      from community_posts
     where hold or (approved_at is not null and posted_at > now() - interval '45 days')
     order by posted_at desc limit 100) x), '[]'::json);
end $$;

delete from public.health_alerts h where h.kind = '커뮤니티글보류'
  and not exists (select 1 from public.community_posts c where c.hold and c.posted_at > now() - interval '30 days' and h.detail like '글 ' || c.article_id || ' %');
update public.community_posts set fetched_at = fetched_at;
