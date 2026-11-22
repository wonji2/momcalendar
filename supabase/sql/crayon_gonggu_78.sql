-- 크레용맘(이웃셀러) 인포크 「⬇️공구 진행중⬇️」 → 공구 카드 (사장님 지시 2026-10-01 "크레용맘 인포크보고 이웃셀러 배너 2구좌 올려주라고 카드랑")
--
-- ⚠ 크레용맘 인포크 공개 응답에는 **날짜가 아예 없다**(블록 키가 id·block_type·title·is_open·is_fixation 뿐).
--    그래서 수확기(inpock_harvest)가 0건을 뱉는다 — 도구 고장이 아니라 원본에 날짜가 없는 것이다.
--    인포크에 「공구 진행중」으로 걸려 있으니 **오늘부터 진행 중**으로 보고, 마감은 이웃셀러 계약 종료일(10/31)에 맞춘다.
-- ⚠ 「ALO 병행수입 정품 공구」·「의류 공구상품 모아보기」는 상품명이 불명확해 넣지 않는다(규칙: 명확한 것만).
-- 분류는 DB 전례를 따랐다 — 리라그루브=육아/교구·교육 · 자석블럭=육아/장난감·놀이.
-- 판매링크는 배너와 같은 정책으로 **인포크 메인**으로 보낸다(사장님 지시: 인스타를 거치지 않는다).

insert into gonggu (name, influencer, insta, major, minor, open_date, end_date, pay_link, approved, cat_manual, source)
select v.* from (values
  ('리라그루브 연필잡기 훈련', '크레용맘', 'pyjaehasip', '육아', '교구/교육',      '2026-10-01', '2026-10-31', 'https://link.inpock.co.kr/chaya', true, true, 'inpock'),
  ('팀브레인즈 리슨앤매치 잉글리시 러닝패드', '크레용맘', 'pyjaehasip', '육아', '교구/교육', '2026-10-01', '2026-10-31', 'https://link.inpock.co.kr/chaya', true, true, 'inpock'),
  ('핑크퐁 스트로우 젤리', '크레용맘', 'pyjaehasip', '식품', '간식/구황작물',      '2026-10-01', '2026-10-31', 'https://link.inpock.co.kr/chaya', true, true, 'inpock'),
  ('핸드 파닉스 자석블럭', '크레용맘', 'pyjaehasip', '육아', '장난감/놀이',        '2026-10-01', '2026-10-31', 'https://link.inpock.co.kr/chaya', true, true, 'inpock'),
  ('바디판타지 퍼퓸 바디미스트', '크레용맘', 'pyjaehasip', '뷰티', '바디케어',      '2026-10-01', '2026-10-31', 'https://link.inpock.co.kr/chaya', true, true, 'inpock')
) v(name, influencer, insta, major, minor, open_date, end_date, pay_link, approved, cat_manual, source)
where not exists (
  select 1 from gonggu g where g.insta = 'pyjaehasip' and g.name = v.name
    and g.end_date >= to_char((now() at time zone 'Asia/Seoul')::date,'YYYY-MM-DD')
);

select id, name, major||'/'||minor as 분류, open_date, end_date, approved
from gonggu where insta = 'pyjaehasip'
  and end_date >= to_char((now() at time zone 'Asia/Seoul')::date,'YYYY-MM-DD')
order by id;
