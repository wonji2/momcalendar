# 🚨 [긴급/필독] 맘캘린더 핫딜 카톡봇 발송 결함 수습 및 파이프라인 전체 가이드

**문서 위치**: `scratchpad/CLAUDE_CODE_HOTDEAL_BOT_MASTER_GUIDE.md`  
**대상**: 클로드 코드 (Claude Code) & 맘캘린더 개발팀  
**최종 업데이트**: 2026-11-04 11:40 (KST)

---

## 1. 카톡 샌드(전송) 버튼 미작동 원인 및 새벽 발송의 비밀

### ① 새벽에는 어떻게 발송되었는가?
- 도쿄 VM(`38.60.212.31`)에 관리자가 RDP(원격 데스크톱)로 접속 중이었거나 Active GUI 세션이 살아 있었습니다.
- 윈도우 OS는 화면 세션이 열려 있을 때만 `ctypes.windll.user32.keybd_event(0x20)`(스페이스) -> `keybd_event(0x08)`(백스페이스)가 실제 물리 키로 카톡에 전달됩니다.
- 카카오톡은 물리 키 입력을 감지해야만 전송(Send) 버튼을 노란색(활성화)으로 켜며, 뒤이어 들어온 Enter 물리 키로 정상 발송되었습니다.

### ② 지금은 왜 샌드 버튼이 안 켜지고 안 눌리는가? (핵심 원인 2가지)
1. **[결정적] RDP(원격 데스크톱) 종료로 인한 세션 잠금(Session Disconnected)**:
   - 원격 데스크톱 창을 닫으면 윈도우 VM은 세션을 잠금(Lock) 처리합니다.
   - 이 상태에서는 `keybd_event`, `mouse_event`, `SetCursorPos` 등 모든 물리 입력 API가 OS 레벨에서 100% 무시(Discard)되어 전송 버튼이 깨어나지 않습니다.
2. **[코드 버그] 창 제목 인원수 불일치로 인한 조기 차단 (`_is_target_foreground` ABORT)**:
   - 카톡 오픈채팅방 창 제목에는 인원수가 반드시 붙습니다 (예: `[맘캘린더] 핫딜공지방 34` 또는 `[맘캘린더] 핫딜공지방 1`).
   - 현재 코드는 `_title(h) == TARGET_ROOM` 완전 일치를 검사하므로, 창 제목 뒤의 숫자 때문에 무조건 `False`가 되어 전송 버튼을 누르기도 전에 코드가 스스로 중단(ABORT)되고 있습니다.

---

## 2. 카톡 발송봇 코드 수정 (`tools/daily/kakao_pc_hotdeal_sender.py`)

아래 3가지를 파일에 즉시 반영해 주세요:

### ① 창 제목 검사 정규식 수정 (인원수 허용 및 타 채팅방 차단)
```python
def _is_target_title(title):
    # [맘캘린더] 핫딜공지방 및 인원수가 붙은 방만 100% 매칭, 개인톡/타 단톡방 원천 차단
    return bool(re.match(r'^\[맘캘린더\]\s*핫딜공지방(?:\s*\d+)?$', title.strip()))

def _is_target_foreground(chat_h):
    try:
        fg = win32gui.GetForegroundWindow()
        return _is_target_title(_title(fg))
    except Exception:
        return False
```

### ② 화면 잠김 상태에서도 전송 버튼을 깨우고 전송하는 확실한 메시지 방식 추가
물리 키(`keybd_event`)가 씹히는 환경을 대비해, 카톡 입력창 핸들(`edit_h`)에 `WM_CHAR` 및 `WM_KEYDOWN` Enter 메시지를 직접 전달합니다:
```python
# 클립보드 붙여넣기 직후
win32gui.SendMessage(edit_h, win32con.WM_PASTE, 0, 0)
time.sleep(0.2)

# 전송 버튼 강제 깨우기 (WM_CHAR 스페이스 + 백스페이스)
win32gui.SendMessage(edit_h, win32con.WM_CHAR, 0x20, 0)
time.sleep(0.05)
win32gui.SendMessage(edit_h, win32con.WM_CHAR, 0x08, 0)
time.sleep(0.1)

# 엔터 전송 (WM_KEYDOWN + WM_KEYUP 직접 전송)
win32gui.PostMessage(edit_h, win32con.WM_KEYDOWN, win32con.VK_RETURN, 0)
time.sleep(0.05)
win32gui.PostMessage(edit_h, win32con.WM_KEYUP, win32con.VK_RETURN, 0xC0000001)
```

