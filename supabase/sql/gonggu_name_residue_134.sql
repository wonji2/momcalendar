-- gonggu_name_residue_134.sql (131 + ①-c 잔해·홍보 문구)
-- (원본 131) gonggu_name_nohype_131.sql — 상품명에서 「=」·「갓성비」·「인기대란」·「N차」를 뺀다 (사장님 지시 2026-11-02 "상품명엔 = 갓성비 3차 이런것도 빼")
--   gonggu_name_clean_87.sql 의 check_gonggu_name 에 ① 단계 뒤 한 줄을 더한 판. 어느 등록 경로든 DB 가 마지막에 뗀다.
--   · N차: 앞뒤가 공백/괄호/끝인 「3차」 「[8차]」 「(2차)」 만. 「3차원」처럼 낱말 안은 건드리지 않는다. 중복 판정(NORM)은 원래 N차를 떼고 비교하므로 영향 없음.
--   · 떼고 나서 2글자 미만이면 원래 이름을 둔다.
--   · 2026-11-02 기존 노출 행 722건은 한 번에 고쳤다(되돌리기: scratchpad/handoff-log/name_fix_2026-11-02.tsv).
-- 되돌리기: gonggu_name_clean_87.sql 을 다시 실행.
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
    -- ①-b 사장님 2026-11-02: 「=」·「갓성비」·「인기대란」·「N차」 제거
    n := regexp_replace(n, '(^|\s)[\[(]?[0-9]+\s*차[\])]?(?=\s|$)', '\1', 'g');
    n := regexp_replace(n, '갓\s*성비', '', 'g');
    n := regexp_replace(n, '인기\s*대란', '', 'g');
    n := regexp_replace(n, '(^|\s)[=＝]+(?=\s|$)', '\1', 'g');
    n := btrim(regexp_replace(n, '\s{2,}', ' ', 'g'));
    n := btrim(regexp_replace(n, '^[·\-–~,/]+|[·\-–~,/]+$', '', 'g'));
    -- ①-c 사장님 2026-11-04 「상품명 이상하게 긴 것들은 문장·오류」 — 인포크 블록 제목의 잔해·홍보 문구 제거(2026-11-04 노출 4,000여 건에 걸어 15건만 바뀜을 확인)
    --   「(~ 까지)」「( 10am)」「( ~08)」「(~ 수 · 용기 10개 더)」 같은 날짜 자리 잔해, 「: 까지만」, 홍보 낱말(공구특가·단독특가·최초공구·특별할인 - 브랜드·최대할인 N%·신제품 출시), 끝의 「~ (날짜지정 필수)」·「공구」·「할인중」
    n := regexp_replace(n, '\(\s*~[^)]*\)', '', 'g');
    n := regexp_replace(n, '\(\s*([0-9]+\s*(am|pm|AM|PM)?)?\s*\)', '', 'g');
    n := regexp_replace(n, '\s*:\s*까지만|\s~\s*까지', '', 'g');
    n := regexp_replace(n, '(^|\s)(공구특가|단독특가|최초공구|특별할인(\s*-\s*[A-Za-z가-힣]+)?|최대할인\s*[0-9]+%|신제품\s*출시)(?=\s|$)', '\1', 'g');
    n := regexp_replace(n, '\s+~?\s*\(날짜지정\s*필수\)\s*$', '');
    n := regexp_replace(n, '\s+(공구|할인중|특가)\s*$', '');
    n := btrim(regexp_replace(n, '\s{2,}', ' ', 'g'));
    -- 셀러 달력 캡션(insta_cal)은 「브랜드 상품 - 소개 문구」 꼴이라 소개 문구가 상품명에 붙는다 → 「 - 」 앞만(앞이 4글자 이상일 때). 2026-11-04 노출 14건 정리
    IF COALESCE(NEW.source, '') = 'insta_cal' AND position(' - ' in n) > 0 AND length(btrim(split_part(n, ' - ', 1))) >= 4 THEN
      n := btrim(split_part(n, ' - ', 1));
    END IF;
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
  -- (②-b 「21자 이상 자동 미승인」 은 11-04 사장님 「눈으로 보고 판단하라」 로 철회 — 긴 정상 이름이 많았다. 긴 이름은 정기 눈검수에서 본다)
  -- ③ 사장님 2026-11-02 「인스타 네임에 오피셜 들어간 공식 계정은 공구 아닐 확률이 대부분 · 빼는 쪽으로」 (비비엔다 오피셜 포함)
  --    새로 들어오는 행만 미승인으로 받는다(예외를 던지지 않는다 — 등록기 한 줄 때문에 회차가 멈추지 않게). 맘캘 본인(momcal_)은 제외.
  --    기존 노출 137행은 11-02 에 내렸다가 개인 셀러 5명(별난맘·풍기댁홈·릴리맘·lovemomomom·지엠마)은 같은 날 되살렸다(하봄 등 회사·브랜드는 그대로 제외).
  --     gonggu_hold 에 넣었다.
  IF TG_OP = 'INSERT' AND NEW.approved IS TRUE AND COALESCE(NEW.insta, '') ILIKE '%official%' AND COALESCE(NEW.insta, '') <> 'momcal_'
     AND NEW.insta NOT IN ('byulnanmam_official','2na2jun_mom.official','lillimom_official','lovemomomom_official','jiemma_official') THEN   -- 실제 공구하는 개인 셀러는 둔다(사장님 2026-11-02)
    NEW.approved := false;
  END IF;
  RETURN NEW;
END;
$function$;
