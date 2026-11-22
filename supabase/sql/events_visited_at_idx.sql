-- events(visited_at) 인덱스 (2026-09-24, 사장님 지시) — 관리자 이벤트 대시보드가 기간 필터만으로 events 를 1,000행씩 넘기며
-- 매 쪽 전체 Seq Scan(1.6초, 53만 행) 하던 것. 기존 인덱스는 (event_type, visited_at) 뿐이라 event_type 없는 기간 조회엔 못 쓴다.
-- concurrently: 손님 기록(INSERT)을 막지 않고 만든다.
create index concurrently if not exists events_visited_at_idx on public.events (visited_at);
