-- 오픈 시각 출처 칸을 손님 화면이 읽게 (사장님 2026-10-27 「10시 오픈합니다 9시 오픈 이렇게 정확히 써있는것만 올리면됨」)
--   화면은 open_time_src 가 caption·caption_ai(셀러 글에 「N시 오픈」 이 적힌 것)일 때만 시각을 띄운다
--   inpock(달력 칸 시작 시각 — 기본값일 수 있다)은 저장만 하고 화면엔 안 쓴다(충돌 판정·다시 보기용)
--   gonggu 는 칸 단위 grant(security_lockdown_66) — 칸을 새로 읽게 하려면 이 grant 가 있어야 한다
grant select (open_time_src) on public.gonggu to anon, authenticated;
