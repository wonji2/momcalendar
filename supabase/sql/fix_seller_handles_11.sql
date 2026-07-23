-- ══════════════════════════════════════════════════════════
--  셀러 인스타 핸들 정리 — 2026-07-23
--
--  발단: "채아맘 인스타 아이디가 엉뚱한 곳으로 연결된다"는 사용자 제보.
--  전수 조사 결과 셀러명↔핸들이 어긋난 케이스 3건을 찾았다.
--
--  ⚠ 어느 핸들이 맞는지는 DB로 알 수 없다. 아래 내용은 전부
--    사장님이 직접 확인해 알려준 값이다. 임의로 추측해 고치지 말 것.
-- ══════════════════════════════════════════════════════════

-- ── 0) 삭제 예정 행 백업 (되돌릴 수 있게) ──
create table if not exists public.gonggu_deleted_20260723 (like public.gonggu including defaults);
alter table public.gonggu_deleted_20260723 enable row level security;
revoke all on public.gonggu_deleted_20260723 from anon, authenticated;

insert into public.gonggu_deleted_20260723
select * from public.gonggu where insta = 'my.77l77l';


-- ── 1) 진짜 채아맘 = chae.a_mommy ──
--    10건 중 7건은 셀러명이 비어 있고 3건은 '@chae.a_mommy' 로 들어가 있어
--    사이트에 한글명 대신 아이디가 노출되고 있었다.
update public.gonggu
   set influencer = '채아맘'
 where insta = 'chae.a_mommy';


-- ── 2) 김소희aka채아맘 = chaea___mom (밑줄 3개) ──
--    DB 에는 밑줄이 2개인 'chaea__mom' 으로 12건 들어가 있었다(오타).
--    활동명이 '채아맘' 으로 겹쳐서 진짜 채아맘과 혼동됨 → 활동명도 구분되게 변경.
update public.gonggu
   set insta = 'chaea___mom',
       influencer = '김소희aka채아맘'
 where insta = 'chaea__mom';


-- ── 3) influencers 표 정리 (기본키가 insta 임에 주의) ──
delete from public.influencers where insta = 'chaea__mom';

insert into public.influencers (influencer, insta)
values ('채아맘', 'chae.a_mommy')
on conflict (insta) do update set influencer = excluded.influencer;

insert into public.influencers (influencer, insta)
values ('김소희aka채아맘', 'chaea___mom')
on conflict (insta) do update set influencer = excluded.influencer;


-- ── 4) 도하맘 / 도하세하네 는 서로 다른 사람 ──
--    do_ha0720 = 도하세하네, my__doha_ = 도하맘
--    공구 쪽에 이름이 섞여 있었다(do_ha0720 인데 '도하맘' 으로 적힌 16건).
update public.gonggu
   set influencer = '도하세하네'
 where insta = 'do_ha0720' and coalesce(influencer,'') <> '도하세하네';

update public.gonggu
   set influencer = '도하맘'
 where insta = 'my__doha_' and coalesce(influencer,'') <> '도하맘';


-- ── 5) 끼끼맘 전체 삭제 (사장님 지시) ──
--    핸들이 my.77l77l / my.77l78l 로 엇갈려 어느 쪽이 맞는지 확인 불가 → 전량 삭제.
--    백업은 gonggu_deleted_20260723 에 있다. 필요 없어지면 그 테이블을 지우면 됨.
delete from public.gonggu where insta = 'my.77l77l';
delete from public.influencers where insta in ('my.77l77l', 'my.77l78l');
