-- 상시 공구 표시 (사장님 2026-10-24 "상시 공구인것들은 맘캘공구에서 기간 상시라고 나오게 띄워두고 얘네는 위젯에서는 빼야할듯
--   매일 똑같은게 뜨면 안되니까 기간 정함이 잇는 것들만 오늘오픈 진행중 마감 타셀러와 똑같은 규칙 지켜서 위젯엔 떠야할듯")
-- always=true → 사이트 카드 기간 자리에 「상시」, 오늘오픈·오늘마감으로 세지 않는다 / widget_feed 에서 뺀다.
-- end_date 는 그대로 둔다(사이트 조회 조건 end_date>=오늘 에 걸려야 보이므로). 판매를 끝내면 end_date 를 당기거나 approved=false.
alter table public.gonggu add column if not exists always boolean not null default false;
update public.gonggu set always = true
 where insta = 'momcal_' and id in (23104, 17413, 31018, 17412, 29791)   -- 우리별피자·유니케어 얼룩제거제·라꽁비에뜨 버터·바겐슈타이거 스텐박스·정품 호주UGG 어그
   and always = false;
notify pgrst, 'reload schema';
-- 손님(anon)은 gonggu 를 열 단위 권한으로 읽는다(customer_views_67) → 새 열도 따로 연다
grant select (always) on public.gonggu to anon;
notify pgrst, 'reload schema';
