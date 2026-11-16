# -*- coding: utf-8 -*-
"""맘캘린더 인스타 카드뉴스 7편(월~일) 렌더 — 2026-11-16
표지: 후킹 질문 2~3줄 초대형 / 리드 1줄 / 기준일 뱃지 / 서브설명·출처 없음
"""
import os
from insta_cards import (W, H, PURPLE, CORAL, CORAL_SOFT, PURPLE_SOFT, INK, GRAY,
                         LINE_GRAY, BG_WARM, WHITE, DATE, ROOT,
                         cover_photo, cover_type, ending, build)

P = PURPLE
C = CORAL
CS = CORAL_SOFT
PS = PURPLE_SOFT


def cov_photo(bg, lead, l1, l2, accent, dark=False, sub="육아동지한테 당장 공유해 두세요"):
    def f(path):
        cover_photo(bg, lead, l1, l2, accent, path, sub=sub)
    return f


def cov_type(lead, l1, l2, accent, dark=False):
    def f(path):
        cover_type(lead, l1, l2, accent, path, dark=dark)
    return f


EP = []

# ---------------------------------------------------------------- DAY1 월
EP.append(dict(
    day="day1_mon",
    cover=cov_photo("scratchpad/benefit_2027_bg.png",
                    "알아서 주는 줄 알았죠?", "신청 안 하면 못 받는", "육아 지원금 총정리", C),
    total=8,
    cards=[
        dict(label="1 · 지금 확정된 현금·바우처", title="실제 통장·카드로 받는 돈", accent=C, tint=CS, rows=[
            dict(t='kv', head="첫만남이용권", desc=["첫째 200만 · 둘째 이상 300만", "국민행복카드 바우처 (출생 후 2년 내 사용)"], value="200~300만"),
            dict(t='kv', head="부모급여", desc=["0세 월 100만(연 1,200만) · 1세 월 50만(연 600만)", "어린이집 이용 시 보육료 차감 후 현금 지급"], value="총 1,800만"),
            dict(t='kv', head="아동수당", desc=["수도권 월 10만 · 비수도권 10.5만 · 인구감소 최대 13만", "2027년 만 10세 미만 → 2030년 13세 미만 확대 확정"], value="월 10~13만"),
            dict(t='kv', head="1인 자영업·프리랜서 출산급여", desc=["고용보험 미가입 출산여성 대상 (매월 X, 1회 지급)"], value="총 150만"),
        ]),
        dict(label="2 · 지금 확정된 휴직·보육", title="일·보육 부담 줄여주는 혜택", accent=P, tint=PS, rows=[
            dict(t='kv', head="육아휴직 급여", desc=["1~3개월 월 최대 250만 · 4~6개월 200만 · 7개월~ 160만"], value="최대 250만"),
            dict(t='kv', head="6+6 부모육아휴직제", desc=["생후 18개월 내 부부 모두 사용 시 첫 6개월 상향"], value="최대 450만"),
            dict(t='kv', head="배우자 출산휴가", desc=["20일 유급 (우선지원기업 급여 상한 1,684,210원)"], value="20일"),
            dict(t='kv', head="만 3~5세 누리과정", desc=["어린이집·유치원 보육료·유아학비 매월 지원"], value="매월 지원"),
        ]),
        dict(label="3 · 2027년 신설 추진 예정", title="국회 심의 중인 개편안 (미확정)", accent=C, tint=CS, rows=[
            dict(t='kv', head="아이맞이지원금 (추진 예정)", desc=["첫째 1,000만~셋째 1,500만(우대 +500만) · 27.7월생 안"], value="최대 2,000만"),
            dict(t='kv', head="아동기본수당 (추진 예정)", desc=["월 20만(우대 30만, 절반 지역상품권) 확대 추진"], value="월 20~30만"),
            dict(t='kv', head="우리아이자립펀드 (추진 예정)", desc=["중위 150%↓ · 26.9월 이후 출생아, 만 18세까지 매칭안"], value="연 120만"),
            dict(t='kv', head="혼인지원금 (추진 예정)", desc=["27.1월 이후 혼인신고 부부 생애 1회 (세액공제 대체안)"], value="부부 100만"),
            dict(t='note', text="※ 위 4건은 2027년 예산안·법 개정 심의 중(미확정)입니다."),
        ]),
        dict(label="4 · 놓치면 손해 보는 기한", title="확정 기준, 기한부터 챙기세요", accent=P, tint=PS, rows=[
            dict(t='check', text="출생신고 1개월 이내 (넘기면 과태료)", value="1개월"),
            dict(t='check', text="부모급여·아동수당 출생일 포함 60일 이내", value="60일"),
            dict(t='check', text="첫만남이용권 출생일로부터 2년 이내", value="2년"),
            dict(t='check', text="자영업·프리랜서 출산급여 출산 후 1년 내", value="1년"),
            dict(t='check', text="배우자 출산휴가 출산일로부터 120일 이내", value="20일"),
            dict(t='check', text="육아휴직 급여는 신청해야 지급", value="신청"),
        ]),
        dict(label="5 · 한 장 총정리", title="그래서 2027년 출산하면 총 얼마?", accent=P, tint=PS,
             footer="26.11.16 기준 · 확정분/추진안 구분", bridge="배우자 · 임신한 친구 · 육아동지한테 당장 공유하세요 →", rows=[
                 dict(t='kv', head="기본 확정 (소득·직업 무관 공통)", desc=["첫만남 200~300만 + 부모급여 1,800만 + 아동수당 1,200만~(10세)"], value="최소 3,200만~"),
                 dict(t='kv', head="직장인 육아휴직 급여 (1인 1년)", desc=["월 최대 250만(1~3m)·200만(4~6m)·160만(7~12m)"], value="+최대 2,310만"),
                 dict(t='kv', head="또는 자영업·프리랜서 출산급여 (택1)", desc=["고용보험 미가입 출산여성 1회 지급 (육휴와 중복 X)"], value="+150만"),
                 dict(t='kv', head="2027 신설 추진안 (국회 심의 중)", desc=["아이맞이지원금·아동기본수당 등 통과 시 추가 (미확정)"], value="변동 가능"),
             ]),
        dict(kind='visual_grid', label="6 · 오늘 공구 · 인기 핫딜", title="오늘 진행중인 최저가 공구 & 핫딜", accent=C, tint=CS,
             footer="26.11.16 기준", bridge="링크는 프로필에서 바로 확인하세요 →",
             items=[
                 dict(img="scratchpad/thumb_shumer.jpg", badge="~11/17 마감", name="슈메르 미끄럼방지 양말", value="최저가 공구중", is_gonggu=True),
                 dict(img="scratchpad/thumb_logio.jpg", badge="~11/22 마감", name="로지오가닉 배도라지·보리", value="최저가 공구중", is_gonggu=True),
                 dict(img="scratchpad/thumb_garglin.jpg", badge="58%↓", name="가그린 어린이용 3개", value="6,900원", unit="개당 2,300원", is_gonggu=False),
                 dict(img="scratchpad/thumb_braun.png", badge="오늘 특가", name="브라운체온계 6030", value="62,100원", unit="단품", is_gonggu=False),
                 dict(img="scratchpad/thumb_kindo.png", badge="오늘 특가", name="킨도 베베가드 팬츠", value="43,659원", unit="1박스(4팩)", is_gonggu=False),
                 dict(img="scratchpad/thumb_cooing.png", badge="오늘 특가", name="쿠잉 에어드라이 8팩", value="41,682원", unit="팩당 5,210원", is_gonggu=False),
                 dict(img="scratchpad/thumb_magiccan.png", badge="오늘 특가", name="매직캔 오브제 27L", value="45,504원", unit="본품", is_gonggu=False),
                 dict(img="scratchpad/thumb_bebesup.png", badge="오늘 특가", name="베베숲 물티슈 12팩", value="7,900원", unit="팩당 658원", is_gonggu=False),
                 dict(img="scratchpad/thumb_kimchi.png", badge="오늘 특가", name="조선호텔 포기김치 8kg", value="43,776원", unit="kg당 5,472원", is_gonggu=False),
             ]),
        dict(kind='ending'),
    ],
    caption="""[ 공유/저장 필수 ] 지금 법으로 확정된 출산·육아 지원금, 실제 얼마 받는지 정리했어요

인터넷에 떠도는 '추진 중' 숫자 말고, 지금 내 통장·카드로 실제로 들어오는 확정 금액만 먼저 보세요.

✔ 첫만남이용권: 첫째 200만원 / 둘째 이상 300만원 (바우처)
✔ 부모급여: 0세 월 100만원 + 1세 월 50만원 (총 1,800만원)
✔ 아동수당: 수도권 월 10만원 (비수도권 10.5만·인구감소지역 최대 13만, 27년 10세 미만 확정)
✔ 1인 자영업·프리랜서 출산급여: 출산 시 1회 총 150만원
✔ 육아휴직 급여: 1~3개월 월 최대 250만원 (6+6 특례 시 최대 450만원)
✔ 배우자 출산휴가: 20일 유급 (우선지원기업 상한 1,684,210원)

[ 2027년 신설 추진 예정 (국회 심의 중 · 미확정) ]
• 아이맞이지원금(1,000만~2,000만원), 아동기본수당(월 20~30만원), 우리아이자립펀드(중위 150% 이하 연 100~120만원), 혼인지원금(부부 100만원)은 현재 2027년 예산안·법 개정 심의 중이에요.

신청 시기 놓치면 소급 안 되는 혜택도 많아요. 부모급여·아동수당 60일, 출생신고 1개월 기한 꼭 챙기세요.

댓글에 '지원금' 남겨주시면 확정 기준 대상·금액·신청처 정리본 바로 보내드려요.

※ 26.11.16 기준, 보건복지부·고용노동부·기획재정부·국가법령정보센터 확인

#맘캘정보 #육아정보 #출산지원금 #부모급여 #아동수당""",
    cta="댓글 DM — 키워드 '지원금'",
    dm="""1단계: 알림 받으실 수 있게 팔로우 한 번만 눌러주세요! 아래 버튼 누르면 바로 정리본 보내드려요 → [팔로우 확인]
2단계: {이름}님, 기다리셨죠! 2027 육아지원금 12가지 총정리 링크예요. 저장해두고 필요할 때 꺼내 보세요 → [지원금 총정리 보기](노션) / [오늘 특가 보기](맘캘)""",
))

