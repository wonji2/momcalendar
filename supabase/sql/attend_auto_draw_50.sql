-- 출석 경품: 매월 1일 자동 추첨 → 사장님 승인 → 그때부터 당첨자에게 안내 (사장님 지시 2026-09-02)
--   "매월 1일 자동으로 뽑힌 다음 나한테 승인받고 그 다음 당첨자들 안내 나가도록 해"
--
-- 지금까지는 뽑는 즉시 손님 화면에 당첨 안내가 떴다(승인 단계가 없었다).
-- approved_at 을 두어 **승인 전에는 손님에게 아무것도 안 보이게** 한다.

-- ① 승인 표시 컬럼
alter table public.attendance_winners add column if not exists approved_at timestamptz;

-- 이미 뽑혀서 안내가 나가는 중인 행(2026-08 3명)은 승인된 것으로 둔다.
-- 지금 와서 감추면 이미 본 손님이 혼란스럽다.
update public.attendance_winners set approved_at = coalesce(approved_at, drawn_at, now()) where approved_at is null;

-- ② 손님 화면: 승인된 것만 보여준다
create or replace function public.member_my_prize(p_token text)
returns json language plpgsql security definer set search_path to 'public' as $function$
declare kid text;
begin
  kid := _member_from_token(p_token);
  if kid is null then return json_build_object('ok', false); end if;
  -- 🔴 approved_at 이 없으면 사장님이 아직 승인 안 한 것 → 손님에게 보이지 않는다
  return coalesce((select json_build_object('ok', true, 'has', true, 'id', id,
            'month', to_char(month,'YYYY년 FMMM월'), 'prize', prize, 'tier', tier,
            'has_contact', contact is not null, 'sent', sent_at is not null)
          from attendance_winners where kakao_id = kid and approved_at is not null
          order by month desc limit 1),
         json_build_object('ok', true, 'has', false));
end $function$;

-- ③ 관리자 목록에 승인 여부를 같이 준다
create or replace function public.admin_attendance_winners(p_month date default null::date)
returns json language plpgsql security definer set search_path to 'public' as $function$
declare m date;
begin
  if not is_app_admin() then raise exception 'forbidden'; end if;
  m := date_trunc('month', p_month)::date;
  return coalesce((select json_agg(json_build_object(
      'id', id, 'tier', tier, 'nickname', nickname, 'kakao_id', kakao_id,
      'days', days, 'prize', prize, 'contact', contact,
      'sent', sent_at is not null, 'approved', approved_at is not null)
    order by tier desc, days desc) from attendance_winners where month = m), '[]'::json);
end $function$;

-- ④ 승인 = 안내 시작 (그 달 미승인분 전부)
create or replace function public.admin_attendance_approve(p_month date)
returns json language plpgsql security definer set search_path to 'public' as $function$
declare m date; n int;
begin
  if not is_app_admin() then raise exception 'forbidden'; end if;
  m := date_trunc('month', p_month)::date;
  update attendance_winners set approved_at = now() where month = m and approved_at is null;
  get diagnostics n = row_count;
  -- 승인했으면 '승인 대기' 경보는 지운다
  delete from health_alerts where kind = '출석경품승인대기' and detail like '%' || to_char(m,'YYYY-MM') || '%';
  return json_build_object('ok', true, 'approved', n);
end $function$;

-- ⑤ 되돌리기 (잘못 승인했을 때)
create or replace function public.admin_attendance_unapprove(p_month date)
returns json language plpgsql security definer set search_path to 'public' as $function$
declare m date; n int;
begin
  if not is_app_admin() then raise exception 'forbidden'; end if;
  m := date_trunc('month', p_month)::date;
  -- 이미 연락처를 받았거나 발송한 건은 되돌리지 않는다 (손님이 이미 봤다)
  update attendance_winners set approved_at = null
   where month = m and approved_at is not null and contact is null and sent_at is null;
  get diagnostics n = row_count;
  return json_build_object('ok', true, 'unapproved', n);
