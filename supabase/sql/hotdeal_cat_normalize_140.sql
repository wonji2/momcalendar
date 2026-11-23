-- 핫딜 분류 바로잡기 (사장님 2026-11-23 「뿌리까지 고쳐」)
--   수집기 여러 개가 사이트 필터(index.html CATS)에 없는 분류(디지털/가전 · 기획특가 · 숙박/레저 · 건강식품 …)를 넣어
--   어느 칩으로도 안 잡히는 핫딜이 생겼다. 어느 경로로 들어오든 여기서 CATS 안의 값으로 고쳐 받는다(막지 않는다).
--   CATS 가 바뀌면 hotdeal_cat_valid() 의 목록도 같이 바꾼다 — cat_guard.mjs(소분류필터이탈 경보)가 어긋남을 잡는다.
create or replace function public.hotdeal_cat_valid(mj text, mn text) returns boolean language sql immutable as $$
  select case mj
    when '육아' then mn = any(array['장난감/놀이','교구/교육','책','이유아식','의류잡화','목욕/세정','외출용품','방꾸미기','스킨로션','유모차카시트','육아용품'])
    when '리빙' then mn = any(array['생활용품','주방용품','침구/패브릭','청소/세제','욕실용품','테이블웨어','헬스케어'])
    when '식품' then mn = any(array['음료/차/즙','간식/구황작물','수산물/건해산','과일/야채','정육/계란','간편식/밀키트','유제품','장류/오일/소스','반찬','떡/베이커리','견과류','선물세트'])
    when '건강' then mn = any(array['유산균','비타민','오메가','철분제','키즈영양제','홍삼/면역','다이어트','건강기능성'])
    when '인테리어' then mn = any(array['가구','패브릭','조명','데코소품','수납정리','홈오피스'])
    when '가전' then mn = any(array['생활가전','주방가전','청소가전','계절가전','영상가전','취미/디지털기기','컴퓨터용품','헬스케어'])
    when '뷰티' then mn = any(array['스킨케어','메이크업','헤어케어','바디케어','구강케어','향수','뷰티디바이스'])
    when '패션' then mn = any(array['이너웨어','신발','가방','스포츠웨어','액세서리','의류','키즈'])
    when '여행' then mn = any(array['호텔/숙소','항공권','패키지/투어','체험/티켓','여행용품'])
    when '반려동물' then mn = any(array['강아지','고양이','사료','간식'])
    else false end
$$;

create or replace function public.hotdeal_cat_normalize() returns trigger language plpgsql as $$
declare mj text := coalesce(new.major,''); mn text := coalesce(new.minor,'');
begin
  if public.hotdeal_cat_valid(mj, mn) then return new; end if;
  -- ① 대분류 다른 이름
  mj := case mj when '디지털/가전' then '가전' when '디지털' then '가전' when '생필품' then '리빙' when '가구/인테리어' then '인테리어'
                when '화장품/미용' then '뷰티' when '패션의류' then '패션' when '패션잡화' then '패션' when '출산/육아' then '육아' else mj end;
  -- ② 소분류 다른 이름
  mn := case
    when mj='여행' and mn in ('숙박/레저','숙박') then '호텔/숙소'
    when mj='여행' and mn in ('테마파크','키즈체험','체험','티켓') then '체험/티켓'
    when mj='건강' and mn in ('건강식품','위생용품') then '건강기능성'
    when mj='뷰티' and mn = '화장품' then '스킨케어'
    when mj='리빙' and mn = '침구' then '침구/패브릭'
    when mj='리빙' and mn in ('세제·위생','세제') then '청소/세제'
    when mj='식품' and mn in ('가공식품','간편식') then '간편식/밀키트'
    when mj='식품' and mn = '음료' then '음료/차/즙'
    when mj='식품' and mn = '축산' then '정육/계란'
    when mj='식품' and mn = '과일' then '과일/야채'
    when mj='식품' and mn = '간식' then '간식/구황작물'
    when mj='육아' and mn = '이유식' then '이유아식'
    when mj='육아' and mn = '기저귀·물티슈' then '육아용품'
    when mj='패션' and mn = '잡화' then '액세서리'
    when mj='반려동물' and mn = '반려용품' then '강아지'
    else mn end;
  -- ③ 그래도 CATS 밖이면 그 대분류의 기본 소분류, 대분류도 모르면 리빙/생활용품
  if not public.hotdeal_cat_valid(mj, mn) then
    mn := case mj when '육아' then '육아용품' when '리빙' then '생활용품' when '식품' then '간편식/밀키트' when '건강' then '건강기능성'
                  when '인테리어' then '데코소품' when '가전' then '생활가전' when '뷰티' then '스킨케어' when '패션' then '의류'
                  when '여행' then '체험/티켓' when '반려동물' then '강아지' else null end;
    if mn is null then mj := '리빙'; mn := '생활용품'; end if;
  end if;
  new.major := mj; new.minor := mn;
  return new;
end $$;

drop trigger if exists hotdeals_cat_normalize on public.hotdeals;
create trigger hotdeals_cat_normalize before insert or update of major, minor on public.hotdeals
  for each row execute function public.hotdeal_cat_normalize();
