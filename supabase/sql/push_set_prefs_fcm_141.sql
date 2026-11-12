-- 알림 종류 설정(push_set_prefs)이 안드로이드 앱 기기(push_fcm)에는 저장되지 않던 구멍 (2026-11-12)
--   push_prefs_91.sql 때는 push_fcm 표가 없었다(120 에서 생김). 발송 대상 함수(push_targets_fcm·sale_push_targets_fcm·live_push_targets_fcm·kw_push_targets_fcm)는
--   push_fcm.prefs 를 읽는데, 쓰는 함수가 그 표를 안 고쳐서 갤럭시 앱에서는 알림 종류를 꺼도 계속 왔다.
--   → 세 표(웹 push_subs · 아이폰 push_ios · 안드 push_fcm)를 다 고치고, 몇 줄이 바뀌었는지 돌려준다(0 이면 아직 알림 등록 전인 기기).
create or replace function public.push_set_prefs(p_device text, p_prefs jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v jsonb; n1 int := 0; n2 int := 0; n3 int := 0;
begin
  if p_device is null or length(p_device) < 8 or length(p_device) > 80 then return '{"ok":false}'::jsonb; end if;
  -- 네 키만 받는다 (그 밖의 키·거대한 값은 버린다)
  v := jsonb_build_object(
    'gonggu',  coalesce((p_prefs->>'gonggu')::boolean,  true),
    'hotdeal', coalesce((p_prefs->>'hotdeal')::boolean, true),
    'sale',    coalesce((p_prefs->>'sale')::boolean,    true),
    'event',   coalesce((p_prefs->>'event')::boolean,   true));
  update public.push_subs set prefs = v where device_id = p_device; get diagnostics n1 = row_count;
  update public.push_ios  set prefs = v where device_id = p_device; get diagnostics n2 = row_count;
  update public.push_fcm  set prefs = v where device_id = p_device; get diagnostics n3 = row_count;
  return jsonb_build_object('ok', true, 'prefs', v, 'rows', n1 + n2 + n3);
end $function$;
grant execute on function public.push_set_prefs(text, jsonb) to anon, authenticated;
-- 확인: 없는 기기 번호로 불러 rows=0 · 세 표를 다 고치는지
select public.push_set_prefs('selftest-no-such-device', '{"sale":false}'::jsonb) as r,
       position('push_fcm' in pg_get_functiondef('public.push_set_prefs'::regproc)) > 0 as has_fcm;
