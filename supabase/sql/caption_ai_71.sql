-- 캡션 AI 판독 캐시 (2026-10-01) — 사장님 지시 "공구팡팡처럼 실시간으로 깔끔하게 상품명만 뽑아서 가져와봐"
--
-- 왜 표가 필요한가: AI 에 쓴 돈은 **학습으로 쌓여야 한다**(메모리 ai-spend-must-accumulate).
--   같은 캡션을 두 번 읽으면 두 번 돈이 든다. 같은 훅 문장은 셀러를 넘어 반복된다.
--   그리고 「공구 아님」도 배운 답이다 — 다음 회차에 다시 묻지 않는다.
--   한 주 뒤 이 표에서 **AI 가 뽑았는데 우리 정규식이 못 뽑은 상품명**을 캐내면
--   그게 브랜드 사전이 된다(= 규칙을 느슨하게 하지 않고 구멍을 막는 길).
create table if not exists caption_ai (
  cap_sha     text primary key,          -- 캡션 본문 sha256 (앞 600자)
  insta       text,
  is_gonggu   boolean not null,
  product     text,                      -- 캡션에 적힌 표기 그대로
  date_text   text,                      -- AI 가 계산하지 않는다. 셀러가 쓴 문자열 그대로 ("10/1 ~ 10/4")
  note        text,
  model       text,
  in_tok      int,
  out_tok     int,
  created_at  timestamptz default now()
);
create index if not exists caption_ai_insta_idx on caption_ai (insta);
create index if not exists caption_ai_created_idx on caption_ai (created_at desc);

-- 손님이 읽을 표가 아니다 → anon 에 grant 하지 않는다 (메모리 supabase-security-baseline).
-- Edge Function 은 service_role 로 붙으므로 RLS 를 켜도 통과한다.
alter table caption_ai enable row level security;

-- 비용 누적 조회용
create or replace function caption_ai_spend(days int default 30)
returns table(day date, calls bigint, in_tok bigint, out_tok bigint, usd numeric)
language sql stable as $$
  select (created_at at time zone 'Asia/Seoul')::date as day,
         count(*), sum(in_tok), sum(out_tok),
         round((sum(in_tok)/1e6*1.0 + sum(out_tok)/1e6*5.0)::numeric, 4) as usd
    from caption_ai
   where created_at > now() - (days || ' days')::interval
   group by 1 order by 1 desc;
$$;

-- 2026-09-28 보안 잠금으로 postgres 기본 권한이 회수됐다 → 명시 grant 가 없으면 Edge Function 도 404 를 받는다
-- (메모리 supabase-security-baseline). 손님(anon)에겐 주지 않는다.
grant select, insert, update on table caption_ai to service_role;
grant execute on function caption_ai_spend(int) to service_role;
