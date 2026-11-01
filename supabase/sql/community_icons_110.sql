-- 커뮤니티 투표·젤리 보강 (검증자 지적 2026-10-25, 109 위에 덮어씀)
--  · 로그인 전 기기로 투표 → 로그인 뒤에도 「투표함」으로 보이고 다시 못 찍게(기기 번호·회원 둘 다 본다)
--  · 같은 투표를 다시 누르면 new=false (화면이 +5 토스트를 안 띄움)
--  · p_opt null 막기 · 젤리 투표 수 = 투표 건수(같은 투표 두 줄이어도 1번)
create or replace function public._voter_dev(p_device text)
returns text language sql immutable as $$
  select case when p_device is not null and length(p_device) between 8 and 80 then 'd:' || p_device end
$$;
revoke all on function public._voter_dev(text) from public, anon, authenticated;

create or replace function public.poll_list(p_token text default null, p_device text default null)
returns jsonb language sql stable security definer set search_path to 'public','extensions' as $$
  with v as (select public._voter(p_token, p_device) as me, public._voter_dev(p_device) as dev)
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', p.id, 'title', p.title, 'options', to_jsonb(p.options),
      'counts', (select jsonb_agg(coalesce((select count(*) from poll_votes x where x.poll_id = p.id and x.opt = o.i - 1), 0) order by o.i)
                 from generate_subscripts(p.options, 1) as o(i)),
      'total', (select count(*) from poll_votes x where x.poll_id = p.id),
      'my', (select x.opt from poll_votes x, v where x.poll_id = p.id and (x.voter = v.me or x.voter = v.dev) order by x.created_at limit 1),
      'ends_at', p.ends_at) order by p.created_at desc), '[]'::jsonb)
  from polls p where p.active and (p.ends_at is null or p.ends_at > now());
$$;

create or replace function public.poll_vote(p_poll bigint, p_opt int, p_token text default null, p_device text default null)
returns jsonb language plpgsql security definer set search_path to 'public','extensions' as $$
declare me text; dev text; n int; added int := 0;
begin
  me := public._voter(p_token, p_device); dev := public._voter_dev(p_device);
  if me is null then return jsonb_build_object('ok', false, 'error', 'who'); end if;
  select array_length(options, 1) into n from polls where id = p_poll and active and (ends_at is null or ends_at > now());
  if n is null or p_opt is null or p_opt < 0 or p_opt >= n then return jsonb_build_object('ok', false, 'error', 'poll'); end if;
  if not exists (select 1 from poll_votes where poll_id = p_poll and (voter = me or voter = dev)) then
    insert into poll_votes(poll_id, voter, opt) values (p_poll, me, p_opt) on conflict do nothing;
    get diagnostics added = row_count;
  end if;
  return jsonb_build_object('ok', true, 'new', added > 0, 'polls', public.poll_list(p_token, p_device));
end $$;

create or replace function public.jelly_get(p_token text default null, p_device text default null)
returns jsonb language plpgsql stable security definer set search_path to 'public','extensions' as $$
declare me text; dev text; att int := 0; vot int := 0; ext int := 0;
begin
  me := public._voter(p_token, p_device);
  if me is null then return jsonb_build_object('ok', false); end if;
  dev := public._voter_dev(p_device);
  if me not like 'd:%' then select count(*) into att from attendance where kakao_id = me; end if;
  select count(distinct poll_id) into vot from poll_votes where voter = me or voter = dev;
  select coalesce(sum(delta), 0) into ext from jelly_ledger where voter = me or voter = dev;
  return jsonb_build_object('ok', true, 'balance', att * 10 + vot * 5 + ext, 'attend_days', att, 'votes', vot, 'extra', ext, 'member', me not like 'd:%');
end $$;

grant execute on function public.poll_list(text, text) to anon, authenticated;
grant execute on function public.poll_vote(bigint, int, text, text) to anon, authenticated;
grant execute on function public.jelly_get(text, text) to anon, authenticated;
select 'ok' as done;
