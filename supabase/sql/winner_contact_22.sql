-- 당첨자만 연락처를 남기게 한다(전체 회원에게 번호를 요구하지 않으려고).
-- 발송 완료로 표시하면 연락처는 자동으로 지운다 — 개인정보를 오래 들고 있지 않기 위함.
alter table attendance_winners add column if not exists contact text;
alter table attendance_winners add column if not exists contact_at timestamptz;

-- 회원: 내 당첨 확인 (연락처 입력 여부 포함)
create or replace function member_my_prize(p_token text)
returns json language plpgsql security definer set search_path = public as $$
declare kid text;
begin
  kid := _member_from_token(p_token);
  if kid is null then return json_build_object('ok', false); end if;
  return coalesce((select json_build_object('ok', true, 'has', true, 'id', id,
            'month', to_char(month,'YYYY년 M월'), 'prize', prize, 'tier', tier,
            'has_contact', contact is not null, 'sent', sent_at is not null)
          from attendance_winners where kakao_id = kid order by month desc limit 1),
         json_build_object('ok', true, 'has', false));
end $$;

-- 회원: 기프티콘 받을 연락처 남기기
create or replace function member_set_contact(p_token text, p_contact text)
returns json language plpgsql security definer set search_path = public as $$
declare kid text; n int;
begin
  kid := _member_from_token(p_token);
  if kid is null then return json_build_object('ok', false, 'error', 'login_required'); end if;
  if p_contact is null or length(btrim(p_contact)) < 6 then
    return json_build_object('ok', false, 'error', 'bad_contact');
  end if;
  update attendance_winners
     set contact = left(btrim(p_contact), 60), contact_at = now()
   where kakao_id = kid and sent_at is null;
  get diagnostics n = row_count;
  return json_build_object('ok', n > 0);
end $$;

-- 관리자: 발송 완료로 바꾸면 연락처를 지운다
create or replace function admin_winner_sent(p_id bigint, p_sent boolean default true)
returns json language plpgsql security definer set search_path = public as $$
begin
  if not is_app_admin() then raise exception 'forbidden'; end if;
  if p_sent then
    update attendance_winners
       set sent_at = now(), contact = null, contact_at = null   -- 보낸 뒤엔 연락처 보관 안 함
     where id = p_id;
  else
    update attendance_winners set sent_at = null where id = p_id;
  end if;
  return json_build_object('ok', true);
end $$;

-- 관리자 목록에 연락처 노출
create or replace function admin_attendance_winners(p_month date default null)
returns json language plpgsql security definer set search_path = public as $$
declare m date;
begin
  if not is_app_admin() then raise exception 'forbidden'; end if;
  m := date_trunc('month', coalesce(p_month, (now() at time zone 'Asia/Seoul')::date))::date;
  return coalesce((select json_agg(json_build_object(
      'id', id, 'tier', tier, 'nickname', coalesce(nickname,'(닉네임 없음)'),
      'kakao_id', kakao_id, 'days', days, 'prize', prize,
      'contact', contact, 'sent', sent_at is not null) order by tier desc, days desc)
    from attendance_winners where month = m), '[]'::json);
end $$;

grant execute on function member_my_prize(text)        to anon, authenticated;
grant execute on function member_set_contact(text,text) to anon, authenticated;
revoke all on function member_set_contact(text,text)    from public;

select 'ok' as result;
