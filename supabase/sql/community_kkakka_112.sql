-- 까까에서 출석 빼기 (사장님 2026-10-26 「쿠팡 들어가서 모으는 거는 별도로 하고 출석 체크 선물은 또 별도로 했으면 좋겠어 지금처럼」)
--  출석은 기존 출석 선물(attendance · member_my_prize) 그대로 따로 간다. 까까 = 투표 ×5 + 원장(오늘 핫딜 구경 등)
create or replace function public.kkakka_get(p_token text default null, p_device text default null)
returns jsonb language plpgsql stable security definer set search_path to 'public','extensions' as $$
declare me text; today date := (now() at time zone 'Asia/Seoul')::date; vot int; ext int;
begin
  if p_token is not null and p_token <> '' then me := public._member_from_token(p_token); end if;
  if me is null or me = '' then return jsonb_build_object('ok', true, 'member', false); end if;
  select count(distinct poll_id) into vot from poll_votes where voter = me;
  select coalesce(sum(delta), 0) into ext from kkakka_ledger where voter = me;
  return jsonb_build_object('ok', true, 'member', true,
    'balance', vot * 5 + ext,
    'browse_today', exists(select 1 from kkakka_ledger where voter = me and reason = 'browse' and ref = to_char(today, 'YYYY-MM-DD')),
    'poll_left', (select count(*) from polls p where p.active and (p.ends_at is null or p.ends_at > now())
                    and not exists(select 1 from poll_votes x where x.poll_id = p.id and x.voter = me)));
end $$;
grant execute on function public.kkakka_get(text, text) to anon, authenticated;
select 'ok' as done;