# ---------------------------------------------------------------- DAY2 화
EP.append(dict(
    day="day2_tue",
    cover=cov_photo("scratchpad/bg_daycare.png", "3월 입소 생각 중이면", "지금 대기 안 걸면", "봄에 못 들어가요", C),
    total=6,
    cards=[
        dict(label="1 · 언제 걸까", title="출생신고 직후가 시작이에요", accent=P, tint=PS,
             bridge="동점(같은 순위)이면 결국 신청한 순서대로 들어가요 →", rows=[
                 dict(t='check', text="출생신고 직후 주민번호 나오면 바로 대기", value="출생 직후"),
                 dict(t='check', text="3월 신학기 입소는 전년 9~10월이 마지노선", value="9~10월"),
                 dict(t='check', text="희망 입소월 최소 6개월 전에는 신청 필수", value="D-6M"),
                 dict(t='check', text="태아 상태 사전 대기는 불가(출생 후 가능)", value="출생 후"),
                 dict(t='check', text="동순위(예: 맞벌이 200점)끼리는 100% 선착순", value="선착순"),
                 dict(t='note', text="지역·원마다 신학기 반 편성 시기가 달라 공고 확인이 먼저예요."),
             ]),
        dict(label="2 · 1순위 점수", title="아이사랑에서 가점 챙겨요", accent=C, tint=CS,
             bridge="맞벌이·다자녀 등 1순위 서류가 있어야 앞번호로 올라가요 →", rows=[
                 dict(t='kv', head="아이사랑 웹·앱", desc=["임신육아종합포털 아이사랑에서 온라인 통합 신청"], value="childcare"),
                 dict(t='kv', head="맞벌이 200점", desc=["부부 모두 재직·사업자·육아휴직 증빙 시 1순위"], value="1순위"),
                 dict(t='kv', head="다자녀 · 외동", desc=["자녀 2명 이상·한부모·기초생활 등 1순위 100점"], value="100점+"),
                 dict(t='kv', head="서류 누락 주의", desc=["체크만 하고 서류 미제출 시 3순위(0점)로 밀림"], value="필수 확인"),
                 dict(t='kv', head="직장·협동 별도", desc=["직장·부모협동 어린이집은 원 자체 모집 공고 확인"], value="별도 신청"),
             ]),
        dict(label="3 · 몇 곳 · 유지", title="한 곳만 쓰면 못 들어가요", accent=P, tint=PS,
             bridge="신청 후에도 대기 연장·순번 관리까지 챙겨야 안 날아가요 →", rows=[
                 dict(t='check', text="미재원 최대 3곳 · 재원 중이면 최대 2곳 신청", value="3곳 / 2곳"),
                 dict(t='check', text="집 근처 + 출퇴근 동선까지 통학 범위 넓히기", value="동선 분산"),
                 dict(t='check', text="신청일 기준 1년 지나면 대기 자동 만료(연장 필수)", value="1년 만료"),
                 dict(t='check', text="입소 확정 후 7일 내 미등록 시 다음 대기자에게 이동", value="7일 기한"),
                 dict(t='check', text="원에 전화해 결원·반 편성 일정 직접 문의하기", value="전화 확인"),
                 dict(t='note', text="원아 연락처·주소 변경 시 아이사랑 정보도 바로 수정하세요."),
             ]),
        dict(label="4 · 기다리는 동안", title="대기 중에 바로 쓰는 대안", accent=C, tint=CS,
             bridge="댓글에 「얼집」 남기면 가점표·체크리스트 DM 보내드려요 →", rows=[
                 dict(t='kv', head="시간제보육", desc=["6~36개월, 시간당 5,000원 중 부모 부담 2,000원"], value="월 60시간"),
                 dict(t='kv', head="독립반 당일예약", desc=["당일 오후 2시까지 아이사랑 온라인 예약 가능"], value="14시 마감"),
                 dict(t='kv', head="가정·민간 병행", desc=["국공립 대기 걸어두고 민간·가정 0~1세반 병행"], value="투트랙"),
                 dict(t='kv', head="아이돌봄서비스", desc=["만 12세 이하 가정 방문 돌봄(소득별 정부지원)"], value="정부지원"),
                 dict(t='kv', head="입소 연락 팁", desc=["수시 결원은 상시 빠지므로 알림 문자·전화 켜두기"], value="알림 ON"),
             ]),
        dict(kind='ending'),
    ],
    caption="""[ 공유/저장 필수 ] 어린이집 대기, 지금 안 걸어두면 봄에 못 들어가요

보내기 직전에 알아보면 이미 늦습니다. 출생신고 직후 바로 대기부터 걸고, 동시에 1순위 점수까지 챙겨두는 게 답이에요.

✔ 출생신고 직후 주민번호 나오면 바로 대기 신청 (동순위면 선착순!)
✔ 아이사랑 웹·앱에서 통합 신청 (직장·협동은 별도 모집)
✔ 미재원 최대 3곳 · 재원 중 최대 2곳 꽉 채워 신청하기
✔ 맞벌이(200점)·다자녀 등 1순위 증빙서류 누락 없이 등록하기
✔ 신청 1년 후 자동 만료 주의! 대기 연장 + 원 전화 확인 필수
✔ 기다리는 동안 시간제보육(시간당 2,000원)으로 빈 시간 메우기

댓글에 「얼집」 남겨주시면 입소대기 가점표랑 상황별 체크리스트 정리본을 바로 DM 보내드릴게요!
링크는 프로필에서 바로 확인하실 수 있습니다.

※ 26.11.16 기준, 아이사랑·지자체 보육포털 안내 확인

#맘캘정보 #어린이집대기 #육아정보 #시간제보육 #육아꿀팁""",
    cta="댓글 DM — 키워드 「얼집」",
))

