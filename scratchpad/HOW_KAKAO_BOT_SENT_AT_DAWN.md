# 🕵️‍♂️ 카카오톡 핫딜봇: 새벽 3시 30분 실제 발송 코드 및 작동 메커니즘 완전 분석

**문서 위치**: `scratchpad/HOW_KAKAO_BOT_SENT_AT_DAWN.md`  
**수신**: 클로드 코드 (Claude Code) & 맘캘린더 개발팀  
**작성 목적**: 11월 4일 새벽 3시 30분에 도쿄 VM(`38.60.212.31`)에서 실제로 카카오톡 발송이 성공했던 **정확한 코드 전문과 윈도우 OS 동작 원리**를 공유하여, 현재 Send 버튼 비활성화 문제를 영구 해결하기 위함.

---

## 1. 새벽 3시 30분에 실제로 돌아갔던 커밋 및 코드 전문

새벽 3시 30분 당시 도쿄 VM에서 실행 중이던 코드는 **커밋 `1ecf7ec9` (2026-11-03 15:38 KST 커밋본)**이었습니다.  
이 코드는 11월 4일 아침 08:29에 클로드 코드가 `1ce7f01a`를 푸시하기 전까지 도쿄 VM에서 단 한 번도 바뀌지 않고 계속 돌아가고 있었습니다.

### 📄 새벽 당시 실제 발송 함수 (`send_message`) 코드 전문:
```python
def send_message(msg):
    chat_h, edit_h = find_chat_and_edit()
    if not chat_h or not edit_h:
        log('[WAIT] 카카오톡 채팅창을 찾을 수 없습니다.')
        return False

    # 1. 클립보드 복사
    for _ in range(5):
        try:
            win32clipboard.OpenClipboard()
            win32clipboard.EmptyClipboard()
            win32clipboard.SetClipboardText(msg, win32clipboard.CF_UNICODETEXT)
            win32clipboard.CloseClipboard()
            break
        except: time.sleep(0.1)

    # 2. 채팅창 활성화
    try:
        win32gui.ShowWindow(chat_h, win32con.SW_RESTORE)
        win32gui.SetForegroundWindow(chat_h)
    except: pass
    time.sleep(0.1)

    # 3. 입력창 중앙 마우스 클릭
    try:
        rect = win32gui.GetWindowRect(edit_h)
        x = (rect[0] + rect[2]) // 2
        y = (rect[1] + rect[3]) // 2
        ctypes.windll.user32.SetCursorPos(x, y)
        time.sleep(0.05)
        ctypes.windll.user32.mouse_event(2, 0, 0, 0, 0) # MOUSEEVENTF_LEFTDOWN
        time.sleep(0.05)
        ctypes.windll.user32.mouse_event(4, 0, 0, 0, 0) # MOUSEEVENTF_LEFTUP
    except: pass
    time.sleep(0.1)

    # 4. 클립보드 붙여넣기 (WM_PASTE)
    win32gui.SendMessage(edit_h, win32con.WM_PASTE, 0, 0)
    time.sleep(0.2)

    # 🚨 [길아 사장님 핫픽스] 스페이스 + 백스페이스 물리 키 입력으로 카톡 전송(Send) 버튼 강제 활성화!
    ctypes.windll.user32.keybd_event(0x20, 0, 0, 0) # Space Down
    time.sleep(0.05)
    ctypes.windll.user32.keybd_event(0x20, 0, 2, 0) # Space Up
    time.sleep(0.05)
    ctypes.windll.user32.keybd_event(0x08, 0, 0, 0) # Backspace Down
    time.sleep(0.05)
    ctypes.windll.user32.keybd_event(0x08, 0, 2, 0) # Backspace Up
    time.sleep(0.1)

    # 5. 엔터 물리 전송 (하드웨어 이벤트 3회 연타)
    for _ in range(3):
        ctypes.windll.user32.keybd_event(0x0D, 0, 0, 0) # Enter Down
        time.sleep(0.05)
        ctypes.windll.user32.keybd_event(0x0D, 0, 2, 0) # Enter Up
        time.sleep(0.3)

    log('[SUCCESS] 핫딜 단톡방 전송 성공!')
    return True
```

---

## 2. 클로드 코드의 실측과 새벽 성공의 차이점 (핵심 메커니즘)

### 클로드 코드가 지적한 내용:
> "가이드 ② (WM_CHAR와 Enter를 프로그램으로 직접 보내는 방식)는 반영하지 않았습니다. 최신 코드에 이미 들어 있고, 11월 2일과 4일 실측에서 카톡이 이런 프로그램 입력을 무시해 Send 버튼이 안 켜졌습니다."

