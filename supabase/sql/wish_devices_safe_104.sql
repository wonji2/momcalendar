-- _wish_devices 안전판 (2026-10-26): 계정↔기기 묶기(insert)가 실패해도 찜 목록은 돌려준다
--   10-26 10:33 아이폰 손님 wish_list 500 1건 — 원인 불명(일시 오류 추정). 묶기는 덤이고 목록이 본업이라, 묶기 실패를 삼킨다.
--   읽기 전용(GET) 호출·동시 삽입·잠금 대기 어느 쪽이든 목록은 나간다. 이미 묶여 있으면 쓰지 않는다(쓰기 줄임).
create or replace function public._wish_devices(p_device text, p_token text)
returns text[] language plpgsql security definer set search_path = public as $$
declare v_kid text;
begin
  if p_device is null or p_device !~ '^[A-Za-z0-9_-]{8,64}$' then return array[]::text[]; end if;
  if p_token is not null and p_token <> '' then
    v_kid := _member_from_token(p_token);
    if v_kid is not null then
      if not exists (select 1 from member_devices where kakao_id = v_kid and device_id = p_device) then
        begin
          insert into member_devices(kakao_id, device_id) values (v_kid, p_device) on conflict (kakao_id, device_id) do nothing;
        exception when others then null;
        end;
      end if;
      return array(select device_id from member_devices where kakao_id = v_kid union select p_device);
    end if;
  end if;
  return array[p_device];
end $$;
revoke all on function public._wish_devices(text, text) from anon, authenticated;