# ---------------------------------------------------------------- DAY3 수
EP.append(dict(
    day="day3_wed",
    cover=cov_photo("scratchpad/bg_playroom.png", "6개월~36개월 · 월 60시간", "어린이집 안 보내도 OK", "시간당 2,000원 보육", C,
                    sub="댓글에 「보육」 남기면 신청 가이드 보내드려요"),
    total=5,
    cards=[
        dict(label="1 · 누가", title="6~36개월, 이 조건이면 돼요", accent=P, tint=PS, rows=[
            dict(t='check', text="생후 6개월 ~ 36개월", value="6~36개월"),
            dict(t='check', text="어린이집·유치원 안 다니는 아이", value="미취원"),
            dict(t='check', text="부모급여·양육수당 받는 아이", value="대상"),
            dict(t='check', text="이미 다니면 대상 아니에요", value="제외"),
        ]),
        dict(label="2 · 얼마", title="5,000원 중 2,000원만 내요", accent=C, tint=CS, rows=[
            dict(t='kv', head="정부 지원", desc=["시간당 5,000원 중 3,000원을 정부가 지원"], value="3,000원"),
            dict(t='kv', head="부모 부담", desc=["나머지 2,000원만 결제하면 돼요"], value="2,000원"),
            dict(t='kv', head="지원 한도", desc=["한 달 60시간까지 지원"], value="월 60시간"),
            dict(t='kv', head="결제 수단", desc=["국민행복카드로 결제해야 적용"], value="행복카드"),
        ]),
        dict(label="3 · 어떻게", title="예약하고 카드로 결제", accent=P, tint=PS,
             bridge="댓글에 「보육」 남기면 신청·준비물 가이드 보내드려요 →", rows=[
                 dict(t='kv', head="이용 기관", desc=["어린이집·육아종합지원센터 등 지정 제공기관"], value="지정기관"),
                 dict(t='kv', head="운영 시간", desc=["독립반 09~18시, 통합반 09~16시 (기관별 상이)"], value="기관별"),
                 dict(t='kv', head="예약", desc=["독립반 당일 예약 마감 14:00까지 연장"], value="당일 14시"),
             ]),
        dict(kind='ending'),
    ],
    caption="""[ 공유/저장 필수 ] 6개월~36개월 · 월 60시간 · 시간당 2,000원만 내면 됩니다

어린이집 안 보내는 시기에 병원·볼일 볼 때 딱 이거예요.

✔ 대상은 생후 6개월~36개월, 부모급여·양육수당 받는 아이
✔ 시간당 5,000원 중 정부 3,000원 지원, 부모 부담 2,000원
✔ 정부 지원은 월 60시간까지
✔ 국민행복카드로 결제해야 적용돼요
✔ 독립반 09~18시(당일 14시 마감 연장), 통합반 09~16시

이미 어린이집 다니는 아이는 대상이 아니에요. 미리 확인하고 가세요.

댓글에 「보육」 남겨주시면 예약 방법·준비물 체크리스트 정리본 바로 DM 보내드릴게요!

※ 26.11.16 기준, 복지로·교육부 시간제보육 안내 확인

#맘캘정보 #시간제보육 #육아정보 #육아꿀팁 #맞벌이육아""",
    cta="댓글 DM — 키워드 「보육」",
))

