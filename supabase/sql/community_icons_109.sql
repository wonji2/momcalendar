-- 커뮤니티 맨 위 아이콘 4개(젤리·출석·투표·공지) 서버 쪽 (사장님 2026-10-25 「쿠팡 들어가는 젤리 보상 그런 거랑 출석 체크랑 투표 기능 공지 이렇게 아이콘 네 개」)
--  · 누구로 셀지(_voter): 로그인 회원이면 kakao_id, 아니면 'd:'+기기 번호
--  · 투표: polls(운영자가 만든다) · poll_votes(한 사람 한 표) · poll_list / poll_vote (anon RPC)
--  · 젤리: 따로 쌓지 않고 계산 — 출석한 날 ×10 + 투표 참여 ×5 + jelly_ledger(앞으로 쿠팡 적립 등). jelly_get (anon RPC)
--    ⚠ 「쿠팡에서 사면 젤리」는 쿠팡 파트너스 규정 확인 전이라 넣지 않았다(ledger 칸만 준비)
create table if not exists public.polls(
  id bigserial primary key, title text not null, options text[] not null,
  active boolean not null default true, ends_at timestamptz, created_at timestamptz not null default now());
create table if not exists public.poll_votes(
  poll_id bigint not null references public.polls(id) on delete cascade, voter text not null, opt int not null,
  created_at timestamptz not null default now(), primary key(poll_id, voter));
create table if not exists public.jelly_ledger(
  id bigserial primary key, voter text not null, delta int not null, reason text not null, ref text not null default '',
  created_at timestamptz not null default now(), unique(voter, reason, ref));
alter table public.polls enable row level security;
alter table public.poll_votes enable row level security;
alter table public.jelly_ledger enable row level security;

create or replace function public._voter(p_token text, p_device text)
returns text language plpgsql stable security definer set search_path to 'public','extensions' as $$
declare k text;
begin
  if p_token is not null and p_token <> '' then k := public._member_from_token(p_token); end if;
  if k is not null and k <> '' then return k; end if;
  if p_device is null or length(p_device) < 8 or length(p_device) > 80 then return null; end if;
  return 'd:' || p_device;
end $$;

create or replace function public.poll_list(p_token text default null, p_device text default null)
returns jsonb language sql stable security definer set search_path to 'public','extensions' as $$
  with v as (select public._voter(p_token, p_device) as me)
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', p.id, 'title', p.title, 'options', to_jsonb(p.options),
      'counts', (select jsonb_agg(coalesce((select count(*) from poll_votes x where x.poll_id = p.id and x.opt = o.i - 1), 0) order by o.i)
                 from generate_subscripts(p.options, 1) as o(i)),
      'total', (select count(*) from poll_votes x where x.poll_id = p.id),
      'my', (select x.opt from poll_votes x, v where x.poll_id = p.id and x.voter = v.me),
      'ends_at', p.ends_at) order by p.created_at desc), '[]'::jsonb)
  from polls p where p.active and (p.ends_at is null or p.ends_at > now());
$$;

create or replace function public.poll_vote(p_poll bigint, p_opt int, p_token text default null, p_device text default null)
returns jsonb language plpgsql security definer set search_path to 'public','extensions' as $$
declare me text; n int;
begin
  me := public._voter(p_token, p_device);
  if me is null then return jsonb_build_object('ok', false, 'error', 'who'); end if;
  select array_length(options, 1) into n from polls where id = p_poll and active and (ends_at is null or ends_at > now());
  if n is null or p_opt < 0 or p_opt >= n then return jsonb_build_object('ok', false, 'error', 'poll'); end if;
  insert into poll_votes(poll_id, voter, opt) values (p_poll, me, p_opt) on conflict do nothing;
  return jsonb_build_object('ok', true, 'polls', public.poll_list(p_token, p_device));
end $$;

create or replace function public.jelly_get(p_token text default null, p_device text default null)
returns jsonb language plpgsql stable security definer set search_path to 'public','extensions' as $$
declare me text; dev text; att int := 0; vot int := 0; ext int := 0;
begin
  me := public._voter(p_token, p_device);
  if me is null then return jsonb_build_object('ok', false); end if;
  dev := case when p_device is not null and length(p_device) between 8 and 80 then 'd:' || p_device end;
  if me not like 'd:%' then select count(*) into att from attendance where kakao_id = me; end if;
  select count(*) into vot from poll_votes where voter = me or voter = dev;
  select coalesce(sum(delta), 0) into ext from jelly_ledger where voter = me or voter = dev;
  return jsonb_build_object('ok', true, 'balance', att * 10 + vot * 5 + ext, 'attend_days', att, 'votes', vot, 'extra', ext, 'member', me not like 'd:%');
end $$;

grant execute on function public.poll_list(text, text) to anon, authenticated;
grant execute on function public.poll_vote(bigint, int, text, text) to anon, authenticated;
grant execute on function public.jelly_get(text, text) to anon, authenticated;
revoke all on function public._voter(text, text) from public, anon, authenticated;

-- 첫 투표 하나 (사장님이 언제든 내리거나 바꿀 수 있다: update polls set active=false where id=…)
insert into public.polls(title, options)
select '커뮤니티에 제일 먼저 생겼으면 하는 기능은?', array['사이트에서 바로 글쓰기','내 글 댓글 알림','동네 게시판','체험단 후기 게시판']
where not exists (select 1 from public.polls);
select (select count(*) from public.polls) as polls;