**👉 클로드 코드의 실측이 100% 맞습니다!**  
카카오톡 PC버전의 입력창(`RICHEDIT50W`)은 보안 및 매크로 방지 목적으로 Windows 메시지 큐의 `WM_CHAR`, `WM_KEYDOWN` 같은 가상 윈도우 메시지를 완전히 무시합니다. 그래서 `SendMessage(edit_h, WM_CHAR, ...)`로는 Send 버튼이 절대로 안 켜집니다.

### 그렇다면 새벽에는 왜 성공했는가?
새벽 코드에서는 `WM_CHAR`를 쓴 것이 아니라, **Windows 커널 레벨의 하드웨어 입력 에뮬레이션 API인 `ctypes.windll.user32.keybd_event`와 `mouse_event`**를 사용했습니다.

1. **하드웨어 인터럽트 시뮬레이션**:
   - `keybd_event(0x20)` ➔ `keybd_event(0x08)`는 카카오톡 입장에서는 "사용자가 진짜 키보드로 스페이스를 쳤다가 백스페이스를 눌렀다"고 완벽히 속게 만듭니다.
   - 그래서 회색(비활성화)이던 우측 하단 Send 버튼이 **노란색(활성화)**으로 켜졌습니다.
2. **뒤이어 들어온 엔터 키**:
   - 전송 버튼이 켜진 상태에서 `keybd_event(0x0D)`(Enter)가 들어오자마자 카톡이 메시지를 발송했습니다.

---

## 3. 그런데 왜 지금은 안 되는가? (도쿄 VM의 결정적 차이)

**`keybd_event`와 `mouse_event`의 치명적인 한계: "Active GUI 데스크톱 세션 필수"**

- **새벽 3시 30분 상황**:
  - 관리자가 도쿄 VM에 RDP(원격 데스크톱)로 접속 중이었거나, 화면 세션이 살아있는 상태였습니다. 화면 출력 버퍼가 열려 있으므로 `keybd_event`가 카톡 창으로 온전히 전달되었습니다.
- **지금 상황**:
  - 원격 데스크톱 창의 X 버튼을 눌러 닫으면, 윈도우 OS는 세션을 **"Disconnected(잠금)"** 상태로 바꿉니다.
  - 세션이 잠기면 Windows 커널은 **모든 `keybd_event`, `mouse_event`, `SetCursorPos` 입력을 OS 레벨에서 100% 버려버립니다(Discard).**
  - 따라서 RDP가 닫힌 상태에서는 스페이스+백스페이스가 카톡에 닿지 않아 Send 버튼이 안 켜지고 글이 입력칸에 쌓이는 것입니다.

---

## 4. 클로드 코드가 해결할 수 있는 실전 솔루션

### 솔루션 A. 카카오톡 Send 버튼 컨트롤 직접 클릭 (`BM_CLICK`)
카톡 창의 전송 버튼은 별도의 자식 윈도우 핸들을 가지고 있습니다. 마우스 좌표 클릭(`mouse_event`) 대신, 자식 윈도우를 순회하여 버튼 핸들을 찾아 `BM_CLICK`을 날리는 방식입니다:
```python
def find_send_button(chat_h):
    buttons = []
    def enum_c(ch, _):
        # 카카오톡 전송 버튼의 클래스명 또는 텍스트 확인
        cls = win32gui.GetClassName(ch)
        txt = win32gui.GetWindowText(ch)
        if 'Button' in cls or txt == '전송':
            buttons.append(ch)
    win32gui.EnumChildWindows(chat_h, enum_c, None)
    return buttons[0] if buttons else None

# 전송 실행
btn_h = find_send_button(chat_h)
if btn_h:
    win32gui.SendMessage(btn_h, win32con.BM_CLICK, 0, 0)
```

### 솔루션 B. RDP 연결 종료 시 `tscon`으로 세션을 콘솔로 유지 (가장 완벽한 인프라 해결)
도쿄 VM에서 원격 데스크톱을 종료할 때 그냥 X를 닫지 않고, 아래 명령어를 실행하면 원격이 닫혀도 가상 윈도우가 0번 콘솔 세션(화면이 켜진 상태)으로 유지되어 `keybd_event`가 24시간 내내 작동합니다:
```cmd
for /f "skip=1 tokens=3" %s in ('query user %USERNAME%') do %windir%\System32\tscon.exe %s /dest:console
```

### 솔루션 C. 새벽 코드 원형 복원 + 창 제목 정규식 결합
새벽에 100% 성공했던 `1ecf7ec9`의 물리 키 로직(`keybd_event` 스페이스+백스페이스+엔터)에, 오늘 아침 수정한 **창 제목 정규식(`_is_target_title`)**과 **야간 방해금지 시간(22:00~09:00)**을 결합하는 것이 가장 안정적인 최종형입니다.