# ---------------------------------------------------------------- DAY4 목
EP.append(dict(
    day="day4_thu",
    cover=cov_photo("scratchpad/bg_schoolbag.png", "어린이집 선생님이 먼저 보는", "엄마들이 꼭 빠뜨리는", "첫날 준비물 8가지", C),
    total=5,
    cards=[
        dict(label="1 · 이름 붙이는 것", title="이름 없으면 돌아옵니다", accent=P, tint=PS, rows=[
            dict(t='check', text="가방·옷·수건에 이름표", value="필수"),
            dict(t='check', text="물통·수저에 이름 적기", value="필수"),
            dict(t='check', text="여벌옷·이불에도 이름", value="필수"),
        ]),
        dict(label="2 · 채워 넣는 것", title="하루치 + 여분이 답", accent=C, tint=CS, rows=[
            dict(t='check', text="기저귀·물티슈 하루치 + 여분", value="+1"),
            dict(t='check', text="여벌옷 2벌, 계절에 맞춰", value="2벌"),
            dict(t='check', text="낮잠 이불·베개", value="사이즈"),
            dict(t='check', text="여분 마스크", value="여분"),
        ]),
        dict(label="3 · 전날 밤 3분", title="아침에 찾지 않으려면", accent=P, tint=PS,
             bridge="오늘 마감 공구는 프로필 링크 →", rows=[
                 dict(t='check', text="출입문 비번·원 연락처 저장", value="저장"),
                 dict(t='check', text="하원 시간·데려갈 사람 합의", value="합의"),
                 dict(t='check', text="가방은 문 앞에 세팅", value="세팅"),
                 dict(t='note', text="원마다 준비물이 달라요. 입소 안내문 목록이 먼저예요."),
             ]),
        dict(kind='ending'),
    ],
    caption="""[ 공유/저장 필수 ] 어린이집 첫날, 이 8가지만 챙기면 아침이 안 급해요

등원 첫날 아침에 찾으면 이미 늦어요. 전날 밤에 다 끝내두는 게 답입니다.

✔ 이름표 미리 달아두기 (가방·옷·수건)
✔ 기저귀·물티슈 하루치 + 여분
✔ 여벌옷 2벌, 계절에 맞춰
✔ 물통·수저에 이름 적기
✔ 낮잠 이불·베개 (원 안내 사이즈 확인)
✔ 여분 마스크
✔ 출입문 비번·원 연락처 저장
✔ 하원 시간과 데려가는 사람 합의

원마다 준비물이 달라요. 입소 안내문에 적힌 목록이 먼저고, 이 8가지는 어디든 빠지면 곤란한 것들이에요.
첫 주는 여벌옷을 한 벌 더 넣어두면 마음이 편해요.

댓글에 '준비물' 남겨주시면 첫 주에 필요한 것까지 체크리스트로 정리해서 보내드려요.

※ 26.11.16 기준, 어린이집 입소 안내문·맘캘린더 정리

#맘캘정보 #어린이집준비물 #육아정보 #육아꿀팁 #첫등원""",
    cta="댓글 DM — 키워드 '준비물'",
    dm="""1단계: 알림 받으실 수 있게 팔로우 한 번만 눌러주세요! 아래 버튼 누르면 바로 정리본 보내드려요 → [팔로우 확인]
2단계: {이름}님, 기다리셨죠! 어린이집 첫 주 체크리스트 링크예요. 저장해두고 필요할 때 꺼내 보세요 → [준비물 체크리스트](노션) / [오늘 특가 보기](맘캘)""",
))

