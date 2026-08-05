-- ① 스태프에게 핫딜(hotdeals) 권한 부여 — 사장님 지시 2026-08-05 ("다 해")
--    공구(gonggu)는 그대로 관리자 전용. 체험단(staff_exp_27) + 핫딜까지가 스태프 범위다.
--    coupang_keywords · price_history 는 건드리지 않는다(수집 파이프라인이라 관리자만).
drop policy if exists hotdeals_admin_all on public.hotdeals;

create policy hotdeals_admin_all on public.hotdeals
  for all to authenticated
  using      (public.is_app_admin() or public.is_app_staff())
  with check (public.is_app_admin() or public.is_app_staff());


-- ② 네이버 상시 핫딜 링크 교체 — naver.me 단축주소는 안드로이드에서 "앱 선택" 창을 띄운다.
--    (사장님 지적 2026-08-05: "누르면 인터넷 종류 선택하라고 떠")
--    naver.me/51ucfPnE 가 실제로 가는 곳을 펼쳐서 그대로 넣는다. 제휴 추적은 brandconnect 링크에 들어 있다.
update public.hotdeals
   set link = 'https://brandconnect.naver.com/affiliates/929409083274624?channelProductNo=11578123323'
 where id = 42 and link like '%naver.me%';


-- ③ 상시 핫딜은 매일 "오늘"로 보이게 — 카드의 날짜 뱃지는 created_at 기준이라
--    수동 등록일(8/3)이 그대로 남아 "2일 전"으로 떴다. (사장님 지적 2026-08-05)
--    pin_random=true = 상시 노출용 이라는 뜻이므로 이 표식을 기준으로 매일 갱신한다.
create or replace function public.refresh_evergreen_hotdeals()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare n int;
begin
  update public.hotdeals
     set created_at = now(),
         deal_day   = (now() at time zone 'Asia/Seoul')::date
   where pin_random = true;
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.refresh_evergreen_hotdeals() from public, anon, authenticated;

-- 매일 08:10(KST) = 23:10(UTC). 쿠팡 수집 크론(23:00 UTC) 뒤에 돈다.
select cron.unschedule('hotdeal-evergreen')
  where exists (select 1 from cron.job where jobname='hotdeal-evergreen');

select cron.schedule('hotdeal-evergreen','10 23 * * *',
                     $$select public.refresh_evergreen_hotdeals()$$);

-- 지금 한 번 즉시 반영
select public.refresh_evergreen_hotdeals() as refreshed_now;
