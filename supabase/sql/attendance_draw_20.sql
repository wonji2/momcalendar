-- 출석 추첨: 관리자용 명단 조회 + 무작위 추첨 + 당첨자 관리
-- 등급 기준은 프론트(ATTEND_TIERS)와 같아야 한다: 1=20일↑, 2=25일↑, 3=개근

create table if not exists attendance_winners (
  id        bigserial primary key,
  month     date   not null,           -- 해당 월 1일
  tier      int    not null,           -- 1 / 2 / 3
  kakao_id  text   not null,
  nickname  text,
  days      int,
  prize     text,
  drawn_at  timestamptz default now(),
  sent_at   timestamptz,               -- 기프티콘 보낸 시각
  unique (month, kakao_id)             -- 한 달에 한 사람 한 번만
);
alter table attendance_winners enable row level security;
create index if not exists attendance_winners_month_idx on attendance_winners (month desc);

-- 그 달 마지막 날
create or replace function _month_last(p_month date)
returns int language sql immutable as $$
  select extract(day from (date_trunc('month', p_month) + interval '1 month - 1 day'))::int;
$$;

-- ── 관리자: 이 달 출석 현황 ────────────────────────────
create or replace function admin_attendance_stats(p_month date default null)
returns json language plpgsql security definer set search_path = public as $$
declare m date; lastd int; res json;
begin
  if not is_app_admin() then raise exception 'forbidden'; end if;
  m := date_trunc('month', coalesce(p_month, (now() at time zone 'Asia/Seoul')::date))::date;
  lastd := _month_last(m);

  select json_build_object(
    'month', m, 'last_day', lastd,
    'total_members', (select count(*) from members),
    'checked_any',   (select count(distinct kakao_id) from attendance
                        where day >= m and day < m + interval '1 month'),
    'tiers', json_build_object(
      't1', (select count(*) from _att_days(m) where days >= 20),
      't2', (select count(*) from _att_days(m) where days >= 25),
      't3', (select count(*) from _att_days(m) where days >= lastd)
    ),
    'list', coalesce((
      select json_agg(json_build_object(
               'kakao_id', a.kakao_id,
               'nickname', coalesce(mb.nickname, '(닉네임 없음)'),
               'days', a.days,
               'tier', case when a.days >= lastd then 3 when a.days >= 25 then 2
                            when a.days >= 20 then 1 else 0 end,
               'won', (select w.prize from attendance_winners w
                        where w.month = m and w.kakao_id = a.kakao_id)
             ) order by a.days desc)
      from _att_days(m) a left join members mb on mb.kakao_id = a.kakao_id
      where a.days >= 20), '[]'::json)
  ) into res;
  return res;
end $$;

-- 그 달 사람별 출석일수 (내부용)
create or replace function _att_days(p_month date)
returns table(kakao_id text, days int)
language sql stable security definer set search_path = public as $$
  select kakao_id, count(*)::int
  from attendance
  where day >= date_trunc('month', p_month)::date
    and day <  (date_trunc('month', p_month) + interval '1 month')::date
  group by kakao_id;
$$;

-- ── 관리자: 추첨 ───────────────────────────────────────
-- 같은 달에 이미 당첨된 사람은 제외하고, 해당 등급 자격자 중 무작위로 뽑는다.
create or replace function admin_attendance_draw(p_month date, p_tier int, p_count int, p_prize text)
returns json language plpgsql security definer set search_path = public as $$
declare m date; lastd int; need int; n int;
begin
  if not is_app_admin() then raise exception 'forbidden'; end if;
  m := date_trunc('month', p_month)::date;
  lastd := _month_last(m);
  need := case p_tier when 3 then lastd when 2 then 25 else 20 end;

  insert into attendance_winners (month, tier, kakao_id, nickname, days, prize)
  select m, p_tier, a.kakao_id, mb.nickname, a.days, p_prize
  from _att_days(m) a
  left join members mb on mb.kakao_id = a.kakao_id
  where a.days >= need
    and not exists (select 1 from attendance_winners w where w.month = m and w.kakao_id = a.kakao_id)
  order by random()
  limit greatest(p_count, 0)
  on conflict (month, kakao_id) do nothing;

  get diagnostics n = row_count;
  return json_build_object('ok', true, 'drawn', n);
end $$;

create or replace function admin_attendance_winners(p_month date default null)
returns json language plpgsql security definer set search_path = public as $$
declare m date;
begin
  if not is_app_admin() then raise exception 'forbidden'; end if;
  m := date_trunc('month', coalesce(p_month, (now() at time zone 'Asia/Seoul')::date))::date;
  return coalesce((select json_agg(json_build_object(
      'id', id, 'tier', tier, 'nickname', coalesce(nickname,'(닉네임 없음)'),
      'kakao_id', kakao_id, 'days', days, 'prize', prize,
      'sent', sent_at is not null) order by tier desc, days desc)
    from attendance_winners where month = m), '[]'::json);
end $$;

create or replace function admin_winner_sent(p_id bigint, p_sent boolean default true)
returns json language plpgsql security definer set search_path = public as $$
begin
  if not is_app_admin() then raise exception 'forbidden'; end if;
  update attendance_winners set sent_at = case when p_sent then now() else null end where id = p_id;
  return json_build_object('ok', true);
end $$;

create or replace function admin_attendance_reset(p_month date, p_tier int default null)
returns json language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not is_app_admin() then raise exception 'forbidden'; end if;
  delete from attendance_winners
   where month = date_trunc('month', p_month)::date
     and (p_tier is null or tier = p_tier);
  get diagnostics n = row_count;
  return json_build_object('ok', true, 'deleted', n);
end $$;

-- 관리자 전용 (브라우저 anon 은 호출 불가)
revoke all on function admin_attendance_stats(date)                 from public, anon;
revoke all on function admin_attendance_draw(date,int,int,text)      from public, anon;
revoke all on function admin_attendance_winners(date)                from public, anon;
revoke all on function admin_winner_sent(bigint, boolean)            from public, anon;
revoke all on function admin_attendance_reset(date,int)              from public, anon;
revoke all on function _att_days(date)                               from public, anon, authenticated;
grant execute on function admin_attendance_stats(date)               to authenticated;
grant execute on function admin_attendance_draw(date,int,int,text)   to authenticated;
grant execute on function admin_attendance_winners(date)             to authenticated;
grant execute on function admin_winner_sent(bigint, boolean)         to authenticated;
grant execute on function admin_attendance_reset(date,int)           to authenticated;

-- ── 회원: 내가 당첨됐는지 ──────────────────────────────
create or replace function member_my_prize(p_token text)
returns json language plpgsql security definer set search_path = public as $$
declare kid text;
begin
  kid := _member_from_token(p_token);
  if kid is null then return json_build_object('ok', false); end if;
  return coalesce((select json_build_object('ok', true, 'has', true,
            'month', to_char(month,'YYYY-MM'), 'prize', prize, 'tier', tier,
            'sent', sent_at is not null)
          from attendance_winners where kakao_id = kid order by month desc limit 1),
         json_build_object('ok', true, 'has', false));
end $$;
grant execute on function member_my_prize(text) to anon, authenticated;

select 'ok' as result;
