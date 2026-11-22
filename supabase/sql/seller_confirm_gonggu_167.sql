-- 셀러 「이 일정 맞아요 · 올려주세요」 (사장님 2026-11-18 「본인이 맞으면 올려달라고 요청 버튼 넣고 누르면 바로 올림」)
--   집계 사이트 단서로 들어와 「셀러 원본 확인 전」(gonggu_hold 집계미확인)으로 숨겨 둔 행은 셀러 화면에 「승인대기」로 보이는데
--   관리자 대기 목록·자동 승인에는 안 잡힌다(2026-11-18 나도살림). 셀러 본인이 맞다고 누르면 그것이 원본 확인이다 → 보류를 풀고 바로 올린다.
--   올리지 않는 것: 다른 사유로 보류된 행(내 공구 2주 창·공식 계정·중복·손으로 내린 것) · 차단 셀러 · 이미 끝난 행.
--   상품명·차단 브랜드 등 기존 트리거는 그대로 걸린다(트리거가 되돌리면 approved=false 로 남고 화면은 「확인 후 올려드릴게요」).
--   PC 가 꺼져도 돈다(DB 함수).
create or replace function public.seller_confirm_gonggu(p_token text, p_id bigint) returns json
language plpgsql security definer set search_path to 'public', 'extensions' as $fn$
declare v_login text; v_insta text; v_infl text; v_handle text; g gonggu%rowtype; v_reason text; v_ok boolean;
        v_today text := to_char((now() at time zone 'Asia/Seoul')::date, 'YYYY-MM-DD');
begin
  select t.login_insta, t.seller_insta, t.seller_influencer into v_login, v_insta, v_infl from _seller_from_token(p_token) t;
  if v_login is null then raise exception 'unauthorized' using errcode = '28000'; end if;
  v_handle := replace(coalesce(nullif(v_insta, ''), v_login), '@', '');
  select * into g from gonggu where id = p_id and insta = v_handle for update;
  if not found then return json_build_object('ok', false, 'msg', 'notyours'); end if;
  if g.approved then return json_build_object('ok', true, 'approved', true); end if;
  if coalesce(g.end_date, g.open_date) < v_today then return json_build_object('ok', false, 'msg', 'ended'); end if;
  if seller_blocked(g.insta, g.influencer) then return json_build_object('ok', false, 'msg', 'held'); end if;
  select reason into v_reason from gonggu_hold where id = p_id;
  if found and v_reason not like '집계미확인%' then return json_build_object('ok', false, 'msg', 'held'); end if;
  delete from gonggu_hold where id = p_id and reason like '집계미확인%';
  perform set_config('mc.actor', 'seller', true);
  update gonggu set approved = true, source = 'seller' where id = p_id;
  perform set_config('mc.actor', '', true);
  select approved into v_ok from gonggu where id = p_id;
  return json_build_object('ok', true, 'approved', coalesce(v_ok, false));
end $fn$;
revoke all on function public.seller_confirm_gonggu(text, bigint) from public;
grant execute on function public.seller_confirm_gonggu(text, bigint) to anon, authenticated;
