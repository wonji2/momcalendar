-- ✅ 2026-11-13 적용(앞 4줄은 11-13 오전, RLS 9개는 security_low_148.sql 로) — 사장님 「다해 막아놔」「덜급한거 먼저 고쳐」
-- 2026-11-08 권한 점검(사장님 「RLS 안 켜 두면 앱에 들어간 키만으로 데이터가 다 열려요 · 우리 적용 안 되게 설계됐는지」)
-- 점검 결과(130개 표): ① 손님 키(anon)로 읽히는 표 13개는 공개 데이터만 · 쓰기는 events·visits·visitors·inquiries 의 INSERT 만(집계·문의 접수용)
--   ② RLS 꺼진 표 9개는 anon·authenticated 권한 자체가 없어 API 로는 못 읽지만, 권한이 실수로 붙어도 안 열리게 RLS 를 켠다(정책 없음 = 전부 막힘, 서버·cron 은 영향 없음)
--   ③ 🔴 kw_push_targets_fcm / kw_push_targets_ios 는 「revoke from anon」 만 했고 PUBLIC 실행권은 남아 있어 손님 키로 호출됐다
--      (새 핫딜이 키워드에 맞는 90분 동안 기기 번호·푸시 토큰이 반환될 수 있었다) → PUBLIC 에서도 회수, service_role 만.
revoke execute on function public.kw_push_targets_fcm() from public, anon, authenticated;
revoke execute on function public.kw_push_targets_ios() from public, anon, authenticated;
grant execute on function public.kw_push_targets_fcm() to service_role;
grant execute on function public.kw_push_targets_ios() to service_role;

alter table public._tq_res enable row level security;
alter table public.events_daily enable row level security;
alter table public.gonggu_dup_lamour_20260928 enable row level security;
alter table public.gonggu_dupnorm2_backup_20260929 enable row level security;
alter table public.gonggu_dupnorm_backup_20260928 enable row level security;
alter table public.gonggu_hold enable row level security;
alter table public.visitors_daily enable row level security;
alter table public.visits_daily enable row level security;
alter table public.wish_counts_cache enable row level security;
notify pgrst, 'reload schema';
select count(*) filter (where not relrowsecurity) as rls_off_tables from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r';
