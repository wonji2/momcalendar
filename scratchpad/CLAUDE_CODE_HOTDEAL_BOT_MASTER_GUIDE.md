# 🗺️ 맘캘린더 핫딜 & 카톡봇 전체 시스템 아키텍처 및 데이터 흐름 완전 분석서

**문서 위치**: `scratchpad/CLAUDE_CODE_HOTDEAL_BOT_MASTER_GUIDE.md`  
**대상**: 클로드 코드 (Claude Code) & 맘캘린더 개발팀  
**작성 목적**: 핫딜 수집 출처부터 DB 적재, 수익링크 변환, 웹/앱 노출, 그리고 도쿄 VM 카카오톡 핫딜봇 발송까지의 모든 기술 자산과 데이터 흐름 인수인계

---

## 1. 핫딜 데이터는 어디서 오는가? (수집 출처 및 크롤러)

핫딜 데이터는 개발자가 수기로 넣는 것이 아니라, **GitHub Actions 클라우드 환경에서 30분마다 무인 자동 수집**됩니다.

- **실행 워크플로우**: `.github/workflows/hotdeal-cloud.yml`
- **실행 주기**: 매시 17분, 47분 (`cron: '17,47 * * * *'`, 24시간 무중단)
- **실행 스크립트**: `tools/daily/baby_hotdeal_auto.py`
- **수집 출처 3대 경로 (Scraping Sources)**:
  1. `collect_from_jirum_alarm()`:
     - **출처**: **지름알림(jirum.net) API**
     - **대상**: 뽐뿌, 딜바다, 에펨코리아, 어미새, 루리웹, 클리앙 등 국내 **16대 온라인 커뮤니티**의 실시간 인기 핫딜.
  2. `collect_from_bbhd()`:
     - **출처**: **베이비핫딜(bbhd.kr)** 자유게시판 (`board.php?bo_table=free`)
     - **대상**: 뽐뿌 및 맘이베베에서 화제가 된 육아용품, 기저귀, 물티슈, 분유, 생필품 핫딜.
     - **진행 추적**: Supabase DB의 `ops_status` 테이블에 `'bbhd-last-id'`로 마지막 처리된 게시글 번호(`wr_id`)를 저장하여 중복 수집 방지.
  3. `collect_from_3ha_klook()`:
     - **출처**: **세시간전(3hoursahead)** 제휴 플랫폼
     - **대상**: **클룩(Klook)**의 키즈카페, 테마파크, 아쿠아리움, 가족여행 숙박/입장권 특가.

---

## 2. 수집된 핫딜의 수익링크 변환 (CPA 머천트 엔진)

수집된 원본 상품 링크는 사용자가 구매 시 사장님에게 제휴 수수료가 적립되도록 **즉시 수익 딥링크로 자동 치환**됩니다 (`tools/daily/baby_hotdeal_auto.py` 내부):

1. **쿠팡 링크**:
   - Supabase Edge Function `coupang-hotdeal`을 호출하여 사장님 쿠팡 파트너스 트래킹 ID가 심긴 공식 딥링크로 변환.
2. **종합몰 / 오픈마켓 / 전문몰 (30+개 제휴처)**:
   - 대상: 11번가, 지마켓, 옥션, 롯데ON, SSG, 이마트, 홈플러스, 보리보리, 하프클럽, 패션플러스, 올리브영, 무신사, 29CM, W컨셉, 오늘의집 등.
   - 변환: 사장님 링크프라이스 고유 머천트 ID (`A100706561`) 딥링크로 자동 치환.
3. **여행 / 레저 (클룩)**:
   - 세시간전 제휴 파트너 코드 (`aid=15500`, 우리 AID `140703`) 딥링크로 자동 변환.

---

## 3. 데이터베이스 저장소 (Supabase DB)

변환된 모든 핫딜은 Supabase 데이터베이스에 적재됩니다:
- **접속 정보**:
  - `SUPABASE_URL`: `https://hycaqsqeogjtbscmzrtm.supabase.co`
  - `SUPABASE_ANON_KEY`: `sb_publishable_u4hR4mdNTSss3kdjFH6R5Q_iuJ2MuGE`
- **핵심 테이블**:
  - `hotdeals`: 핫딜 원천 테이블 (`id`, `title`, `price`, `mall`, `link`, `img_url`, `created_at`, `price_status` 등)
  - `price_history`: 핫딜 가격 변동 추적 차트 테이블 (`hotdeal_id`, `price`, `created_at`)
  - `ops_status`: 봇 상태 및 수집 마지막 ID 보관 테이블 (`id`, `payload`, `updated_at`)

---

## 4. 웹/앱 화면 노출 및 마스킹 단축링크

1. **웹 & 앱 화면**:
   - 파일: `index.html` (핫딜 탭 `renderHotdeal()`)
   - Supabase `hotdeals` 테이블을 `order=id.desc`로 조회하여 실시간 렌더링.
2. **단축 마스킹 링크 & 동적 썸네일 (Cloudflare Workers)**:
   - 주소: `https://momcalendar.com/r.html?id={deal_id}` 또는 `https://r.momcalendar.com/{id}`
   - 역할: 카카오톡, 네이버 카페 등 공유 시 상품 썸네일과 제목 미리보기(OG 메타태그)를 동적으로 생성하고, 클릭 시 최종 제휴 쇼핑몰로 1초 리다이렉트.

---

## 5. 카카오톡 핫딜봇 발송 시스템 (도쿄 VM)

