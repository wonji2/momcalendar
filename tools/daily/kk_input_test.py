# 카톡 입력칸에 글을 넣고 전송 버튼이 켜지는 방식을 가려내는 시험(발송하지 않는다). 사용: python kk_input_test.py <0|1|2|3>
#  0 실제 Ctrl+V 키  1 붙여넣기+스캔코드 키(keybd_event)  2 붙여넣기+SendInput 스캔코드  3 붙여넣기+WM_CHAR 메시지
import win32gui, win32con, win32clipboard, ctypes, time, sys
u = ctypes.windll.user32
N = sys.argv[1]
def find():
    r = []
    def ew(h, _):
        if 'EVA_Window_Dblclk' in win32gui.GetClassName(h) and win32gui.GetWindowText(h).startswith('['):
            e = []
            def ec(c, _):
                if 'RICHEDIT50W' in win32gui.GetClassName(c): e.append(c)
            win32gui.EnumChildWindows(h, ec, None)
            if e: r.append((h, e[0]))
    win32gui.EnumWindows(ew, None)
    return r[0]
class KI(ctypes.Structure):
    _fields_ = [('wVk', ctypes.c_ushort), ('wScan', ctypes.c_ushort), ('dwFlags', ctypes.c_ulong), ('time', ctypes.c_ulong), ('dwExtraInfo', ctypes.c_size_t)]
class UN(ctypes.Union):
    _fields_ = [('ki', KI), ('pad', ctypes.c_byte * 32)]
class IN(ctypes.Structure):
    _fields_ = [('type', ctypes.c_ulong), ('u', UN)]
def si(vk, up):
    sc = u.MapVirtualKeyW(vk, 0)
    i = IN(1, UN(KI(0, sc, 0x8 | (2 if up else 0), 0, 0)))
    u.SendInput(1, ctypes.byref(i), ctypes.sizeof(IN))
def tap(vk):
    sc = u.MapVirtualKeyW(vk, 0)
    u.keybd_event(vk, sc, 0, 0); time.sleep(0.05); u.keybd_event(vk, sc, 2, 0); time.sleep(0.05)
h, e = find()
if N == '6':
    print('chat', win32gui.GetClassName(h), win32gui.GetWindowRect(h), 'edit', win32gui.GetWindowRect(e))
    def dump(c, d):
        t = win32gui.GetWindowText(c)
        print('  ' * d, win32gui.GetClassName(c), repr(t[:20]), win32gui.GetWindowRect(c), 'vis', win32gui.IsWindowVisible(c), 'en', win32gui.IsWindowEnabled(c))
        win32gui.EnumChildWindows(c, lambda cc, _: None, None)
    win32gui.EnumChildWindows(h, lambda c, _: dump(c, 1), None)
    sys.exit(0)
win32gui.SendMessage(e, win32con.WM_SETTEXT, 0, '')
win32clipboard.OpenClipboard(); win32clipboard.EmptyClipboard(); win32clipboard.SetClipboardText(('블루독 베이직 트레이닝 상하세트\n🔥 체감가 20,590원\n\n👉 특가 구매링크:\nhttps://momcalendar.com/r.html?id=1847') if N == '7' else 'TEST PASTE', win32clipboard.CF_UNICODETEXT); win32clipboard.CloseClipboard()
win32gui.ShowWindow(h, 9); win32gui.SetForegroundWindow(h); time.sleep(0.6)
print('foreground ok:', win32gui.GetForegroundWindow() == h)
r = win32gui.GetWindowRect(e); u.SetCursorPos((r[0] + r[2]) // 2, (r[1] + r[3]) // 2); time.sleep(0.1)
u.mouse_event(2, 0, 0, 0, 0); time.sleep(0.05); u.mouse_event(4, 0, 0, 0, 0); time.sleep(0.3)
if N == '0':
    u.keybd_event(0x11, 0, 0, 0); time.sleep(0.05); tap(0x56); u.keybd_event(0x11, 0, 2, 0)
else:
    win32gui.SendMessage(e, win32con.WM_PASTE, 0, 0)
time.sleep(0.4)
if N == '1': tap(0x41); tap(0x08)
if N == '2':
    for vk in (0x41, 0x08): si(vk, False); time.sleep(0.05); si(vk, True); time.sleep(0.05)
if N == '8':   # 입력칸에 포커스를 강제로 준 뒤 키 입력
    import win32process
    me = ctypes.windll.kernel32.GetCurrentThreadId()
    tid = win32process.GetWindowThreadProcessId(e)[0]
    print('attach', u.AttachThreadInput(me, tid, True), 'setfocus', u.SetFocus(e), 'GetFocus==edit', u.GetFocus() == e)
    tap(0x41); tap(0x42)
    u.AttachThreadInput(me, tid, False)
if N == '10':   # 포커스 강제 + 스페이스·백스페이스(원래 방식)
    import win32process
    me = ctypes.windll.kernel32.GetCurrentThreadId()
    tid = win32process.GetWindowThreadProcessId(e)[0]
    u.AttachThreadInput(me, tid, True); u.SetFocus(e)
    tap(0x20); tap(0x08)
    u.AttachThreadInput(me, tid, False)
if N == '9':   # 입력칸에 WM_KEYDOWN/UP 로 키를 보낸다(스캔코드 포함)
    for vk in (0x41, 0x42):
        sc = u.MapVirtualKeyW(vk, 0)
        win32gui.PostMessage(e, 0x0100, vk, 1 | (sc << 16)); time.sleep(0.05)
        win32gui.PostMessage(e, 0x0101, vk, 1 | (sc << 16) | (3 << 30)); time.sleep(0.05)
if N == '4': tap(0x41); tap(0x42)
if N == '5':
    for vk in (0x41, 0x42): si(vk, False); time.sleep(0.05); si(vk, True); time.sleep(0.05)
if N == '3':
    win32gui.SendMessage(e, 0x0102, 0x41, 0); time.sleep(0.1); win32gui.SendMessage(e, 0x0102, 0x08, 0)
print('variant', N, '입력칸 글자 수:', win32gui.SendMessage(e, 0x000E, 0, 0), '— 15초 안에 Send 버튼이 켜졌는지 화면을 봅니다')
time.sleep(40 if N == '7' else 15)
if N != '7': win32gui.SendMessage(e, win32con.WM_SETTEXT, 0, '')
