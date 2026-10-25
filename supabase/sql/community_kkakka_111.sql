-- 우리 재화 「까까」 (사장님 2026-10-25 「젤리라고 하지말고 우리만의 재화 별도로 만들어 까까라고 하던지」 「마미톡이 하니까 어떻게 굴러가는지 보고 그대로만 따라하면 되지」)
--  마미톡 젤리 구조를 따른다: 회원만 쌓인다 · 「매일 참여하고 모으기」 미션(출석·투표·구경) · 현금화·양도 불가
--  · 출석 +10 (attendance 하루 1줄) · 투표 +5 (투표 1건) · 오늘 핫딜 구경 +10 (하루 1번, kkakka_ledger reason='browse', ref=KST 날짜)
--  · ⚠ 마미톡의 주 적립(쿠팡 전용 버튼으로 구매 → 결제액 1~2%)은 넣지 않았다 — 마미톡은 쿠팡과 따로 계약한 리워드 매체이고,
--    우리 파트너스 계정에서 구매 보상을 주면 파트너스 정지 위험이 있다(사장님 판단 사항). 쓰는 곳(쿠폰 교환)도 돈이 들어 사장님 판단 사항
alter table if exists public.jelly_ledger rename to kkakka_ledger;
drop function if exists public.jelly_get(text, text);

create or replace function public.kkakka_get(p_token text default null)
returns jsonb language plpgsql stable security definer set search_path to 'public','extensions' as $$
declare me text; today date := (now() at time zone 'Asia/Seoul')::date; att int; vot int; ext int;
begin
  if p_token is not null and p_token <> '' then me := public._member_from_token(p_token); end if;
  if me is null or me = '' then return jsonb_build_object('ok', true, 'member', false); end if;
  select count(*) into att from attendance where kakao_id = me;
  select count(distinct poll_id) into vot from poll_votes where voter = me;
  select coalesce(sum(delta), 0) into ext from kkakka_ledger where voter = me;
  return jsonb_build_object('ok', true, 'member', true,
    'balance', att * 10 + vot * 5 + ext,
    'attend_today', exists(select 1 from attendance where kakao_id = me and day = today),
    'browse_today', exists(select 1 from kkakka_ledger where voter = me and reason = 'browse' and ref = to_char(today, 'YYYY-MM-DD')),
    'poll_left', (select count(*) from polls p where p.active and (p.ends_at is null or p.ends_at > now())
                    and not exists(select 1 from poll_votes x where x.poll_id = p.id and x.voter = me)));
end $$;

create or replace function public.kkakka_mission(p_token text, p_kind text)
returns jsonb language plpgsql security definer set search_path to 'public','extensions' as $$
declare me text; added int := 0; ref text := to_char((now() at time zone 'Asia/Seoul')::date, 'YYYY-MM-DD');
begin
  if p_token is not null and p_token <> '' then me := public._member_from_token(p_token); end if;
  if me is null or me = '' then return jsonb_build_object('ok', false, 'error', 'login'); end if;
  if p_kind is distinct from 'browse' then return jsonb_build_object('ok', false, 'error', 'kind'); end if;
  insert into kkakka_ledger(voter, delta, reason, ref) values (me, 10, 'browse', ref) on conflict do nothing;
  get diagnostics added = row_count;
  return jsonb_build_object('ok', true, 'new', added > 0);
end $$;

grant execute on function public.kkakka_get(text) to anon, authenticated;
grant execute on function public.kkakka_mission(text, text) to anon, authenticated;
select 'ok' as done;
