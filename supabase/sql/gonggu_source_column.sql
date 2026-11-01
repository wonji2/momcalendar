-- gonggu.source — 이 행이 어느 채널에서 왔는지 (사장님 지시 2026-09-21 "다적용해")
-- 왜: 캡션 채움률이 낮을 때 "인포크만 돌아서 낮은 것"인지 "수확 파일이 낡아서"인지 DB 로 가를 수 없었다.
-- nullable 이라 기존 행·트리거·조회에 영향 없다. 기존 2만여 행은 null 로 둔다(소급 채움 안 함).
alter table public.gonggu add column if not exists source text;
comment on column public.gonggu.source is
  '수확 채널: insta_feed | inpock | cafe | blog | jupjup | manual | vendor. 2026-09-21 신설, 이전 행은 null';
create index if not exists gonggu_source_idx on public.gonggu (source) where source is not null;
