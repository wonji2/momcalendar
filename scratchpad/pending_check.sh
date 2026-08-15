#!/bin/bash
# ⚠️ 승인표를 사장님께 보내기 전 반드시 실행할 것.
#   2026-08-04 사고: 승인표 298건 중 251건이 이미 DB에 있는 것이었다(대부분 그날 내가 먼저 등록).
#   사장님이 이미 등록된 걸 검토하느라 시간을 버렸다. 다시는 안 되게 이 스크립트로 먼저 거른다.
# 사용: bash scratchpad/pending_check.sh 승인대기_A.md [승인대기_B.md ...]
#   결과: 이미등록 / 신규 건수 + scratchpad/_chk_new.tsv 에 신규만 남김
cd "$(dirname "$0")/.."          # supabase link 는 프로젝트 루트에서만 동작
SB="C:/Users/FAMILY/supabase-cli/supabase.exe"
FILES=""; for a in "$@"; do FILES="$FILES scratchpad/$(basename "$a")"; done

awk -F'\t' '
BEGIN{sec="?"}
/^#{2,3} /{h=$0; sub(/^#+ +/,"",h); if(h !~ /^\(/) sec=h; next}
/^\| *# *\|/{line=$0; gsub(/^\| *| *\| *$/,"",line); nc0=split(line,H,/ *\| */);
  iN=0;iO=0;iE=0;iS=0;iH=0; delete iC; nc=0;
  for(i=1;i<=nc0;i++){ if(H[i]=="상품명")iN=i; else if(H[i]=="오픈")iO=i; else if(H[i]=="마감")iE=i;
    else if(H[i]=="핸들")iH=i; else if(H[i] ~ /셀러/)iS=i;
    else if(H[i]=="카테고리"||H[i]=="대분류"||H[i]=="소분류")iC[++nc]=i } next}
/^\| *[0-9]+ *\|/{ if(!iN) next; line=$0; gsub(/^\| *| *\| *$/,"",line); split(line,f,/ *\| */);
  cat=""; for(k=1;k<=nc;k++){v=f[iC[k]]; if(v!="")cat=(cat==""?v:cat" / "v)}
  if(f[iO]=="—" || cat ~ /파싱제외/) next;
  h=(iH?f[iH]:"");
  # 셀러별 표에서만 그룹헤더의 핸들을 쓴다. 공구줍줍처럼 셀러 칸이 따로 있는 표는 헤더 핸들을 쓰면 안 된다.
  if(h=="" && !iS && match(sec,/\(([A-Za-z0-9._]+)[,)]/,m)) h=m[1];
  op=f[iO]; if(op ~ /^[0-9]+\//){split(op,a,"/"); op=sprintf("2026-%02d-%02d",a[1],a[2])}
  printf "%s\t%s\t%s\t%s\n", (iS?f[iS]:""), f[iN], op, h }
' $FILES > scratchpad/_chk_rows.tsv
TOTAL=$(wc -l < scratchpad/_chk_rows.tsv)

{ echo "with v(seller,name,open_date,insta) as (values"
  awk -F'\t' '{gsub(/'"'"'/,"''"); printf "%s('"'"'%s'"'"','"'"'%s'"'"','"'"'%s'"'"','"'"'%s'"'"')\n", (NR>1?",":""), $1,$2,$3,$4}' scratchpad/_chk_rows.tsv
  cat <<'F'
),
r as (   -- 핸들이 비면 셀러 한글명으로 DB 에서 찾아 채운다
  select v.name, v.open_date, v.seller,
         coalesce(nullif(v.insta,''),
           (select g.insta from gonggu g where v.seller <> '' and g.influencer = v.seller and g.insta<>''
            group by g.insta order by count(*) desc limit 1)) as insta
  from v
),
n as (select r.*, lower(regexp_replace(regexp_replace(r.name,'([0-9]+차|초특가|특가|모음전|기획전|국산|신상|NEW|한정|공구)','','g'),'[[:space:]·._&/,!+()\[\]-]','','g')) nn from r),
j as (
  select n.*, exists (
    select 1 from gonggu g
    where g.insta = n.insta and g.open_date ~ '^\d{4}-\d{2}-\d{2}$'
      and abs(g.open_date::date - n.open_date::date) <= 3
      -- ⚠ 포함관계는 **양방향**을 봐야 한다. 한쪽만 보면
      --    기존 '미라클통' ↔ 신규 '미라클통 식재료 보관용기 2차' 를 놓친다(2026-08-11 실제로 놓쳐 중복 2건 등록).
      and (lower(regexp_replace(regexp_replace(g.name,'([0-9]+차|초특가|특가|모음전|기획전|국산|신상|NEW|한정|공구)','','g'),'[[:space:]·._&/,!+()\[\]-]','','g')) = n.nn
        or (length(n.nn)>=4 and lower(regexp_replace(regexp_replace(g.name,'([0-9]+차|초특가|특가|모음전|기획전|국산|신상|NEW|한정|공구)','','g'),'[[:space:]·._&/,!+()\[\]-]','','g')) like '%'||n.nn||'%')
        or (length(lower(regexp_replace(regexp_replace(g.name,'([0-9]+차|초특가|특가|모음전|기획전|국산|신상|NEW|한정|공구)','','g'),'[[:space:]·._&/,!+()\[\]-]','','g')))>=4
            and n.nn like '%'||lower(regexp_replace(regexp_replace(g.name,'([0-9]+차|초특가|특가|모음전|기획전|국산|신상|NEW|한정|공구)','','g'),'[[:space:]·._&/,!+()\[\]-]','','g'))||'%'))
  ) as dup from n
)
select count(*) filter (where insta is null) as no_handle,
       count(*) filter (where insta is not null and dup) as already_in_db,
       count(*) filter (where insta is not null and not dup) as is_new
from j;
F
} > scratchpad/_chk.sql
bash "$(dirname "$0")/excluded_check.sh"

echo "표 총 ${TOTAL}행"
"$SB" db query --linked -f scratchpad/_chk.sql 2>&1 | grep -oE '"(no_handle|already_in_db|is_new)": [0-9]*'
