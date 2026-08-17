-- 🔴 data_health() 에 ⑨번 추가: "한 사람이 계정 2개" 중복 감시 (2026-08-17)
--
-- 계기: 벤시몽 맘커플신발이 도하맘(my__doha_)·도하상점(bonheur_0926) 두 카드로 노출됨(사장님 지적).
--       기존 ⑥번 중복검사는 **같은 insta 안에서만** 보기 때문에 계정이 다르면 통째로 빠져나간다.
--
-- 오탐 방지: 서로 다른 셀러가 같은 브랜드를 각자 공구하는 건 정상이다(맘캘린더의 본질).
--   그 조건만 걸면 776쌍이 나온다(실측). 그래서 **두 신호를 모두** 요구한다.
--     ① 같은 상품·비슷한 날짜가 2회 이상 반복해서 겹친다 (우연이 아니다)
--     ② 셀러 이름이 닮았다 (앞 2글자 공통 또는 trigram 유사도 0.35+)
--   실측 결과 3쌍만 남았고 그중 2쌍이 진짜였다.
--   ⚠ 나머지 1쌍(아이러브유니 181213_hy ↔ 유니맘 sohyun_mood)은 **의도적으로 분리한 동명이인**이다.
--      경보가 떠도 자동 삭제하지 말고 반드시 눈으로 확인할 것.

create extension if not exists pg_trgm;

create or replace function public.data_health()
returns void language plpgsql security definer set search_path to 'public' as $function$
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
  select count(*) into n from gonggu
   where approved and coalesce(insta,'')='' and coalesce(pay_link,'') !~ '^https?://';
  if n > 0 then insert into health_alerts(kind, detail) values ('갈곳없는공구', n || '건'); end if;

  -- ⑨ 🔴 한 사람이 계정 2개 (2026-08-17 신설 — 벤시몽 도하맘↔도하상점 사고)
  --    핸들이 다르면 ⑥번이 못 잡는다. 이름이 닮은 + 반복 겹침 두 신호를 모두 요구해 오탐을 눌렀다.
  with n2 as (
    select id, influencer, insta, open_date,
           lower(regexp_replace(regexp_replace(name,'(u0026|u003c|u003e|[0-9]+차|초특가|특가|모음전|기획전|국산|신상|NEW|한정|공구|앵콜|재오픈)','','g'),'[[:space:]·._&/,!+()\[\]-]','','g')) nn
    from gonggu
    where open_date ~ '^\d{4}-\d{2}-\d{2}$' and name is not null and length(name) >= 3
      and coalesce(insta,'') <> '' and coalesce(influencer,'') <> ''
      and open_date >= to_char((now() at time zone 'Asia/Seoul')::date - 60, 'YYYY-MM-DD')
  ),
  p as (
    select a.insta ia, b.insta ib, min(a.influencer) na, min(b.influencer) nb, count(*) ovl
    from n2 a join n2 b
      on a.insta < b.insta
     and abs(a.open_date::date - b.open_date::date) <= 2
     and (a.nn = b.nn or (length(a.nn) >= 4 and length(b.nn) >= 4
          and (a.nn like '%'||b.nn||'%' or b.nn like '%'||a.nn||'%')))
    group by a.insta, b.insta
  )
  select count(*) into n from p
   where ovl >= 2
     and (left(na,2) = left(nb,2) or na like '%'||left(nb,2)||'%'
          or nb like '%'||left(na,2)||'%' or similarity(na, nb) >= 0.35);
  if n > 0 then
    insert into health_alerts(kind, detail)
    values ('한사람두계정', n || '쌍 — scratchpad/_q_dup_person.sql 로 확인. 동명이인 사례 있으니 자동삭제 금지');
  end if;
end $function$;
