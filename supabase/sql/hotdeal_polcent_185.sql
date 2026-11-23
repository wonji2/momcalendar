-- 2026-11-23 쿠팡 호출 예산 (길아 님 "한 번만 더 걸리면 영정") — 서버 원자 카운터
create or replace function public.coupang_budget_take(p_kind text default 'deeplink', p_cap int default 19)
returns jsonb language plpgsql security definer set search_path = public as $$
declare st jsonb; d text := (now() at time zone 'Asia/Seoul')::date::text;
begin
  perform pg_advisory_xact_lock(hashtext('coupang-budget'));           -- 동시 회차가 겹쳐도 합계가 새지 않게
  select payload into st from ops_status where id = 'coupang-budget' for update;
  st := coalesce(st, '{}'::jsonb);
  if st->>'day' is distinct from d then                                  -- 날짜(KST)가 바뀌면 리셋
    st := jsonb_build_object('day', d, 'total', 0, 'deeplink', 0, 'image', 0, 'recheck', 0);
  end if;
  if coalesce((st->>'blocked_until')::timestamptz, 'epoch'::timestamptz) > now() then
    return jsonb_build_object('ok', false, 'reason', 'blocked',
      'blocked_until', st->>'blocked_until', 'used', coalesce((st->>'total')::int, 0), 'cap', p_cap);
  end if;
  if coalesce((st->>'total')::int, 0) >= least(p_cap, 59) then
    return jsonb_build_object('ok', false, 'reason', 'cap',
      'used', coalesce((st->>'total')::int, 0), 'cap', least(p_cap, 59));
  end if;
  if p_kind = 'image' and coalesce((st->>'image')::int, 0) >= 3 then
    return jsonb_build_object('ok', false, 'reason', 'image_cap',
      'used', coalesce((st->>'image')::int, 0), 'cap', 3);
  end if;
  st := jsonb_set(st, array['total'], to_jsonb(coalesce((st->>'total')::int, 0) + 1));
  st := jsonb_set(st, array[p_kind], to_jsonb(coalesce((st->>p_kind)::int, 0) + 1));
  insert into ops_status(id, payload, updated_at) values ('coupang-budget', st, now())
    on conflict (id) do update set payload = excluded.payload, updated_at = now();
  return jsonb_build_object('ok', true, 'used', (st->>'total')::int, 'cap', least(p_cap, 59),
                            'kind', p_kind, 'kind_used', (st->>p_kind)::int, 'day', d);
end $$;

create or replace function public.coupang_budget_block(p_reason text, p_hours int default 6)
returns jsonb language plpgsql security definer set search_path = public as $$
declare st jsonb; d text := (now() at time zone 'Asia/Seoul')::date::text; until_ts timestamptz;
begin
  until_ts := now() + (greatest(coalesce(p_hours, 6), 1) || ' hours')::interval;
  select payload into st from ops_status where id = 'coupang-budget' for update;
  st := coalesce(st, '{}'::jsonb);
  if st->>'day' is distinct from d then st := jsonb_build_object('day', d, 'total', 0, 'deeplink', 0, 'image', 0, 'recheck', 0); end if;
  st := jsonb_set(st, array['blocked_until'], to_jsonb(until_ts));
  st := jsonb_set(st, array['last_error'], to_jsonb(coalesce(p_reason, '')));
  insert into ops_status(id, payload, updated_at) values ('coupang-budget', st, now())
    on conflict (id) do update set payload = excluded.payload, updated_at = now();
  insert into health_alerts(kind, detail)
    values ('hotdeal:쿠팡한도', left('쿠팡 호출을 멈췄다 — ' || coalesce(p_reason, '') || ' · 차단 ' || p_hours || '시간', 300));
  return st;
end $$;

revoke all on function public.coupang_budget_take(text, int) from public, anon, authenticated;
revoke all on function public.coupang_budget_block(text, int) from public, anon, authenticated;
grant execute on function public.coupang_budget_take(text, int) to service_role;
grant execute on function public.coupang_budget_block(text, int) to service_role;
