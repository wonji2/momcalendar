-- 🔤 별칭 한 말 → 여러 뜻 허용 + 「다른 브랜드」 제외를 검색 결과에도 적용 (사장님 지시 2026-09-21)
--   ① "아기김은 우아한김이랑 또또맘 공구 보여줘 또또맘에도 김 포함돼있네"
--      → bot_alias 의 PK 가 (term) 하나라 한 말에 뜻 하나만 넣을 수 있었다. (term, expand) 로 넓힌다.
--      kakao-skill 의 expand()·index.html 의 expandQuery() 는 **행마다 따로** 치환하므로
--      같은 term 의 행이 여러 개면 후보가 그만큼 늘어난다. 코드 변경 없이 동작한다.
--      ⚠ 구분자(| 등)로 한 칸에 두 뜻을 넣으면 안 된다 — 수식어 떼기·대표낱말 넓히기가 그 문자열을 통째로 먹는다.
--   ② "오이는 먹는 오이 말한거니까 오이만 찾아야지 오이코스는 다른 침구 브랜드야"
--      → bot_alias_deny 는 이미 「다른 브랜드」 짝을 담는 표다(아토팜≠아이팜·보르르≠보아르).
--        지금까지는 bot_learn 이 "다시 배우지 마라" 로만 읽었다. 이제 kakao-skill 이 **검색 결과 제외**로도 읽는다.
--        손님이 term 을 **그대로** 쳤을 때만, 상품명에 expand 가 든 행을 뺀다. (오이코스로 찾는 손님은 그대로 본다)
--
--   실측(2026-09-21, 진행중 1,633건): "오이" 3건 → 전부 제외(오이코스 베개커버·오이스터 2건) → "없어요"
--                                    "오이스터" 2건·"오이코스" 1건·"아이팜" 3건은 그대로.
--                                    "아기김" → 우아한김 4건 + 또또맘 1건 = 5건.

-- ① PK 넓히기
alter table public.bot_alias drop constraint if exists bot_alias_pkey;
alter table public.bot_alias add  constraint bot_alias_pkey primary key (term, expand);
-- ⚠ tools/daily/bot_learn.mjs 의 `on conflict (term)` 은 같은 날 `on conflict` 로 고쳤다.
--   자동학습은 L68 의 known 집합으로 **이미 있는 말은 건너뛰므로** 한 말에 뜻 하나를 유지한다.
--   여러 뜻은 사람(사장님)이 판정한 것만 들어간다.

-- ② 아기김 → 우아한김 · 또또맘
insert into public.bot_alias(term, expand) values
  ('아기김', '우아한김'),
  ('아기김', '또또맘')
on conflict do nothing;

-- ③ 오이(먹는 것) 검색에서 다른 브랜드 빼기
insert into public.bot_alias_deny(term, expand, note) values
  ('오이', '오이코스', '오이코스는 침구 브랜드 — 먹는 오이와 다르다 (사장님 2026-09-21)'),
  ('오이', '오이스터', '오이스터(에델바이스 식기라인)는 먹는 오이와 다르다 (사장님 2026-09-21)')
on conflict do nothing;

-- ④ 🔴 deny 표는 RLS 만 켜 있고 **읽기 정책이 없어 손님 키로는 빈 배열**이었다(실측 2026-09-21).
--    kakao-skill 의 q() 는 anon 키를 쓴다 → 정책을 안 열면 제외가 조용히 아무것도 안 한다.
drop policy if exists bot_alias_deny_read on public.bot_alias_deny;
create policy bot_alias_deny_read on public.bot_alias_deny for select using (true);   -- 읽기만 공개(챗봇용). 쓰기는 CLI/관리자만.