# ---------------------------------------------------------------- DAY5 금
EP.append(dict(
    day="day5_fri",
    cover=cov_photo("scratchpad/bg_fri_deals.png", "오늘 밤 12시면 끝나요", "엄마들이 제일 많이 담은", "마감 임박 공구 TOP 5", C),
    total=6,
    cards=[
        dict(label="1 · 오늘 숫자", title="11/16 맘캘 집계", accent=C, tint=CS,
             footer="26.11.16 07:40 집계 · 발행일 아침 재집계", rows=[
                 dict(t='kv', head="오늘 오픈", desc=["오늘 새로 열린 공구"], value="326건"),
                 dict(t='kv', head="오늘 마감", desc=["오늘 자정에 닫혀요"], value="167건"),
                 dict(t='kv', head="진행 중", desc=["지금 참여할 수 있는 전체"], value="585건"),
             ]),
        dict(label="2 · 인기 1~3위", title="오늘 가장 많이 본 공구", accent=C, tint=CS, rows=[
            dict(t='rank', num="01", name="두리 변기 모음전", sub="켈리맘 · 오늘 마감"),
            dict(t='rank', num="02", name="무아스 세정제 디스펜서", sub="mukohobra · 오늘 마감"),
            dict(t='rank', num="03", name="글리엔 가습기", sub="해피엘 · 오늘 마감"),
        ]),
        dict(label="3 · 인기 4~5위", title="마감이 조금 더 남은 것", accent=P, tint=PS, rows=[
            dict(t='rank', num="04", name="슈메르 미끄럼방지 양말", sub="맘캘린더 · 11/17까지"),
            dict(t='rank', num="05", name="로지오가닉 배도라지쥬스&보라차", sub="맘캘린더 · 11/22까지"),
            dict(t='note', text="마감 지나면 다음 공구는 2~4주 뒤예요."),
        ]),
        dict(label="4 · 왜 지금", title="재오픈은 보장이 없어요", accent=C, tint=CS,
             bridge="전체 마감 리스트는 프로필 링크 →", rows=[
                 dict(t='check', text="마감 다음 공구는 2~4주 뒤", value="2~4주"),
                 dict(t='check', text="같은 가격으로 다시 안 열려요", value="가격"),
                 dict(t='check', text="셀러 사정으로 일정이 당겨져요", value="변동"),
             ]),
        dict(kind='ending'),
    ],
    caption="""[ 공유/저장 필수 ] 오늘 자정에 167개 공구가 닫혀요, 그중 5개만 골랐습니다

맘캘린더에 오늘 올라온 공구가 585건이에요. 다 볼 시간 없으니까 많이 본 것만 추렸어요.

✔ 오늘 오픈 326건 / 오늘 마감 167건 / 진행 중 585건
✔ 두리 변기 모음전(켈리맘) 오늘 마감
✔ 무아스 세정제 디스펜서(mukohobra) 오늘 마감
✔ 글리엔 가습기(해피엘) 오늘 마감
✔ 슈메르 미끄럼방지 양말은 11/17까지, 로지오가닉 주스는 11/22까지

마감 지나면 다음 공구는 2~4주 뒤예요. 그때 같은 가격은 없어요.

같이 사는 엄마방에 하나 보내주세요. 마감 놓친 사람이 제일 아까워해요.

※ 26.11.16 07:40 맘캘린더 DB 집계 기준, 발행일에 숫자 재확인

#맘캘정보 #공구 #육아맘 #아기용품 #육아정보""",
    cta="맞춤 공유 — 같이 사는 엄마방·친구",
))

