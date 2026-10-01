-- 되묻기 시안 정리 (사장님 지시 2026-10-01 "A3빼고 a5에서 확장해서 … a6도 빼고 a7도 빼고 a8은 확장해서 … d는 전업주부 육아맘인 내가")
-- 승인 화면: https://momcalendar.com/approve.html

-- ① 뺄 것 (아직 안 올라간 것만)
delete from threads_queue where variant in ('A3','A6','A7') and status <> 'posted';

-- ② A5 — 단톡방 피로 → 사이트·챗봇으로
update threads_queue set body =
'공구 일정 어디서 받아?

① 셀러 인스타
② 단톡방
③ 카페
④ 그냥 뜨면 보임

단톡방 알림 때문에 나가고 싶었던 적 있지 않아?
그럴 땐 맘캘린더 들어와서 보면 돼
카톡으로 물어보면 알려주는 챗봇도 있어',
 status = 'pending', reject_note = null, updated_at = now()
where variant = 'A5' and status <> 'posted';

-- ③ A8 — 찜하면 오픈일 아침에 알림
update threads_queue set body =
'장바구니에 담아두고 못 산 공구 있어?

맘캘린더는 찜해두면
그 공구 오픈하는 날 아침에 알림이 울려

놓쳐서 아쉬웠던 거 하나씩 말해줘',
 status = 'pending', reject_note = null, updated_at = now()
where variant = 'A8' and status <> 'posted';

-- ④ 새 시안 4개 — 사이트 설명 · 챗봇 설명 · D 두 가지(숫자 표현만 다름, 사장님이 고르시면 된다)
insert into threads_queue (variant, body, reply_text)
select v, b, r from (values
('site',
'맘캘린더가 뭐냐면

인스타 셀러들이 여는 공구 일정을
한 군데 모아서 날짜순으로 보여주는 곳이야

오늘 뭐 열렸는지, 내일 뭐 열리는지
핫딜까지 한 화면에서 볼 수 있어

찜해두면 오픈하는 날 아침에 알림도 울려',
'https://momcalendar.com

공구·핫딜 다 여기 모아두고 있어'),

('bot',
'상품 이름만 알고 공구 날짜를 모를 때

카톡으로 맘캘린더한테 물어보면 돼
"프레벨롱" 이렇게만 보내도
언제 누가 여는지 바로 알려줘

밤에 물어봐도 답이 와',
'카톡 채널 👉 https://pf.kakao.com/_zGfxnX/chat

일정 전체는 https://momcalendar.com'),

('D-천건',
'전업주부 육아맘인 내가
공구 일정을 수기로 모으기 시작했는데

어느새 천 건도 넘었어

하나씩 찾아보다 포기하는 사람 많잖아
그래서 한 군데 모아두는 중이야',
'https://momcalendar.com

공구·핫딜 다 여기 모아두고 있어'),

('D-만건',
'전업주부 육아맘인 내가
공구 일정을 수기로 모으기 시작했는데

세어보니 1만 1천 건이 넘었더라

하나씩 찾아보다 포기하는 사람 많잖아
그래서 한 군데 모아두는 중이야',
'https://momcalendar.com

공구·핫딜 다 여기 모아두고 있어')
) t(v, b, r)
where not exists (select 1 from threads_queue q where q.variant = t.v and q.status in ('pending','approved'));

select variant, status, replace(left(body, 34), chr(10), ' ') as 첫줄
from threads_queue where status <> 'posted' order by variant;
