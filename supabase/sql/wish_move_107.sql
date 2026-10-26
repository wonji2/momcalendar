-- 인앱(카톡·인스타)에서 한 찜을 앱 기기로 「이동」 (2026-10-26 금붕어 검토: 「찜한 것도 그대로 가져가요」가 거짓이었다 · 두 번 세어졌다)
--   인앱에서 「앱으로 열기」를 누르면 주소에 인앱 기기번호(mvfrom)가 실려 앱에 도착한다 → 앱이 wish_move(인앱, 앱) 을 부른다.
--   복사가 아니라 이동이라 찜 수(wishes 행 수)가 그대로다. 공구·세일·라방 찜 모두. 이미 앱 쪽에 있으면 겹치지 않게.
--   보호: 두 번호 모양 검사 · 같은 번호 거절 · 한 번에 최대 500개 · 옮긴 뒤 인앱 쪽은 비게 된다(되풀이해도 0개).
create or replace function public.wish_move(p_from text, p_to text)
returns json language plpgsql security definer set search_path = public as $$
declare g int := 0; s int := 0; l int := 0;
begin
  if p_from is null or p_to is null or p_from = p_to
     or p_from !~ '^[A-Za-z0-9_-]{8,64}$' or p_to !~ '^[A-Za-z0-9_-]{8,64}$' then
    return json_build_object('ok', false);
  end if;
  insert into wishes(device_id, gonggu_id)
    select p_to, gonggu_id from wishes where device_id = p_from limit 500
    on conflict (device_id, gonggu_id) do nothing;
  delete from wishes where device_id = p_from;
  get diagnostics g = row_count;
  insert into sale_wishes(device_id, sale_id, wish, bell)
    select p_to, sale_id, wish, bell from sale_wishes where device_id = p_from limit 200
    on conflict (device_id, sale_id) do update set wish = sale_wishes.wish or excluded.wish, bell = sale_wishes.bell or excluded.bell;
  delete from sale_wishes where device_id = p_from;
  get diagnostics s = row_count;
  insert into live_wishes(device_id, show_id, start_at)
    select p_to, show_id, start_at from live_wishes where device_id = p_from limit 200
    on conflict (device_id, show_id) do nothing;
  delete from live_wishes where device_id = p_from;
  get diagnostics l = row_count;
  return json_build_object('ok', true, 'gonggu', g, 'sale', s, 'live', l);
end $$;
grant execute on function public.wish_move(text, text) to anon, authenticated;
notify pgrst, 'reload schema';
