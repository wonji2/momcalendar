# [오더] 무단 크롤러 방어 및 내부 봇 안전 예외 처리 (교차 검증 완료 최종안)

> **대원칙**:
> 1. 운영 라이브 웹 화면(`momcalendar.com`)을 이용하는 일반 손님(모바일 웹, 인앱 브라우저 등)에게는 **일체의 챌린지·캡차 화면이 절대 노출되지 않아야 합니다**.
> 2. 구글봇(Googlebot), 네이버봇(Yeti), 카카오톡 썸네일 미리보기봇은 100% 무조건 프리패스되어야 합니다.
> 3. 도쿄 VM 핫딜봇 및 깃허브 액션 수집기가 파이썬 기계 헤더 차단에 걸려 자살골(파이프라인 마비)을 겪지 않도록 **내부 시크릿 헤더 탑재 및 WAF 예외 처리**를 반드시 선행 적용합니다.

---

## 1. 코드 작업 (내부 파이썬 수집기 시크릿 헤더 탑재)

### 대상 파일:
- `tools/daily/baby_hotdeal_auto.py`
- `tools/daily/kakao_pc_hotdeal_sender.py` (또는 도쿄 VM 동기화 스크립트)
- 관련 내부 API/프록시 호출 유틸리티

### 작업 내용:
내부 스크립트가 맘캘린더 API(`api.momcalendar.com`)나 단축 프록시(`r.momcalendar.com`)를 호출할 때, Cloudflare WAF에서 아군으로 인증받을 수 있도록 커스텀 요청 헤더를 추가합니다.

```python
# 내부 아군 인증용 공통 헤더
INTERNAL_BOT_HEADERS = {
    'User-Agent': 'MomcalInternalEngine/1.0 (+https://momcalendar.com)',
    'X-Momcal-Internal-Secret': 'momcal_secret_guard_2026'
}

# requests.get / post 호출 시 headers 파라미터에 병합 적용
```

---

## 2. Cloudflare WAF 단일 압축 방화벽 규칙 (대시보드 세팅용)

Cloudflare Free 플랜(무료 5개 제공)의 **WAF Custom Rules**에 아래 1개 규칙을 추가하여 손님 피해 없이 외부 악성 크롤러만 차단합니다.

- **규칙 이름**: `Block Malicious Bots Except Internal & Search Bots`
- **조건식 (Expression Editor)**:
```text
(
  (
    http.user_agent contains "python-requests" or
    http.user_agent contains "Python" or
    http.user_agent contains "Scrapy" or
    http.user_agent contains "curl" or
    http.user_agent contains "Go-http-client" or
    http.user_agent contains "aiohttp" or
    http.user_agent contains "Wget"
  )
  and not http.request.headers["x-momcal-internal-secret"][0] eq "momcal_secret_guard_2026"
  and not cf.verified_bot_category in {"search_engine_crawler", "social_media_agent"}
)
```
- **조치(Action)**: `Block` (403)

---

## 3. Rate Limiting 설정 (Free 플랜 1개 쿼터 활용)

- **규칙 이름**: `Rate Limit API Endpoints`
- **경로**: `hostname eq "api.momcalendar.com"`
- **임계치**: 동일 IP당 **10초간 50회 초과** 시
- **조치**: 1분간 Block 또는 429 응답
- **주의**: 웹 화면(`momcalendar.com/*`)에는 절대 Rate Limiting을 걸지 말 것 (손님 탭 전환/에셋 로딩 보호).

---

## 4. 검증 및 확인 요구사항
1. 내부 수집기 스크립트에 헤더 탑재 후 로컬 테스트 시 정상 통신 확인.
2. 일반 브라우저(User-Agent: Mozilla/5.0) 환경에서 아무런 캡차나 지연 없이 사이트 정상 진입 확인.
