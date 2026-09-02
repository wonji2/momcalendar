-- 🔴 to_char 의 'M' 은 월 패턴이 아니다 → 손님 화면에 "2026년 M월 출석체크 이벤트 당첨!" 으로 떴다
--    (2026-09-02 사장님 지시로 실측 테스트하다 발견). 월은 MM(01-12) 또는 FMMM(1-12).
create or replace function public.member_my_prize(p_token text)
returns json language plpgsql security definer set search_path to 'public' as $function$
declare kid text;
begin
  kid := _member_from_token(p_token);
  if kid is null then return json_build_object('ok', false); end if;
  return coalesce((select json_build_object('ok', true, 'has', true, 'id', id,
            'month', to_char(month,'YYYY년 FMMM월'), 'prize', prize, 'tier', tier,
            'has_contact', contact is not null, 'sent', sent_at is not null)
          from attendance_winners where kakao_id = kid order by month desc limit 1),
         json_build_object('ok', true, 'has', false));
end $function$;
