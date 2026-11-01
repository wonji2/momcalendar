-- 데이터 건강 자동감시 (사장님 지시 2026-08-12)
-- "매일같이 오류나오면 바로 시정하고 오류 계속 찾는거 돌려야되는거 규칙으로 넣었어?"
-- → 사람이 안 돌려도 서버가 매일 검사해서 이상을 health_alerts 에 남긴다.
--   세션 시작 때 이 테이블부터 본다(고정 규칙 0-B).

create table if not exists public.health_alerts (
  id bigint generated always as identity primary key,
  kind text not null,
  detail text,
  created_at timestamptz not null default now()
);
alter table public.health_alerts enable row level security;  -- 정책 없음 = service_role 만

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
end $$;

revoke all on function public.data_health() from public, anon, authenticated;

-- 매일 한국 06:10 (로그인·사이트 감시와 같은 계열, 아침에 세션 시작하면 바로 보임)
select cron.schedule('data-health', '10 21 * * *', 'select public.data_health()');
