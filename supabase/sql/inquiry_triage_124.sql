-- 손님 제보 자동 처리 (사장님 2026-10-26 "손님 오류는 니가 매일 확인해서 자동으로 처리 · 메인 관리자 화면에서 어떻게 처리했는지 내가 보이게")
--   triage     = 처리기가 가른 종류 (date 날짜 · gone 공구없음 · name 이름 · link 링크 · site 사이트기능 · etc 기타)
--                kind 는 손님이 고른 것이라 따로 둔다
--   handled_at = 처리(닫음) 시각
--   inquiry_recent(n) — 관리자 첫 화면용. shot(화면 base64)은 빼고 has_shot 만
--   inquiry_shot(id)  — 「화면」 눌렀을 때 한 장만
alter table public.inquiries add column if not exists triage text;
alter table public.inquiries add column if not exists handled_at timestamptz;

create or replace function public.inquiry_recent(p_limit int default 20)
returns table(id bigint, kind text, triage text, status text, content text, admin_memo text,
              nickname text, created_at timestamptz, handled_at timestamptz, has_shot boolean, env text)
language plpgsql security definer set search_path = public as $$
begin
  if not is_app_admin() then raise exception 'admin only'; end if;
  return query
  select i.id, i.kind, i.triage, i.status, i.content, i.admin_memo, i.nickname, i.created_at, i.handled_at,
         (i.shot is not null and i.shot <> ''), coalesce(i.meta->>'env','')
  from inquiries i
  order by (i.status in ('new','doing')) desc, i.created_at desc
  limit greatest(1, least(p_limit, 100));
end; $$;

create or replace function public.inquiry_shot(p_id bigint)
returns text language plpgsql security definer set search_path = public as $$
begin
  if not is_app_admin() then raise exception 'admin only'; end if;
  return (select shot from inquiries where id = p_id);
end; $$;

revoke all on function public.inquiry_recent(int) from public, anon;
revoke all on function public.inquiry_shot(bigint) from public, anon;
grant execute on function public.inquiry_recent(int) to authenticated;
grant execute on function public.inquiry_shot(bigint) to authenticated;
