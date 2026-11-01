-- 공구 월령(추천 개월 범위) — B안: 별도 표 (2026-10-24 사장님 「월령 db b안으로 모으고 그 부분은 차용해」)
--   참고: 공구베이비(09baby) = 제품마다 추천 월령 범위 + 개월→단계 표(0~3 신생아·수유기 / 4~5 이유식 준비기 / 6~8 이유식 중기 / 9~11 이유식 후기 / 12~23 유아식 시기 / 24+ 유아기)
--   우리 방식(비용 0, 유료 AI 금지): ① 소분류(minor) 기본 범위 → ② 같은 소분류 안에서 품목 낱말이 좁힌다(규칙 표 age_rules). 이름 낱말 하나로 다른 소분류를 넘나들지 않는다.
--   맞는 규칙이 없으면 비워 둔다(억지로 안 채운다). 사람이 고친 값(src='manual')은 자동 갱신이 덮지 않는다.
--   gonggu 표는 건드리지 않는다(등록 경로 무관). 손님·앱이 읽으므로 anon select 를 명시한다(보안 기준선 — 기본 권한 회수됨).
--   ⚠ 「추천 월령」은 참고용이다. 화면에 쓸 때는 「참고용」을 같이 적는다.

create table if not exists public.age_rules (
  id         serial primary key,
  minor      text     not null,             -- gonggu.minor 와 같은 값
  pattern    text,                          -- 상품명 정규식(~*). null = 그 소분류 기본 범위
  month_min  smallint not null,
  month_max  smallint,                      -- null = 상한 없음
  prenatal   boolean  not null default false, -- 임신·출산 준비물에도 해당
  priority   smallint not null default 50,  -- 작을수록 먼저. 기본 범위는 90
  note       text
);

create table if not exists public.gonggu_age (
  gonggu_id  bigint primary key references public.gonggu(id) on delete cascade,
  month_min  smallint not null,
  month_max  smallint,
  prenatal   boolean  not null default false,
  src        text     not null default 'rule',   -- rule | manual
  rule_id    int,
  updated_at timestamptz not null default now()
);

alter table public.age_rules  enable row level security;
alter table public.gonggu_age enable row level security;
drop policy if exists age_rules_read  on public.age_rules;
drop policy if exists gonggu_age_read on public.gonggu_age;
create policy age_rules_read  on public.age_rules  for select using (true);
create policy gonggu_age_read on public.gonggu_age for select using (true);
grant select on public.age_rules, public.gonggu_age to anon, authenticated;

-- 개월 → 단계 (공구베이비 표와 같은 경계)
create or replace function public.age_stage(m int) returns text language sql immutable as $$
  select case when m is null then null
              when m < 4  then '신생아·수유기'
              when m < 6  then '이유식 준비기'
              when m < 9  then '이유식 중기'
              when m < 12 then '이유식 후기'
              when m < 24 then '유아식 시기'
              else '유아기' end
$$;
grant execute on function public.age_stage(int) to anon, authenticated;

