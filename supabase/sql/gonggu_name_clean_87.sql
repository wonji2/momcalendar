-- gonggu_name_clean_87.sql — 상품명 위생을 DB 트리거에서 건다 (사장님 지시 2026-10-13
--   "이 카드만 고치지 말고 전체 상품명 이런 거 하나도 없게 똑바로 db에서 적용되도록 고쳐 놔")
--
-- 왜: 「세이펜 되었습니다 .ᐟ」「라꽁비에뜨 입니댜아아」「이지앤프리 ㅣ」 가 카드까지 나갔다.
--     등록 경로가 여럿(피드·인포크·공구톡톡·집계·관리자 붙여넣기)이라 스크립트 게이트만으로는 샌다.
--     어느 경로로 들어오든 **DB 가 마지막에 한 번 더** 본다. 기존 check_gonggu_name(분류명·1글자 차단)에 얹는다.
--
-- 하는 일 (INSERT · name 이 바뀌는 UPDATE)
--   ① 고친다(버리지 않는다): 글머리표 •∙● → · / 꼬리의 장식기호·이모지·마침표류 / 꼬리에 홀로 남은 한글 자모·세로줄(「이지앤프리 ㅣ」)
--   ② INSERT 인데 고친 뒤에도 문장이면 approved=false 로 받는다(손님에게 안 나간다). 예외를 던지지 않는 이유:
--      등록기가 여러 줄을 한 번에 넣어서, 한 줄 때문에 예외가 나면 멀쩡한 199줄이 같이 날아간다.
--      사람이 고쳐서 승인하는 길(UPDATE)은 막지 않는다. cat_manual·맘캘 본인 공구(momcal_)는 손대지 않는다.
--   ⚠ 문장 판정은 좁게 — tools/daily/drop_badname.mjs 의 「문장형3」과 같은 식. 라이브 14,079행에 걸어 정상 이름 희생 0 을 확인한 것만 넣었다.
--      넓은 어미 규칙(…요/…다)은 「대발이 만나요배워요」 같은 책 제목을 죽여서 여기엔 안 넣는다.
-- 되돌리기: supabase/sql/gonggu_name_shortbrand_24.sql 을 다시 실행하면 옛 함수로 돌아간다.

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
  n TEXT;
BEGIN
  -- ① 고친다 — 새로 들어오거나 이름이 바뀔 때만
  IF NEW.name IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.name IS DISTINCT FROM OLD.name) THEN
    n := NEW.name;
    n := regexp_replace(n, '\s*[•∙●]\s*', '·', 'g');
    n := regexp_replace(n, '[\s.!~,·᐀-ᙿꯀ-꯿ᰀ-ᱏ☀-➿\U00010000-\U0010FFFF]+$', '');
    n := regexp_replace(n, '\s+[ㄱ-ㅎㅏ-ㅣ|│]+$', '');
    n := btrim(regexp_replace(n, '\s{2,}', ' ', 'g'));
    IF length(n) >= 2 THEN NEW.name := n; END IF;
  END IF;

  IF NEW.name = ANY(bad_names)
     OR (length(NEW.name) <= 1 AND NOT (NEW.name = ANY(ok_short))) THEN
    RAISE EXCEPTION '유효하지 않은 상품명: %', NEW.name;
  END IF;

  -- ② 문장이 상품명으로 들어온 것 — 받되 손님에게 내보내지 않는다
  IF TG_OP = 'INSERT' AND NEW.approved IS TRUE
     AND COALESCE(NEW.cat_manual, false) = false AND COALESCE(NEW.insta, '') <> 'momcal_'
     -- ⚠ 「…습니다$」 꼴 끝말 검사는 넣지 않는다 — 책 제목 「사춘기 아이와 대화하는 법은 따로 있습니다」가 걸린다(적용 전 실측).
     AND NEW.name ~ '\s(입니|합니|됩니|옵니|왔어|왔습|되었|됐어|됐습|했어|했습|오픈합|오픈했|시작합|시작했|열렸|엽니다|드립니다|드려요)' THEN
    NEW.approved := false;
  END IF;
  RETURN NEW;
END;
$function$;
