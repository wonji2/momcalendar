-- 한사람두계정 감시 — 알려진 동명이인은 경보에서 뺀다 (2026-08-20)
--
-- 문제: 아이러브유니(181213_hy) ↔ 유니맘(sohyun_mood) 이 **매일** 경보를 올린다.
--   이 둘은 2026-07-26 에 **의도적으로 분리한 서로 다른 사람**이다(HANDOFF 기록).
--   매일 같은 경보가 쌓이면 진짜 경보가 묻힌다 — 늑대소년이 된다.
--
-- 🔴 감시 자체를 끄지는 않는다. **이 한 쌍만** 빼고 새 쌍은 그대로 잡는다.
--   allowlist 를 테이블로 두어, 앞으로 동명이인이 더 나오면 한 줄만 넣으면 되게 한다.

create table if not exists public.person_dup_allow (
  insta_a text not null,
  insta_b text not null,
  reason  text,
  added_at timestamptz not null default now(),
  primary key (insta_a, insta_b)
);
comment on table public.person_dup_allow is
  '한사람두계정 감시에서 뺄 쌍(동명이인 등). insta_a < insta_b 로 넣는다.';

alter table public.person_dup_allow enable row level security;
revoke all on public.person_dup_allow from anon, authenticated;

insert into public.person_dup_allow (insta_a, insta_b, reason)
values ('181213_hy', 'sohyun_mood',
        '동명이인 — 2026-07-26 에 의도적으로 분리. 아이러브유니 ↔ 유니맘(이소현). 자동삭제 금지')
on conflict do nothing;

-- 감시 함수에서 allowlist 를 제외하도록 조건 한 줄 추가
create or replace function public.data_health_person_dup()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare n int;
begin
  with n2 as (
    select insta, influencer,
           lower(regexp_replace(regexp_replace(name,'([0-9]+차|초특가|특가|모음전|기획전|국산|신상|NEW|한정|공구)','','g'),
                 '[[:space:]·._&/,!+()\[\]''"“”‘’`~-]','','g')) nn,
           open_date::date od
    from gonggu
    where open_date ~ '^\d{4}-\d{2}-\d{2}$' and name is not null and length(name) >= 3
      and coalesce(insta,'') <> '' and coalesce(influencer,'') <> ''
      and open_date >= to_char((now() at time zone 'Asia/Seoul')::date - 60, 'YYYY-MM-DD')
  ),
  p as (
    select a.insta ia, b.insta ib, min(a.influencer) na, min(b.influencer) nb, count(*) ovl
    from n2 a join n2 b
      on a.nn = b.nn
     and a.insta < b.insta
     and abs(a.od - b.od) <= 2
    group by a.insta, b.insta
  )
  select count(*) into n from p
   where ovl >= 2
     and (left(na,2) = left(nb,2) or na like '%'||left(nb,2)||'%'
          or nb like '%'||left(na,2)||'%' or similarity(na, nb) >= 0.35)
     -- 🔴 알려진 동명이인은 뺀다. 새 쌍은 그대로 잡힌다.
     and not exists (select 1 from public.person_dup_allow w
                      where w.insta_a = p.ia and w.insta_b = p.ib);
  if n > 0 then
    insert into health_alerts(kind, detail)
    values ('한사람두계정', n || '쌍 — scratchpad/_q_dup_person.sql 로 확인. 동명이인 사례 있으니 자동삭제 금지');
  end if;
end $function$;

-- 🔴 2026-08-21 추가: 위 data_health_person_dup() 만 고치고 **크론이 실제로 부르는
--    data_health() 본체의 ⑨번은 안 고쳐서** 다음날 아침 경보가 또 떴다.
--    → data_health() ⑨번의 최종 WHERE 에도 같은 조건을 넣어 재생성했다 (2026-08-21 적용 완료):
--      and not exists (select 1 from public.person_dup_allow w
--                       where w.insta_a = p.ia and w.insta_b = p.ib)
--    교훈: 감시 로직을 고칠 땐 **크론이 어느 함수를 부르는지**부터 확인할 것.

-- 쌓인 중복 경보 정리 (같은 내용이 5건 있다)
delete from public.health_alerts where kind = '한사람두계정';

select public.data_health_person_dup();
select count(*) as 남은_한사람두계정_경보 from public.health_alerts where kind = '한사람두계정';
