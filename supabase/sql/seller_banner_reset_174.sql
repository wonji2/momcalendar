-- 이웃셀러 「내 배너」를 자동 연동으로 되돌리기 (사장님 2026-11-19 「배너를 따로 설정하지 않으면 등록된 일정 결제 링크로 자동」 · 「배너 연동을 잘 바꿔줘야 돼, 계속」)
--   셀러가 한 번 직접 꾸미면(banners.seller_id 행) 자동 연동(Edge seller-banner-auto, 30분)이 그 셀러를 건너뛴다.
--   이 함수로 직접 꾸민 배너를 지우면 다음 회차(30분 안)부터 다시 오늘 공구 결제 링크로 자동으로 걸린다.
--   되돌리기: drop function public.seller_banner_reset(text);
create or replace function public.seller_banner_reset(p_token text) returns json
language plpgsql security definer set search_path to 'public', 'extensions', 'pg_temp' as $fn$
declare c json; v_id bigint; n int;
begin
  c := public.seller_banner_can(p_token);
  if c->>'msg' = 'unauthorized' then raise exception 'unauthorized' using errcode = '28000'; end if;
  if (c->>'ok')::boolean is not true then return json_build_object('ok', false, 'msg', c->>'msg'); end if;
  v_id := (c->>'seller_id')::bigint;
  delete from banners where seller_id = v_id;
  get diagnostics n = row_count;
  if n > 0 then
    insert into health_alerts(kind, detail) values ('이웃셀러배너:자동으로', (c->>'name') || ' — 직접 꾸민 배너를 지우고 자동 연동으로 되돌림');
  end if;
  return json_build_object('ok', true, 'removed', n);
end $fn$;
revoke all on function public.seller_banner_reset(text) from public;
grant execute on function public.seller_banner_reset(text) to anon, authenticated;