### ③ 방해금지 시간 엄격 적용
- `QUIET_START_H = 22`, `QUIET_END_H = 9` (밤 22:00 ~ 아침 09:00 KST 발송 차단, DB에만 적재)
- 시간 계산 시 `timezone(timedelta(hours=9))` (KST 한국 표준시) 적용.

---

## 3. 도쿄 VM (`38.60.212.31`) 환경 조치 및 재가동

1. **현재 봇이 안 도는 이유**:
   - 아침에 사장님 지침으로 VM 내 `python.exe` 프로세스를 `taskkill` 종료했고, 작업 스케줄러(`RunKakaoBot`)를 비활성화(`Disable`)해 둔 상태입니다.
2. **RDP 창을 닫아도 GUI가 유지되도록 원격 종료 명령어 실행**:
   - VM에서 원격 데스크톱을 그냥 닫지 말고, CMD(관리자)에서 아래 명령어를 실행하여 콘솔 세션으로 연결을 넘긴 후 닫아야 화면 잠금이 안 걸립니다:
   ```cmd
   for /f "skip=1 tokens=3" %s in ('query user %USERNAME%') do %windir%\System32\tscon.exe %s /dest:console
   ```
3. 최신 코드를 git pull 받고 봇 프로세스를 재가동합니다.

---

## 4. 핫딜 수집 출처 및 수익링크 파이프라인 전모

1. **수집 실행 엔진**:
   - `.github/workflows/hotdeal-cloud.yml` (매시 17분, 47분 / 30분 간격 클라우드 무인 실행)
   - 실행 파일: `tools/daily/baby_hotdeal_auto.py`
2. **핫딜 3대 수집 출처**:
   ① `collect_from_jirum_alarm()`: **지름알림(jirum.net) API** -> 뽐뿌, 딜바다, 에펨코리아, 어미새, 루리웹 등 16대 커뮤니티 핫딜 직수집.
   ② `collect_from_bbhd()`: **베이비핫딜(bbhd.kr)** 자유게시판 -> 뽐뿌/맘이베베 육아·생필품 핫딜 직수집.
   ③ `collect_from_3ha_klook()`: **세시간전(3hoursahead)** 제휴 -> **클룩(Klook)** 여행/숙박/입장권 특가 수집.
3. **수익링크 변환 엔진 (CPA)**:
   - **쿠팡**: `coupang-hotdeal` Supabase 함수 호출 -> 사장님 쿠팡 파트너스 딥링크로 변환.
   - **종합몰/오픈마켓(30+곳)**: 11번가, 지마켓, 옥션, 롯데ON, SSG, 보리보리 등 -> 링크프라이스 ID(`A100706561`) 딥링크로 변환.
   - **여행(클룩)**: 세시간전 AID(`140703`) 제휴 딥링크로 변환.
4. **DB 및 발송**:
   - Supabase `hotdeals` 테이블에 저장 -> 도쿄 VM 카톡봇(`kakao_pc_hotdeal_sender.py`)이 3~5분 주기로 읽어 단톡방 발송.

---

## 5. 기타 시스템 오류 처리 현황 (참고용)
- `tools/daily/cloud_jobs.mjs`: `job === 'hotdeal'` 정상 종료(exit 0) 방어 분기 커밋(`f05a5061`) 완료 (테스트 통과).
- `seo-daily.yml`: `--autostash` 옵션 반영 완료 (`1ce7f01a`).
- Supabase `error_radar`: 정상 복구 완료 (최근 1시간 5xx 0건).