-- 규칙 (처음 판). 고칠 때는 이 표만 바꾸면 다음 새벽 갱신에 반영된다
delete from public.age_rules;
insert into public.age_rules (minor, pattern, month_min, month_max, prenatal, priority, note) values
 -- 이유아식
 ('이유아식', '분유', 0, 24, true, 10, '분유·분유포트'),
 ('이유아식', '이유식\s*(포트|마스터|메이커|용품)|스타트킷|이유식기|흡착|빨대컵|(^|[\s,/&+])(스푼|숟가락|포크|젓가락)|식판|식기|턱받이', 5, 36, false, 20, '이유식 용품(스푼·포크는 낱말 머리만 — 리틀스푼·스푼타임 브랜드 제외)'),
 ('이유아식', '미음|초기\s*이유식', 5, 8, false, 25, '초기 이유식'),
 ('이유아식', '퓨레|떡뻥|뻥|쌀과자|큐브|이유식|채수', 6, 24, false, 30, '이유식·아기 간식'),
 ('이유아식', '유아식|유아\s*간식|원물간식|간식|오트밀|키즈|어린이|빵', 12, 72, false, 40, '유아식·간식'),
 ('이유아식', null, 6, 36, false, 90, '기본'),
 -- 장난감/놀이
 ('장난감/놀이', '모빌|딸랑이|아기\s*체육관|체육관|초점|치발기|헝겊', 0, 12, false, 10, '신생아 놀이'),
 ('장난감/놀이', '쏘서|점퍼루|보행기|걸음마', 4, 18, false, 20, '보행기류'),
 ('장난감/놀이', '붕붕카|번지카|트라이크|유아\s*바이크|밸런스\s*바이크|킥보드|웨건|자전거', 12, 72, false, 30, '타는 것'),
 ('장난감/놀이', '3D\s*펜|아트앤크래프트|클레이|피규어|레고(?!\s*듀플로)', 36, 120, false, 30, '만들기·피규어'),
 ('장난감/놀이', '듀플로|블럭|블록|자석|레일', 18, 72, false, 40, '블록'),
 ('장난감/놀이', '트램폴린', 24, 96, false, 40, ''),
 ('장난감/놀이', null, 6, 72, false, 90, '기본'),
 -- 책
 ('책', '초점|헝겊|촉감|보드북|돌잡이|베베|사운드북|까꿍|베이비', 0, 36, false, 10, '아기 책'),
 ('책', '추피', 12, 60, false, 20, ''),
 ('책', '영어|노부영|파닉스|리더스', 24, 96, false, 30, '영어책'),
 ('책', '초등|학년|학습지|하루\s*한\s*장', 84, 156, false, 5, '초등 학습'),
 ('책', '어휘|챕터|명작|수학|과학|경제|모험', 36, 120, false, 40, '유아·초등 책(전집은 아기 전집도 있어 뺌)'),
 ('책', null, 12, 96, false, 90, '기본'),
 -- 교구/교육
 ('교구/교육', '중학교|중등', 144, 192, false, 5, ''),
 ('교구/교육', '초등', 84, 156, false, 6, ''),
 ('교구/교육', '토들러|돌\s*(아기|선물|잡이)|돌아기|사운드\s*벽보|벽보|차트|꼭지\s*퍼즐|비지북|포스터', 12, 48, false, 10, '아기 교구(돌은 돌아기·돌잡이 꼴만)'),
 ('교구/교육', '세이펜|세이톡|와우펜|파닉스|영어|한글|심플송', 24, 96, false, 20, '펜·언어'),
 ('교구/교육', null, 18, 96, false, 90, '기본'),
 -- 육아용품 (기본 범위 없음 — 낱말이 맞을 때만)
 ('육아용품', '젖병|쪽쪽이|노리개|공갈|수유|유축', 0, 24, true, 10, '수유'),
 ('육아용품', '치발기|이앓이', 3, 18, false, 15, ''),
 ('육아용품', '바운서|스윙|흔들', 0, 12, false, 15, ''),
 ('육아용품', '기저귀\s*(가방|패드)', 0, 48, true, 18, ''),
 ('육아용품', '통잠\s*팬티|팬티형\s*기저귀|기저귀\s*팬티|기저귀', 0, 36, true, 12, '기저귀(팬티형 포함)'),
 ('육아용품', '변기|배변|훈련\s*팬티|학습\s*팬티', 18, 48, false, 20, '배변 훈련(팬티 단독은 안 씀)'),
 ('육아용품', '러닝\s*타워', 18, 72, false, 25, ''),
 ('육아용품', '하이체어|부스터', 6, 60, false, 25, ''),
 ('육아용품', '식판|(^|[\s,/&+])(스푼|포크|숟가락)|빨대컵|흡착|이유식', 6, 48, false, 30, '식사'),
 ('육아용품', '안전문|모서리|계단\s*(가드|문)|안전\s*(가드|문|매트|잠금|캡|게이트)', 6, 48, false, 30, '안전(「안전 인증」「안전 자동문」 같은 말은 제외)'),
 ('육아용품', '콧물\s*흡입기|네뷸라이저|네불라이저|체온계', 0, 72, false, 30, '건강'),
 ('육아용품', '아기띠|힙시트', 0, 36, true, 30, ''),
 ('육아용품', '네임\s*(스티커|테이프|스탬프)', 24, 96, false, 35, '어린이집 준비'),
 -- 의류잡화 (기본 범위 없음)
 ('의류잡화', '배냇|우주복|바디\s*슈트|속싸개|스카프\s*빕|턱받이', 0, 18, true, 10, ''),
 ('의류잡화', '걸음마\s*신발', 9, 24, false, 15, ''),
 -- 유모차카시트
 ('유모차카시트', '카시트\s*(커버|트레이|발판)|카미러|후방\s*거울', 12, 144, false, 10, '카시트 용품'),
 ('유모차카시트', '부스터', 36, 144, false, 15, ''),
 ('유모차카시트', '힙시트|아기띠', 3, 36, true, 15, ''),
 ('유모차카시트', '타는\s*캐리어|트라이크', 12, 72, false, 15, ''),
 ('유모차카시트', '유모차|유모카', 0, 48, true, 20, ''),
 ('유모차카시트', '카시트', 0, 144, true, 30, ''),
 -- 스킨로션 (아기용 표기만)
 ('스킨로션', '아기|베이비|유아|키즈|퓨토', 0, 72, false, 20, '');

