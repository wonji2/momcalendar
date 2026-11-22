-- 카페 새 글 1분마다 (사장님 2026-10-26 「30분마다 말고 실시간으로 가져올순 없어?」)
--  cafe-feed?latest=1 = 카페 전체글 목록(menus/0) 1쪽 50개 → 우리 커뮤니티 게시판 글만 upsert. 네이버 요청 2개/분.
--  댓글·조회수 갱신과 게시판별 전수는 기존 30분 cafe-feed 가 그대로 한다.
--  머리(x-cron-secret)는 기존 cafe-feed 크론 명령에서 그대로 복사한다(비밀값을 파일에 적지 않으려고)
--  0-L 한도: Edge 호출 +43,200/월(무료 50만) · 표 행 수는 그대로(같은 글 upsert)
select cron.schedule('cafe-feed-latest', '* * * * *',
  replace(command, 'cafe-feed?per=30', 'cafe-feed?latest=1'))
from cron.job where jobname = 'cafe-feed';
select jobname, schedule from cron.job where jobname like 'cafe-feed%';
