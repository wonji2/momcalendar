-- data_health() 재생성 v41 (2026-08-31)
--
-- 🔴 경위: 8/29 honeypot 제외 배포(data_health.sql) 때 8/21에 넣었던 ⑨(한사람두계정)가
--   빠진 채 재생성됐다 — 이틀간 그 감시가 조용히 꺼져 있었다. pg_get_functiondef 로 실측 확인.
--   교훈 재확인: 감시 함수를 고칠 땐 "크론이 부르는 본체의 현재 정의 전체"를 기준으로 고친다.
--   (부분 파일만 보고 재생성하면 다른 검사가 지워진다)
--
-- 이번 판 = ①~⑧(8/29판 그대로, honeypot 제외 포함) + ⑨ 복원(allowlist 포함) + ⑩ 신규.
--
-- ⑩ 계약만료 셀러배너 (사장님 지시 2026-08-31, 2번안 채택):
--   이웃셀러 존은 sellers 계약기간으로 자동 소멸되지만 셀러배너(banners type='seller')는
--   기간 연동이 없어 계약이 끝나도 남는다(젤리또리 65·66 실사고). 배너 title 의 '셀러명'과
--   유효한 is_partner 셀러를 대조해, 소속 셀러가 만료·부재면 경보를 올린다.
--   ad_memo '유지' 배너도 계약이 끝나면 경보에 뜬다(그때 사장님 판단).

create or replace function public.data_health()
returns void language plpgsql security definer set search_path = public as $$
declare n int;
begin
  -- ① 이중인코딩 (× ÷ 는 정상이라 범위에서 뺌)
  select count(*) into n from gonggu
   where major ~ '[À-ÖØ-öø-ÿ]' or minor ~ '[À-ÖØ-öø-ÿ]' or name ~ '[À-ÖØ-öø-ÿ]';
  if n > 0 then insert into health_alerts(kind, detail) values ('이중인코딩', n || '건'); end if;

  -- ② 역슬래시 잔재 (LIKE 는 못 잡는다 — 반드시 정규식)
  select count(*) into n from gonggu where name ~ '[\\]';
  if n > 0 then insert into health_alerts(kind, detail) values ('역슬래시', n || '건'); end if;

  -- ③ 유니코드 이스케이프 잔재
  select count(*) into n from gonggu where name ~ 'u00[0-9a-fA-F]{2}';
  if n > 0 then insert into health_alerts(kind, detail) values ('이스케이프', n || '건'); end if;

  -- ④ 유령문자
  select count(*) into n from gonggu
   where name ~ ('['||chr(8203)||chr(8204)||chr(8205)||chr(8288)||chr(65279)||chr(173)||']');
  if n > 0 then insert into health_alerts(kind, detail) values ('유령문자', n || '건'); end if;

  -- ⑤ 날짜불량 (형식은 맞는데 실제 날짜가 아님 — ::date 캐스트가 터진다)
  select count(*) into n from gonggu
   where (open_date ~ '^\d{4}-\d{2}-\d{2}$' and (substring(open_date,6,2)::int not between 1 and 12
                                              or substring(open_date,9,2)::int not between 1 and 31))
      or (end_date  ~ '^\d{4}-\d{2}-\d{2}$' and (substring(end_date,6,2)::int  not between 1 and 12
                                              or substring(end_date,9,2)::int  not between 1 and 31));
  if n > 0 then insert into health_alerts(kind, detail) values ('날짜불량', n || '건'); end if;

  -- ⑥ 같은 셀러·같은 날 중복 (꾸밈말 제거 후 양방향 포함관계)
  with g as (
    select id, insta, open_date,
           lower(regexp_replace(regexp_replace(name,'([0-9]+차|초특가|특가|모음전|기획전|국산|신상|NEW|한정|공구|앵콜|재오픈)','','g'),'[[:space:]·._&/,!+()\[\]-]','','g')) nn
    from gonggu where approved and open_date ~ '^\d{4}-\d{2}-\d{2}$'
      and open_date >= to_char((now() at time zone 'Asia/Seoul')::date - 7, 'YYYY-MM-DD')
  )
  select count(*) into n from g a join g b
    on a.insta=b.insta and a.open_date=b.open_date and a.id<b.id
   and (a.nn=b.nn or (length(a.nn)>=4 and b.nn like '%'||a.nn||'%')
                  or (length(b.nn)>=4 and a.nn like '%'||b.nn||'%'));
  if n > 0 then insert into health_alerts(kind, detail) values ('중복공구', n || '쌍'); end if;

  -- ⑦ 살아있는 핫딜에 가격·사진·링크 빈 것
  select count(*) into n from hotdeals
   where (expires_at is null or expires_at > now())
     and (price is null or img_url is null or link is null or coalesce(mall,'') = '');
  if n > 0 then insert into health_alerts(kind, detail) values ('핫딜누락', n || '건'); end if;

  -- ⑧ 승인 공구인데 갈 곳(핸들·결제링크) 없음 = 카드가 안 보임
  --    ⚠ 스크래핑 함정(honeypot: 떼브란네·미르뎃소)은 일부러 insta·pay_link 를 비웠고 마감경과라 손님 노출 0 → 제외
  select count(*) into n from gonggu
   where approved and coalesce(insta,'')='' and coalesce(pay_link,'') !~ '^https?://'
     and name not like '떼브란네%' and name not like '미르뎃소%';
  if n > 0 then insert into health_alerts(kind, detail) values ('갈곳없는공구', n || '건'); end if;

  -- ⑨ 한사람두계정 (8/29 재생성 때 빠졌던 것 복원 — allowlist 제외 포함)
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
     and not exists (select 1 from public.person_dup_allow w
                      where w.insta_a = p.ia and w.insta_b = p.ib);
  if n > 0 then
    insert into health_alerts(kind, detail)
    values ('한사람두계정', n || '쌍 — scratchpad/_q_dup_person.sql 로 확인. 동명이인 사례 있으니 자동삭제 금지');
  end if;

  -- ⑩ 계약만료 셀러배너 (2026-08-31 신규 — 젤리또리 사고 재발 방지)
  select count(*) into n from banners b
   where b.type='seller' and b.active
     and not exists (
       select 1 from sellers s
        where s.is_partner and s.active
          and b.title like '%'||s.name||'%'
          and (s.start_date is null or s.start_date <= (now() at time zone 'Asia/Seoul')::date)
          and (s.end_date   is null or s.end_date   >= (now() at time zone 'Asia/Seoul')::date)
     );
  if n > 0 then insert into health_alerts(kind, detail)
    values ('계약만료셀러배너', n || '건 — banners type=seller 대조. ad_memo 유지 지정이면 사장님 확인 후 처리'); end if;
end $$;

revoke all on function public.data_health() from public, anon, authenticated;
