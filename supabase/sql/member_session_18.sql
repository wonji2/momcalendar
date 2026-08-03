-- 회원 기능(출석·캘린더 내보내기)용 세션 + 데이터
-- 셀러 세션(seller_sessions)과 같은 방식: 토큰 원문은 저장하지 않고 sha256 해시만 둔다.
-- 세 테이블 모두 RLS on + 정책 없음 = SECURITY DEFINER 함수로만 접근 가능.

create table if not exists member_sessions (
  token_hash text primary key,
  kakao_id   text not null,
  created_at timestamptz default now(),
  expires_at timestamptz default now() + interval '180 days'
);
create index if not exists member_sessions_kakao_idx on member_sessions (kakao_id);
alter table member_sessions enable row level security;

-- 출석 (하루 1회 강제: PK가 막아준다)
create table if not exists attendance (
  kakao_id   text not null,
  day        date not null,
  created_at timestamptz default now(),
  primary key (kakao_id, day)
);
alter table attendance enable row level security;

-- 캘린더로 내보낸 공구 (기기를 바꿔도 중복 안 되게 서버에 기록)
create table if not exists member_ics (
  kakao_id  text not null,
  gonggu_id bigint not null,
  sent_at   timestamptz default now(),
  primary key (kakao_id, gonggu_id)
);
alter table member_ics enable row level security;

-- ── 토큰 → 회원 ────────────────────────────────────────
create or replace function _member_from_token(p_token text)
returns text language sql stable security definer set search_path = public, extensions as $$
  select kakao_id from member_sessions
  where token_hash = encode(digest(coalesce(p_token,''), 'sha256'), 'hex')
    and expires_at > now()
  limit 1;
$$;

-- ── 출석 체크 ──────────────────────────────────────────
-- ⚠ 날짜는 반드시 한국시간. DB는 UTC라 안 하면 밤 9시 이후 출석이 다음 날로 밀린다.
create or replace function member_check_in(p_token text)
returns json language plpgsql security definer set search_path = public as $$
declare
  kid text; d date; fresh boolean; total int; streak int := 0; probe date;
begin
  kid := _member_from_token(p_token);
  if kid is null then return json_build_object('ok', false, 'error', 'login_required'); end if;

  d := (now() at time zone 'Asia/Seoul')::date;
  insert into attendance (kakao_id, day) values (kid, d) on conflict do nothing;
  get diagnostics total = row_count;
  fresh := (total = 1);

  -- 이번 달 출석일수
  select count(*) into total from attendance
   where kakao_id = kid and day >= date_trunc('month', d)::date;

  -- 연속 출석 (오늘부터 거꾸로)
  probe := d;
  loop
    exit when not exists (select 1 from attendance where kakao_id = kid and day = probe);
    streak := streak + 1;
    probe := probe - 1;
  end loop;

  return json_build_object('ok', true, 'first_today', fresh, 'day', d,
                           'month_days', total, 'streak', streak);
end $$;

-- 이번 달 출석 현황만 조회 (도장판 그리기용)
create or replace function member_attendance(p_token text)
returns json language plpgsql security definer set search_path = public as $$
declare kid text; d date; days int[]; total int; streak int := 0; probe date;
begin
  kid := _member_from_token(p_token);
  if kid is null then return json_build_object('ok', false, 'error', 'login_required'); end if;
  d := (now() at time zone 'Asia/Seoul')::date;
  select coalesce(array_agg(extract(day from day)::int order by day), '{}')
    into days from attendance
   where kakao_id = kid and day >= date_trunc('month', d)::date and day <= d;
  total := coalesce(array_length(days,1), 0);
  probe := d;
  loop
    exit when not exists (select 1 from attendance where kakao_id = kid and day = probe);
    streak := streak + 1; probe := probe - 1;
  end loop;
  return json_build_object('ok', true, 'today', d, 'days', days,
                           'month_days', total, 'streak', streak,
                           'checked_today', exists(select 1 from attendance where kakao_id=kid and day=d));
end $$;

-- ── 캘린더 내보낸 목록 ─────────────────────────────────
create or replace function member_ics_sent(p_token text)
returns json language plpgsql security definer set search_path = public as $$
declare kid text; ids bigint[];
begin
  kid := _member_from_token(p_token);
  if kid is null then return json_build_object('ok', false, 'error', 'login_required'); end if;
  select coalesce(array_agg(gonggu_id), '{}') into ids from member_ics where kakao_id = kid;
  return json_build_object('ok', true, 'ids', ids);
end $$;

create or replace function member_ics_mark(p_token text, p_ids bigint[])
returns json language plpgsql security definer set search_path = public as $$
declare kid text; n int;
begin
  kid := _member_from_token(p_token);
  if kid is null then return json_build_object('ok', false, 'error', 'login_required'); end if;
  if p_ids is null or array_length(p_ids,1) is null then return json_build_object('ok', true, 'added', 0); end if;
  if array_length(p_ids,1) > 500 then return json_build_object('ok', false, 'error', 'too_many'); end if;
  insert into member_ics (kakao_id, gonggu_id)
  select kid, unnest(p_ids) on conflict do nothing;
  get diagnostics n = row_count;
  return json_build_object('ok', true, 'added', n);
end $$;

-- 브라우저(anon)가 호출할 수 있게. 토큰이 없으면 함수 안에서 막힌다.
revoke all on function _member_from_token(text) from public, anon, authenticated;
grant execute on function member_check_in(text)          to anon, authenticated;
grant execute on function member_attendance(text)        to anon, authenticated;
grant execute on function member_ics_sent(text)          to anon, authenticated;
grant execute on function member_ics_mark(text, bigint[]) to anon, authenticated;

select 'ok' as result;
