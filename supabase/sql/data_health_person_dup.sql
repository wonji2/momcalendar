create extension if not exists fuzzystrmatch;
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

  -- ⑥ 같은 셀러·같은 날 중복
  --    🔴 2026-08-17 강화 — 붙여쓴 문자열 비교만으로는 **어순 변형·오타 변형**을 못 잡는다.
  --       실제로 8/15 등록분에서 관리자엔 중복 15쌍이 떴는데 이 검사는 0이었다.
  --       ('명란시대 저염명란' ↔ '저염명란 명란시대', '사회정서' ↔ '사화정서')
  --       → 관리자(admin relName)와 같이 ①핵심낱말 포함 ②낱말 70% 겹침 ③글자 80% 유사 를 함께 본다.
  with g as (
    select id, insta, open_date,
           lower(regexp_replace(regexp_replace(name,'([0-9]+차|초특가|특가|모음전|기획전|국산|신상|NEW|한정|공구|앵콜|재오픈)','','g'),'[[:space:]·._&/,!+()\[\]-]','','g')) nn,
           (select array_agg(t) from unnest(string_to_array(regexp_replace(lower(name),'([0-9]+\s*차|[()])',' ','g'), ' ')) t
             where t <> '' and t not in ('국산','신상','신상품','최신상','신제품','모음','모음전','골라담기','기획','기획전',
                                         '특가','세트','전제품','전상품','증정','한정','예약','앵콜','런칭','오픈','최저가','핫딜','외','및')) toks
    from gonggu where approved and open_date ~ '^\d{4}-\d{2}-\d{2}$'
      and open_date >= to_char((now() at time zone 'Asia/Seoul')::date - 30, 'YYYY-MM-DD')
  )
  select count(*) into n from g a join g b
    on a.insta=b.insta and a.open_date=b.open_date and a.id<b.id
   and (a.nn=b.nn
     or (length(a.nn)>=4 and b.nn like '%'||a.nn||'%')
     or (length(b.nn)>=4 and a.nn like '%'||b.nn||'%')
     or (a.toks is not null and b.toks is not null and (a.toks <@ b.toks or b.toks <@ a.toks))
     or (a.toks is not null and b.toks is not null and cardinality(a.toks)>0 and cardinality(b.toks)>0
         and (select count(*) from (select unnest(a.toks) intersect select unnest(b.toks)) i)::numeric
             / (select count(*) from (select unnest(a.toks) union select unnest(b.toks)) u) >= 0.7)
     -- ⚠ 한글 짧은 낱말은 trigram 이 못 잡는다(룰라맘↔룰루맘=0.25) → levenshtein 을 쓸 것
     or (length(a.nn) between 1 and 200 and length(b.nn) between 1 and 200
         and 1 - levenshtein(a.nn, b.nn)::numeric / greatest(length(a.nn), length(b.nn)) >= 0.80));
  if n > 0 then insert into health_alerts(kind, detail) values ('중복공구', n || '쌍 — 어순·오타 변형 포함'); end if;

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
  -- ⚡ 성능: 예전엔 like 양방향 포함관계로 조인해 O(n²) 가 되면서 함수 전체가 18초 걸렸다.
  --    **정규화 이름 완전일치**로만 조인하면 해시조인이 걸려 1초 아래로 떨어진다.
  --    꾸밈말(모음전·N차 등)은 이미 정규화에서 지우므로 '로보카폴리' ↔ '로보카 폴리 모음전' 은 여전히 일치한다.
  --    실측: 도하맘↔도하상점은 이 조건만으로도 3회 겹쳐 잡힌다.
  with n2 as (
    select id, influencer, insta, open_date::date od,
           lower(regexp_replace(regexp_replace(name,'(u0026|u003c|u003e|[0-9]+차|초특가|특가|모음전|기획전|국산|신상|NEW|한정|공구|앵콜|재오픈)','','g'),'[[:space:]·._&/,!+()\[\]-]','','g')) nn
    from gonggu
    where open_date ~ '^\d{4}-\d{2}-\d{2}$' and name is not null and length(name) >= 3
      and coalesce(insta,'') <> '' and coalesce(influencer,'') <> ''
      and open_date >= to_char((now() at time zone 'Asia/Seoul')::date - 60, 'YYYY-MM-DD')
  ),
  p as (
    select a.insta ia, b.insta ib, min(a.influencer) na, min(b.influencer) nb, count(*) ovl
    from n2 a join n2 b
      on a.nn = b.nn                      -- 해시조인 (인덱스 없이도 빠름)
     and a.insta < b.insta
     and abs(a.od - b.od) <= 2
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