# ---------------------------------------------------------------- DAY6 토
EP.append(dict(
    day="day6_sat",
    cover=cov_photo("scratchpad/bg_sat_calendar.png", "이번 주 공구 언제 열려요?", "날짜별로 딱 정리한", "11월 공구 캘린더", P),
    total=5,
    cards=[
        dict(label="1 · 16~17일", title="오늘 열고 오늘 닫는 것", accent=C, tint=CS, rows=[
            dict(t='kv', head="11/16 오늘", desc=["오픈 326건 · 마감 167건"], value="오늘"),
            dict(t='kv', head="11/17", desc=["슈메르 미끄럼방지 양말 마지막 날"], value="~17일"),
        ]),
        dict(label="2 · 18~19일", title="주 중반에 닫히는 것", accent=P, tint=PS, rows=[
            dict(t='kv', head="11/18 크렛", desc=["랜쥬"], value="~18일"),
            dict(t='kv', head="11/19 남코 유모차 핸드머프", desc=["다니맘"], value="~19일"),
            dict(t='kv', head="11/19 세이팬", desc=["crayon.mom_siha"], value="~19일"),
        ]),
        dict(label="3 · 20~22일", title="주말까지 남은 것", accent=C, tint=CS,
             bridge="전체 일정 표는 프로필 링크 →", rows=[
                 dict(t='kv', head="11/20 쿠진아트 에어프라이어", desc=["승빈맘"], value="~20일"),
                 dict(t='kv', head="11/22 로지오가닉 주스", desc=["맘캘린더"], value="~22일"),
                 dict(t='kv', head="11/22 허니북 마더구스", desc=["워니맘맥"], value="~22일"),
             ]),
        dict(kind='ending'),
    ],
    caption="""[ 공유/저장 필수 ] 이번 주 공구, 날짜만 외우면 됩니다

월요일마다 맘캘린더 공구 일정을 한 장으로 정리해 드려요.

✔ 11/16 오늘 오픈 326건, 오늘 마감 167건
✔ 11/17 슈메르 미끄럼방지 양말 마지막 날
✔ 11/18 크렛(랜쥬)
✔ 11/19 남코 유모차 핸드머프, 세이팬
✔ 11/20 쿠진아트 에어프라이어
✔ 11/22 로지오가닉 배도라지쥬스, 허니북 마더구스

일정은 셀러 사정으로 하루이틀 앞당겨지기도 해요. 마감일 하루 전에 한 번 더 확인하는 게 안전합니다.

이번 주 장바구니를 미리 정해두세요. 저장해두면 매일 아침 다시 펼쳐보실 수 있어요.

※ 26.11.16 기준, 맘캘린더 공구 일정 DB

#맘캘정보 #공구 #육아정보 #육아맘 #11월육아""",
    cta="저장",
))

