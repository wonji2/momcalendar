-- 관리자 화면의 「🔄 쿠팡에서 지금 다시 받기」 버튼이 쓰는 함수 (2026-10-06)
--
-- 🔑 왜 RPC 를 거치나: 엣지함수 coupang-revenue 는 PUSH_CRON_SECRET 을 요구한다.
--    그 값을 **브라우저에 내려보내면 안 된다**(관리자 화면 소스는 누구나 본다).
--    그래서 서버 안에서 Vault 에 든 값을 읽어 호출한다 — 열쇠가 바깥으로 안 나간다.
--
-- ⚠ net.http_post 는 비동기다. 보내기만 하고 결과를 기다리지 않는다
--    → 버튼을 누르면 몇 초 뒤 새로고침해야 숫자가 바뀐다. 화면 안내도 그렇게 써 뒀다.

create or replace function public.coupang_revenue_refetch()
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare sec text; rid bigint;
begin
  -- 크론에 이미 들어 있는 같은 값을 꺼내 쓴다 — 따로 보관하지 않는다
  select (regexp_match(command, '''secret'',\s*''([^'']+)'''))[1]
    into sec from cron.job where jobname = 'coupang-revenue' limit 1;
  if sec is null then
    return jsonb_build_object('ok', false, 'why', 'coupang-revenue 크론이 없어 열쇠를 못 찾았다');
  end if;

  select net.http_post(
    url := 'https://hycaqsqeogjtbscmzrtm.supabase.co/functions/v1/coupang-revenue',
    headers := jsonb_build_object('Content-Type','application/json'),
    body := jsonb_build_object('secret', sec, 'days', 7),
    timeout_milliseconds := 120000) into rid;

  return jsonb_build_object('ok', true, 'request_id', rid);
end $$;

revoke all on function public.coupang_revenue_refetch() from public, anon;
grant execute on function public.coupang_revenue_refetch() to authenticated;

select 'refetch 함수' k, count(*)::text v from pg_proc where proname = 'coupang_revenue_refetch';
