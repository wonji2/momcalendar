-- 통합 지표 시드 — 키 등록 전에도 화면이 비지 않게 사람이 콘솔에서 본 값을 넣는다(화면엔 「수동 · 기준일」 칩) (2026-11-23)
insert into public.analytics_manual(id, as_of, payload) values
 ('play_console', '2026-11-23', '{"window":"28d","device_installs":818,"retained_installs":785,"first_open":431,
   "first_open_rate":52.7,"mau":689,"store_cvr":90.99,"review_count":0,
   "source":"플레이 콘솔 직접 확인(자비스 2026-11-23)","note":"벌크 CSV 자동수집 전까지 이 값을 쓴다"}'::jsonb),
 ('app_store', '2026-11-23', '{"chart_rank":194,"chart":"쇼핑","source":"App Store 차트 직접 확인(2026-11-23)",
   "note":"iTunes RSS 는 100위까지만 준다 — 194위는 RSS 로 확인 불가"}'::jsonb),
 ('seed_web', '2026-11-22', '{"window":"7d(11/15~21)","total_users":19000,"active_users":17000,"views":42000,
   "naver_mobile":7200,"chatgpt":624,"source":"11-22 아침 브리핑 GA4 화면"}'::jsonb)
on conflict (id) do update set as_of=excluded.as_of, payload=excluded.payload, updated_at=now();
