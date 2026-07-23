-- ══════════════════════════════════════════════════════════
--  RLS 정리 4단계 — 찜(wishes) 보호
--  적용일: 2026-07-23
--
--  배경: wishes 가 DELETE roles={public} using(true) 라
--        DELETE /rest/v1/wishes 한 번이면 전 회원 찜이 전부 지워졌다.
--        (PostgREST 는 필터 없는 DELETE 를 그대로 실행한다)
--
--  해결: 테이블 직접 접근을 막고 함수로만 처리.
--        함수는 항상 device_id 조건을 강제하므로 일괄 삭제가 불가능하다.
--
--  ⚠ 선행조건: index.html 이 wish_list / wish_toggle 을 쓰도록 교체된 뒤 실행
-- ══════════════════════════════════════════════════════════


-- ── 내 찜 목록 ──
create or replace function public.wish_list(p_device text)
returns table (gonggu_id bigint)
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_device is null or p_device !~ '^[A-Za-z0-9_-]{8,64}$' then return; end if;
  return query select w.gonggu_id from wishes w where w.device_id = p_device;
end;
$$;


-- ── 찜 추가/해제 (항상 내 기기 것만) ──
create or replace function public.wish_toggle(p_device text, p_gonggu bigint, p_on boolean)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare v_cnt int;
begin
  if p_device is null or p_device !~ '^[A-Za-z0-9_-]{8,64}$' then
    return json_build_object('ok', false, 'msg', 'baddevice');
  end if;
  if p_gonggu is null then
    return json_build_object('ok', false, 'msg', 'badid');
  end if;

  if p_on then
    -- 한 기기당 상한 (무한 삽입으로 DB 부풀리는 것 방지)
    select count(*) into v_cnt from wishes where device_id = p_device;
    if v_cnt >= 500 then return json_build_object('ok', false, 'msg', 'limit'); end if;

    insert into wishes (device_id, gonggu_id)
    values (p_device, p_gonggu)
    on conflict (device_id, gonggu_id) do nothing;
  else
    delete from wishes where device_id = p_device and gonggu_id = p_gonggu;
  end if;

  return json_build_object('ok', true);
end;
$$;


-- ── 찜 수 집계 (TOP100 정렬용) ──
--    기존 함수는 SECURITY INVOKER 라 wishes 권한을 회수하면 깨진다 → DEFINER 로 교체.
--    집계값만 반환하므로 device_id 는 노출되지 않는다.
create or replace function public.wish_counts()
returns table (gonggu_id bigint, cnt bigint)
language sql
stable
security definer
set search_path = public
as $$
  select gonggu_id, count(*)::bigint from wishes group by gonggu_id;
$$;


-- ── 실행 권한 ──
revoke execute on function public.wish_list(text)                          from public;
revoke execute on function public.wish_toggle(text, bigint, boolean)       from public;
revoke execute on function public.wish_counts()                            from public;
grant  execute on function public.wish_list(text)                          to anon, authenticated;
grant  execute on function public.wish_toggle(text, bigint, boolean)       to anon, authenticated;
grant  execute on function public.wish_counts()                            to anon, authenticated;


-- ── 테이블 직접 접근 차단 ──
drop policy if exists wishes_insert on public.wishes;
drop policy if exists wishes_delete on public.wishes;
drop policy if exists wishes_read   on public.wishes;
revoke all on public.wishes from anon, authenticated;