# ---------------------------------------------------------------- DAY7 일
EP.append(dict(
    day="day7_sun",
    cover=cov_photo("scratchpad/bg_sun_lowest.png", "아직도 제값 주고 사세요?", "지금 바로 담아야 할", "오늘 핫딜 TOP 5", C),
    total=5,
    cards=[
        dict(label="1 · 오늘 1위", title="가장 많이 내려간 것", accent=C, tint=CS, rows=[
            dict(t='rank', num="01", name="네이버 SOS 리페어 앤 케어 바디로션 400ml 2개", sub="환절기 보습 · 오늘 네이버 최저가", value="18,600원"),
            dict(t='note', text="20건 중 할인율 1위, 53% 내렸어요."),
        ]),
        dict(label="2 · 2~3위", title="뒤이어 내려온 것", accent=P, tint=PS, rows=[
            dict(t='rank', num="02", name="엑사이더 문틀철봉 EC202 단축", sub="47% 내림", value="21,000원"),
            dict(t='rank', num="03", name="뉴트로지나 고보습 바디로션 세트", sub="45% 내림", value="32,800원"),
        ]),
        dict(label="3 · 4~5위와 생활템", title="같이 내려온 생활템", accent=C, tint=CS,
             bridge="오늘 20건 링크는 댓글 '핫딜' →", rows=[
                 dict(t='rank', num="04", name="유니트 브로우 무드 스위치", sub="44% 내림", value="32,900원"),
                 dict(t='rank', num="05", name="꽃보다오징어 오리지날", sub="41% 내림", value="30,620원"),
                 dict(t='rank', num="06", name="심리스 쿠션 양말 5켤레", sub="38% 내림", value="3,380원"),
             ]),
        dict(kind='ending'),
    ],
    caption="""[ 공유/저장 필수 ] 오늘 할인율 53%부터 시작입니다, 20건 중 5개만

핫딜은 하루면 끝나요. 오늘 올라온 것 중 할인율 높은 순으로 봤습니다.

✔ 네이버 SOS 리페어 바디로션 400ml 2개 18,600원 (53% 내림)
✔ 엑사이더 문틀철봉 EC202 21,000원 (47% 내림)
✔ 뉴트로지나 고보습 바디로션 세트 32,800원 (45% 내림)
✔ 유니트 브로우 무드 스위치 32,900원 (44% 내림)
✔ 꽃보다오징어 오리지날 30,620원 (41% 내림)
✔ 생활템은 심리스 쿠션 양말 5켤레 3,380원 (38% 내림)

가격은 수시로 바뀌고 오늘 밤이면 품절되는 것도 있어요. 오늘 안 보면 내일은 없습니다.

댓글에 '핫딜' 남겨주시면 오늘 20건 전체 링크 모음 바로 보내드려요.

※ 26.11.16 오늘 기준, 판매처 표시가 그대로예요

#맘캘정보 #핫딜 #육아맘 #육아정보 #생활용품추천""",
    cta="댓글 DM — 키워드 '핫딜'",
    dm="""1단계: 알림 받으실 수 있게 팔로우 한 번만 눌러주세요! 아래 버튼 누르면 바로 정리본 보내드려요 → [팔로우 확인]
2단계: {이름}님, 기다리셨죠! 오늘 핫딜 20건 링크 모음이에요. 저장해두고 필요할 때 꺼내 보세요 → [오늘 핫딜 20건](노션) / [맘캘 핫딜 탭 열기](맘캘)""",
))


if __name__ == "__main__":
    for ep in EP:
        out = build(ep['day'], ep['cover'], ep['cards'], ep['total'])
        cap = [f"# {ep['day']} 캡션 (발행용)", "",
               f"**썸네일 후킹**: {ep['cards'] and ''}", "", ep['caption'], "",
               "---", f"CTA(1개만): {ep['cta']}"]
        if ep.get('dm'):
            cap += ["", "## 리틀리 자동 DM 2단계", ep['dm']]
        cap += ["", f"## 카드 구성: 표지 + 속지 {ep['total']-2}장 + 고정 엔딩 = 총 {ep['total']}장"]
        open(os.path.join(out, "caption.md"), "w").write("\n".join(cap))
        print("done", out)