end $function$;

-- ⑥ 매월 1일 자동 추첨 (지난달 대상). 승인 전 상태로 넣는다.
--    ⚠ 등급·경품·인원은 화면(index.html ATTEND_TIERS · admin.html AT_TIERS)과 **같아야 한다**.
--       바꿀 때 세 곳을 같이 고칠 것.
create or replace function public.attendance_auto_draw()
returns json language plpgsql security definer set search_path to 'public' as $function$
declare m date; lastd int; total int := 0; n int;
        t record;
begin
  -- 지난달 (KST 기준)
  m := (date_trunc('month', (now() at time zone 'Asia/Seoul')::date) - interval '1 month')::date;
  lastd := _month_last(m);

  -- 이미 뽑은 달이면 아무것도 하지 않는다 (두 번 뽑기 방지)
  if exists (select 1 from attendance_winners where month = m) then
    return json_build_object('ok', true, 'skipped', 'already_drawn', 'month', m);
  end if;

  -- 🔴 높은 등급부터 뽑는다. 한 사람은 한 달에 한 번만 당첨되므로
  --    낮은 등급을 먼저 뽑으면 상위 등급 대상자가 사라진다 (2026-08 실측으로 확인).
  for t in select * from (values
      (3, lastd, 1, '치킨 or 피자'),
      (2, 25,    3, '다이소 3천원권'),
      (1, 20,    5, '커피 기프티콘')
    ) as v(tier, need, cnt, prize)
  loop
    insert into attendance_winners (month, tier, kakao_id, nickname, days, prize)
    select m, t.tier, a.kakao_id, mb.nickname, a.days, t.prize
    from _att_days(m) a
    left join members mb on mb.kakao_id = a.kakao_id
    where a.days >= t.need
      and not exists (select 1 from attendance_winners w where w.month = m and w.kakao_id = a.kakao_id)
    order by random()
    limit t.cnt
    on conflict (month, kakao_id) do nothing;
    get diagnostics n = row_count;
    total := total + n;
  end loop;

  -- 사장님이 승인해야 안내가 나간다 → 잊지 않게 경보로 남긴다
  if total > 0 then
    insert into health_alerts(kind, detail)
    values ('출석경품승인대기',
            to_char(m,'YYYY-MM') || ' 출석 경품 ' || total || '명 자동 추첨됨 — 관리자 💜 출석·추첨 탭에서 승인해야 당첨 안내가 나갑니다');
  end if;
  return json_build_object('ok', true, 'month', m, 'drawn', total);
end $function$;

revoke all on function public.attendance_auto_draw() from public, anon, authenticated;
revoke all on function public.admin_attendance_approve(date) from public, anon;
revoke all on function public.admin_attendance_unapprove(date) from public, anon;
grant execute on function public.admin_attendance_approve(date) to authenticated;
grant execute on function public.admin_attendance_unapprove(date) to authenticated;

-- ⑦ 승인 전에는 연락처도 못 넣게 (실측에서 뚫린 구멍 — 2026-09-02)
--    손님 화면엔 안 보이지만 RPC 를 직접 부르면 저장됐다. 승인 전 개인정보를 받아둘 이유가 없다.
create or replace function public.member_set_contact(p_token text, p_contact text)
returns json language plpgsql security definer set search_path to 'public' as $function$
declare kid text; n int;
begin
  kid := _member_from_token(p_token);
  if kid is null then return json_build_object('ok', false, 'error', 'login_required'); end if;
  if p_contact is null or length(btrim(p_contact)) < 6 then
    return json_build_object('ok', false, 'error', 'bad_contact');
  end if;
  update attendance_winners
     set contact = left(btrim(p_contact), 60), contact_at = now()
   where kakao_id = kid and sent_at is null and approved_at is not null;
  get diagnostics n = row_count;
  return json_build_object('ok', n > 0);
end $function$;