-- 갱신: 진행·예정 + 최근 30일 마감 공구에 규칙을 건다. 소분류가 같고 낱말이 맞는 규칙 중 priority 가 가장 작은 것(같으면 범위가 좁은 것)
create or replace function public.gonggu_age_refresh() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  with cand as (
    select g.id, r.id as rid, r.month_min, r.month_max, r.prenatal,
           row_number() over (partition by g.id order by r.priority, coalesce(r.month_max, 999) - r.month_min, r.id) as rn
    from public.gonggu g
    join public.age_rules r on r.minor = g.minor and (r.pattern is null or g.name ~* r.pattern)
    where g.approved
      and g.end_date >= to_char((now() at time zone 'Asia/Seoul')::date - 30, 'YYYY-MM-DD')
  )
  insert into public.gonggu_age (gonggu_id, month_min, month_max, prenatal, src, rule_id, updated_at)
  select id, month_min, month_max, prenatal, 'rule', rid, now() from cand where rn = 1
  on conflict (gonggu_id) do update
    set month_min = excluded.month_min, month_max = excluded.month_max, prenatal = excluded.prenatal,
        rule_id = excluded.rule_id, updated_at = now()
    where public.gonggu_age.src <> 'manual'
      and (public.gonggu_age.month_min, public.gonggu_age.month_max, public.gonggu_age.prenatal, public.gonggu_age.rule_id)
          is distinct from (excluded.month_min, excluded.month_max, excluded.prenatal, excluded.rule_id);
  get diagnostics n = row_count;
  -- 규칙이 더는 안 맞는 자동 행은 지운다(규칙을 고쳤을 때). 사람이 넣은 것은 둔다
  delete from public.gonggu_age a
   where a.src = 'rule'
     and not exists (select 1 from public.gonggu g join public.age_rules r on r.minor = g.minor and (r.pattern is null or g.name ~* r.pattern)
                      where g.id = a.gonggu_id and g.approved);
  return n;
end $$;
revoke all on function public.gonggu_age_refresh() from public, anon, authenticated;

select public.gonggu_age_refresh();

-- 매일 KST 05:25 (UTC 20:25) — 새벽 등록분까지 채운다
select cron.unschedule('gonggu-age-refresh') where exists (select 1 from cron.job where jobname = 'gonggu-age-refresh');
select cron.schedule('gonggu-age-refresh', '25 20 * * *', $$select public.gonggu_age_refresh()$$);
