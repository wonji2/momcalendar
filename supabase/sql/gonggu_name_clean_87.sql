-- gonggu_name_clean_87.sql — 상품명 위생을 DB 트리거에서 건다 (사장님 지시 2026-10-13
--   "이 카드만 고치지 말고 전체 상품명 이런 거 하나도 없게 똑바로 db에서 적용되도록 고쳐 놔")
--
-- 왜: 「세이펜 되었습니다 .ᐟ」「라꽁비에뜨 입니댜아아」「이지앤프리 ㅣ」 가 카드까지 나갔다.
--     등록 경로가 여럿(피드·인포크·공구톡톡·집계·관리자 붙여넣기)이라 스크립트 게이트만으로는 샌다.
--     어느 경로로 들어오든 **DB 가 마지막에 한 번 더** 본다. 기존 check_gonggu_name(분류명·1글자 차단)에 얹는다.
--
-- 하는 일 (INSERT · name 이 바뀌는 UPDATE)
--   ① 고친다(버리지 않는다) — 모든 행에(cat_manual·momcal_ 포함. 기호만 떼므로 뜻이 안 바뀐다):
--      머리·꼬리의 글머리표 / 가운데 글머리표 •∙● → · / 꼬리의 장식기호·이모지·느낌표·물음표 /
--      꼬리에 홀로 남은 한글 자모·세로줄(「이지앤프리 ㅣ」)·붙은 자모 2개 이상(「ㅎㅎ」)
--      ⚠ 꼬리 마침표·물결·쉼표는 **앞에 공백이 있거나 2개 이상일 때만** 뗀다 — 「Dr.」「A.P.C.」「130~」 는 이름의 일부다(검증자 실측).
--      ⚠ 세 번 되풀이한다 — 「세이펜 . ㅣ」처럼 기호 뒤에 자모가 있으면 한 번으로는 마침표가 되살아난다. 결합 이모지(ZWJ·FE0F)도 같은 이유.
--   ② INSERT 인데 고친 뒤에도 문장이면 approved=false 로 받는다(손님에게 안 나간다). 예외를 던지지 않는 이유:
--      등록기가 여러 줄을 한 번에 넣어서, 한 줄 때문에 예외가 나면 멀쩡한 199줄이 같이 날아간다.
--      사람이 고쳐서 승인하는 길(UPDATE)은 막지 않는다. cat_manual·맘캘 본인 공구(momcal_)는 ②를 안 탄다.
--   ⚠ ②는 **일부러 좁다** — 「봄이 왔어요」「문이 열렸어요」 같은 책 제목이 조용히 미노출되면 안 된다(검증자 지적).
--      합쇼체 줄기(…입니/합니/됩니/되었습/했습/오픈합)만 본다. 넓은 판정은 등록 전 게이트(tools/daily/drop_badname.mjs)와
--      매일 도는 live_audit 이 맡는다 — 거긴 사람이 볼 보류 파일이 남는다.
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
  i INT;
BEGIN
  -- ① 고친다 — 새로 들어오거나 이름이 바뀔 때만
  IF NEW.name IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.name IS DISTINCT FROM OLD.name) THEN
    n := NEW.name;
    n := regexp_replace(n, '^[\s•∙●·]+', '');
    n := regexp_replace(n, '\s*[•∙●]\s*', '·', 'g');
    FOR i IN 1..3 LOOP
      n := regexp_replace(n, '[\s!！?？…•∙●ʰ-˿᐀-ᙿꯀ-꯿ᰀ-ᱏ​-‏⃐-⃿☀-➿⬀-⯿︀-️\U00010000-\U0010FFFF]+$', '');
      n := regexp_replace(n, '(\s+[.~,·]+|[.~,·]{2,})$', '');
      n := regexp_replace(n, '(\s+[ㄱ-ㅎㅏ-ㅣ|│]+|[ㄱ-ㅎㅏ-ㅣ]{2,})$', '');
    END LOOP;
    n := btrim(regexp_replace(n, '\s{2,}', ' ', 'g'));
    IF length(n) >= 2 THEN NEW.name := n; END IF;
  END IF;

  IF NEW.name = ANY(bad_names)
     OR (length(NEW.name) <= 1 AND NOT (NEW.name = ANY(ok_short))) THEN
    RAISE EXCEPTION '유효하지 않은 상품명: %', NEW.name;
  END IF;

  -- ② 문장이 상품명으로 들어온 것 — 받되 손님에게 내보내지 않는다 (좁게: 합쇼체 줄기만)
  IF TG_OP = 'INSERT' AND NEW.approved IS TRUE
     AND COALESCE(NEW.cat_manual, false) = false AND COALESCE(NEW.insta, '') <> 'momcal_'
     AND NEW.name ~ '(입니다|합니다|됩니다|되었습니다|됐습니다|했습니다|왔습니다|입니댜|합니당|오픈합니|오픈했습|시작합니|시작했습)' THEN
    NEW.approved := false;
  END IF;
  RETURN NEW;
END;
$function$;
