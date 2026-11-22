-- 셀러 단위 차단 + 리에종드로렌·최선정(@sjingg_) 삭제 (사장님 2026-10-26 — 브랜드 측 삭제 요청
--   「해당 브랜드랑 셀러 최선정 자체를 디비에서 없애고 다신 수집하지 말고 검색에도 안뜨게 해달래」)
--  · brand_block(이름 정규식)은 브랜드만 막는다 — 이 셀러가 판 다른 브랜드(카이·레이캅·셀리온…)는 못 막는다
--    → seller_block(insta·한글명) 을 새로 두고, gonggu 트리거가 둘 다 본다. 걸린 행은 조용히 버리고 events 에 남긴다
--  · 백업: scratchpad/삭제요청/2026-10-26_리에종드로렌_최선정_*.json (지우기 전 전 칸)
create table if not exists public.seller_block(
  insta text primary key, name text, reason text not null default '', created_at timestamptz not null default now());
alter table public.seller_block enable row level security;
grant select on public.seller_block to anon, authenticated;            -- 빌드(build.ps1)·도구가 공개 키로 읽는다(값은 핸들뿐)
drop policy if exists seller_block_read on public.seller_block;
create policy seller_block_read on public.seller_block for select using (true);

create or replace function public.seller_blocked(p_insta text, p_name text)
returns boolean language sql stable as $$
  select exists (select 1 from seller_block b
    where lower(b.insta) = lower(trim(both '@' from coalesce(p_insta, '')))
       or (b.name is not null and b.name <> '' and b.name = trim(coalesce(p_name, ''))));
$$;

create or replace function public.trg_brand_block_gonggu()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if brand_blocked(new.name) or brand_blocked(new.brand) or brand_blocked(new.item) or seller_blocked(new.insta, new.influencer) then
    begin
      insert into events(event_type, event_data) values ('brand_block', ('gonggu 차단: ' || coalesce(new.insta,'') || ' ' || coalesce(new.name,''))::text);
    exception when others then null;
    end;
    return null;
  end if;
  return new;
end $$;

insert into public.seller_block(insta, name, reason) values ('sjingg_', '최선정', '2026-10-26 리에종드로렌 측 삭제·수집중단 요청(대표 성명·계정 무단 사용)')
on conflict (insta) do update set name = excluded.name, reason = excluded.reason;
insert into public.brand_block(pattern, reason)
select '(리에종|리애종|liaison)[ _-]*(드|de)?[ _-]*(로렌|loren)', '2026-10-26 리에종드로렌 측 삭제·수집중단 요청'
where not exists (select 1 from public.brand_block where pattern = '(리에종|리애종|liaison)[ _-]*(드|de)?[ _-]*(로렌|loren)');

-- 지우기 (백업은 위 json)
delete from public.wishes where gonggu_id in (select id from public.gonggu where seller_blocked(insta, influencer) or brand_blocked(name));
delete from public.gonggu where seller_blocked(insta, influencer) or brand_blocked(name);
delete from public.gonggu_archive where seller_blocked(insta, influencer) or brand_blocked(name);
delete from public.gonggu_backup_clean where lower(insta) = 'sjingg_';
delete from public.seller_profile where lower(insta) = 'sjingg_';
select seo_refresh();
select (select count(*) from gonggu where insta ilike '%sjingg%' or name ~* '리에종') g,
       (select count(*) from gonggu_archive where insta ilike '%sjingg%' or name ~* '리에종') a,
       (select count(*) from seller_block) sb, (select count(*) from brand_block where pattern ~ '리에종') bb;
