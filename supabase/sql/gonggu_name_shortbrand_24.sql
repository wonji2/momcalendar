-- 상품명 검증 트리거: 1글자 브랜드 예외 허용
-- 사장님 확인분만 화이트리스트에 넣는다. 방어 기능(카테고리명·1글자 오등록 차단)은 유지.
CREATE OR REPLACE FUNCTION public.check_gonggu_name()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  bad_names TEXT[] := ARRAY['생활용품','스킨케어','헤어케어','메이크업','바디케어',
    '주방가전','생활가전','청소가전','계절가전','영상가전','간편식/밀키트','건강식품',
    '패키지/투어','의류','키즈패션','액세서리','교구/교육','육아용품','주방용품',
    '침구/패브릭','유아식','장난감/놀이','신발','가방','스포츠웨어','테이블웨어',
    '홈인테리어','가구','잡화','기타','건강','신선식품','인테리어','반려동물',
    '육아','리빙','식품','뷰티','패션','가전','여행'];
  -- ✅ 실제로 존재하는 1글자 브랜드 (사장님 확인분만 추가할 것)
  ok_short  TEXT[] := ARRAY['띰'];
BEGIN
  IF NEW.name = ANY(bad_names)
     OR (length(NEW.name) <= 1 AND NOT (NEW.name = ANY(ok_short))) THEN
    RAISE EXCEPTION '유효하지 않은 상품명: %', NEW.name;
  END IF;
  RETURN NEW;
END;
$function$;