- **서버 환경**: LightNode 도쿄 가상 윈도우 VM (`38.60.212.31`)
- **실행 스크립트**: `tools/daily/kakao_pc_hotdeal_sender.py`
- **배치 파일**: `tools/daily/run_kakao_bot.bat`
- **윈도우 스케줄러**: `RunKakaoBot`
- **발송 이력 파일**: `C:\MomcalBot\kakao_posted_deals.json` (중복 발송 방지용 500개 ID 캐시)
- **로그 파일**: `C:\MomcalBot\bot.log`
- **발송 프로세스**:
  1. 3~5분 주기로 Supabase `hotdeals` 최신 40개 조회 (`get_latest_hotdeals()`).
  2. `kakao_posted_deals.json`에 없는 신규 핫딜 선별.
  3. 카카오톡 PC 프로그램에서 `[맘캘린더] 핫딜공지방` 창을 찾아 포커싱.
  4. 입력창에 딜 문구 붙여넣기 후 스페이스+백스페이스로 전송 버튼 깨우기.
  5. Enter 또는 마우스 전송 버튼 클릭으로 단톡방 발송.

---

## 6. [중요] 카톡봇 현재 결함 원인 및 즉시 조치 사항

### ① 새벽에 왜 다른 방으로 갔는가?
- 구버전 창 제목 감지 로직이 `"핫딜"`과 `"공지"` 키워드 부분 매칭이었음.
- VM 화면에 사장님이 띄워둔 개인톡/타 단톡방에 키워드가 걸려 엉뚱한 방으로 발송됨.
- **조치**: `_is_target_title()` 정규식으로 `[맘캘린더] 핫딜공지방` 및 인원수(`[맘캘린더] 핫딜공지방 34`)만 100% 화이트리스트 타깃팅하도록 수정 필수.

### ② 새벽 3시 30분에 왜 심야 발송되었는가?
- 방해금지 시간(22:00~09:00 KST) 로직 부재 및 타임존 오차.
- **조치**: `QUIET_START_H = 22`, `QUIET_END_H = 9` 설정 및 `timezone(timedelta(hours=9))` KST 엄격 적용.

### ③ 지금 왜 샌드(전송) 버튼이 안 눌리고 발송이 안 되는가?
1. **VM 프로세스 중단 상태**: 아침에 사장님 지침으로 `taskkill` 종료 및 스케줄러 `Disable` 처리됨 -> 재가동 필요.
2. **RDP(원격 데스크톱) 종료로 인한 세션 잠금(Session Disconnected)**:
   - RDP 창을 닫으면 윈도우 OS가 화면 세션을 잠그며 모든 물리 키(`keybd_event`)와 마우스 입력을 무시함.
   - **해결책**:
     1) 카톡 입력창 핸들(`edit_h`)에 `WM_CHAR` 스페이스+백스페이스 및 `WM_KEYDOWN` Enter 메시지를 직접 주입하는 백업 로직 필수 적용 (아래 코드 참조).
     2) 도쿄 VM에서 RDP 종료 시 그냥 닫지 말고 CMD(관리자)에서 아래 명령어로 세션을 넘겨야 함:
        ```cmd
        for /f "skip=1 tokens=3" %s in ('query user %USERNAME%') do %windir%\System32\tscon.exe %s /dest:console
        ```
3. **창 제목 인원수 불일치 버그**:
   - 현재 코드의 `_title(h) == TARGET_ROOM` 비교는 카톡 창 제목 뒤의 숫자(인원수) 때문에 무조건 `False`가 되어 전송 전에 스스로 `ABORT` 중단됨.
   - **해결책**: 아래 정규식 함수로 변경:
     ```python
     def _is_target_title(title):
         return bool(re.match(r'^\[맘캘린더\]\s*핫딜공지방(?:\s*\d+)?$', title.strip()))
     ```

---

## 7. 클로드 코드가 `tools/daily/kakao_pc_hotdeal_sender.py`에 반영할 최종 패치 코드

```python
# 1. 창 제목 매칭 (인원수 허용 및 타 채팅방 원천 차단)
def _is_target_title(title):
    return bool(re.match(r'^\[맘캘린더\]\s*핫딜공지방(?:\s*\d+)?$', title.strip()))

def _is_target_foreground(chat_h):
    try:
        fg = win32gui.GetForegroundWindow()
        return _is_target_title(_title(fg))
    except Exception:
        return False

# 2. RDP 세션 분리 환경에서도 확실하게 전송 버튼을 깨우고 엔터를 치는 메시지 주입
# send_message() 내부 클립보드 붙여넣기 직후:
win32gui.SendMessage(edit_h, win32con.WM_PASTE, 0, 0)
time.sleep(0.2)

# 전송 버튼 강제 활성화 (스페이스 + 백스페이스 메시지)
win32gui.SendMessage(edit_h, win32con.WM_CHAR, 0x20, 0)
time.sleep(0.05)
win32gui.SendMessage(edit_h, win32con.WM_CHAR, 0x08, 0)
time.sleep(0.1)

# 엔터 전송 (WM_KEYDOWN + WM_KEYUP 직접 전송)
win32gui.PostMessage(edit_h, win32con.WM_KEYDOWN, win32con.VK_RETURN, 0)
time.sleep(0.05)
win32gui.PostMessage(edit_h, win32con.WM_KEYUP, win32con.VK_RETURN, 0xC0000001)
```

위 가이드를 확인하고 코드를 패치한 뒤, 도쿄 VM에서 최신 코드를 pull 받아 봇을 재가동해 주시기 바랍니다.
