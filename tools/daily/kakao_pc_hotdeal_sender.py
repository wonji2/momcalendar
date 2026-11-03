import os, sys, time, ctypes, win32gui, win32con, win32clipboard, re, json, urllib.request
from datetime import datetime, timedelta, timezone

sys.stdout.reconfigure(encoding='utf-8')
sys.stderr.reconfigure(encoding='utf-8')

SUPABASE_URL = 'https://hycaqsqeogjtbscmzrtm.supabase.co'
SUPABASE_ANON_KEY = 'sb_publishable_u4hR4mdNTSss3kdjFH6R5Q_iuJ2MuGE'
HISTORY_FILE = r'C:\MomcalBot\kakao_posted_deals.json'
LOG_FILE = r'C:\MomcalBot\bot.log'

# 🔴 2026-11-04 사장님 긴급 지침(핫딜 카톡 발송봇 결함 3건) — scratchpad/ORDER_CLAUDE_HOTDEAL_BOT_FIX.md
# ① 보내는 방은 이 제목과 글자 하나까지 같은 창 하나뿐이다. 키워드·부분일치·「아무 카톡 창」 금지(다른 채팅방에 날아간 사고).
TARGET_ROOM = '[맘캘린더] 핫딜공지방'
# ② 밤 23:00 ~ 아침 08:00(한국시간)에는 카톡으로 아무것도 보내지 않는다(새벽 3시반 발송 사고). 그때 올라온 딜은 DB 에만 쌓인다.
QUIET_START_H, QUIET_END_H = 23, 8
# ③ 시간 계산은 PC 시계·시간대 설정과 상관없이 항상 한국시간(UTC+9)으로 한다.
KST = timezone(timedelta(hours=9))
# 아침 8시에 밤사이 딜이 한꺼번에 쏟아지지 않게, 올라온 지 이 시간이 지난 딜은 보내지 않고 처리 끝으로만 표시한다.
MAX_DEAL_AGE_H = 6

def now_kst():
    return datetime.now(KST)

def is_quiet_hour(dt=None):
    h = (dt or now_kst()).hour
    return h >= QUIET_START_H or h < QUIET_END_H

def _too_old(deal, hours=MAX_DEAL_AGE_H):
    try:
        t = datetime.fromisoformat(str(deal.get('created_at')).replace('Z', '+00:00'))
        if t.tzinfo is None: t = t.replace(tzinfo=timezone.utc)
        return (datetime.now(timezone.utc) - t) > timedelta(hours=hours)
    except Exception:
        return False   # 시각을 못 읽으면 막지 않는다(발송 여부는 신규 id 판정이 한다)

def log(msg):
    t = now_kst().strftime('%Y-%m-%d %H:%M:%S')
    line = f'[{t}] {msg}'
    print(line)
    try:
        with open(LOG_FILE, 'a', encoding='utf-8') as f:
            f.write(line + '\n')
            f.flush()
    except: pass

def load_posted_history():
    if os.path.exists(HISTORY_FILE):
        try:
            with open(HISTORY_FILE, 'r', encoding='utf-8') as f:
                return set(json.load(f))
        except: return set()
    return set()

def save_posted_history(posted_ids):
    try:
        ids_list = list(posted_ids)[-500:]
        with open(HISTORY_FILE, 'w', encoding='utf-8') as f:
            json.dump(ids_list, f, ensure_ascii=False)
    except Exception as e:
        log(f'[ERROR] history error: {e}')

def get_latest_hotdeals(limit=10):
    try:
        import ssl
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        url = f'{SUPABASE_URL}/rest/v1/hotdeals?select=id,title,price,img_url,mall,link,created_at&order=id.desc&limit={limit}'
        req = urllib.request.Request(url, headers={
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': f'Bearer {SUPABASE_ANON_KEY}'
        })
        with urllib.request.urlopen(req, timeout=10, context=ctx) as resp:
            return json.loads(resp.read().decode('utf-8'))
    except Exception as e:
        log(f'[WARN] fetch error: {e}')
        return []

def clean_deal_title(t):
    if not t: return ''
    s = str(t).strip()
    s = re.sub(r'^(?:\[[^\]]+\]|\([^\)]+\)|(?:쿠팡|지마켓|11번가|옥션|위메프|티몬|네이버|SSG)\))\s*', '', s, flags=re.IGNORECASE)
    s = re.sub(r'\s*[\d,.]+\s*원?(?:\s*(?:무료|무배|유료|착불))?\s*$', '', s, flags=re.IGNORECASE)
    s = re.sub(r'\s*(?:핫딜|특가)\s*$', '', s, flags=re.IGNORECASE)
    return s.strip() or t

def calculate_unit_price(title, price):
    if not price or price <= 0 or not title: return ''
    t = str(title).lower()
    m_kg = re.search(r'(\d+(?:\.\d+)?)\s*kg(?![a-z])', t)
    if m_kg:
        kg = float(m_kg.group(1))
        if kg > 0:
            unit_val = int(round(price / kg))
            if 0 < unit_val < price: return f'(1kg당 {unit_val:,}원)'
    m_count = re.search(r'(\d+)\s*(개|입|팩|박스|병|캔|포|롤|통|세트)', t)
    m_g = re.search(r'(\d+(?:\.\d+)?)\s*g(?![a-z가-힣])', t)
    if m_count:
        cnt = int(m_count.group(1))
        unit_word = m_count.group(2)
        if cnt > 1:
            unit_val = int(round(price / cnt))
            if 0 < unit_val < price: return f'(1{unit_word}당 {unit_val:,}원)'
    elif m_g:
        g = float(m_g.group(1))
        if g >= 100:
            unit_val = int(round((price / g) * 100))
            if 0 < unit_val < price: return f'(100g당 {unit_val:,}원)'
    return ''

def format_kakao_message(deal):
    raw_title = deal.get('title', '').strip()
    price = deal.get('price', 0)
    deal_id = deal.get('id')
    clean_title = clean_deal_title(raw_title) or raw_title
    price_str = f'{price:,}원' if isinstance(price, (int, float)) and price > 0 else '가격 변동'
    unit_str = calculate_unit_price(clean_title, price)
    second_line = f'🔥 체감가 {price_str}'
    if unit_str: second_line += f' {unit_str}'
    clean_momcal_link = f'https://momcalendar.com/r.html?id={deal_id}' if deal_id else deal.get('link')
    return f'{clean_title}\n{second_line}\n\n👉 특가 구매링크:\n{clean_momcal_link}'

def _title(h):
    try: return win32gui.GetWindowText(h).strip()
    except Exception: return ''

def find_chat_and_edit():
    """제목이 TARGET_ROOM 과 정확히 같은 카톡 창과 그 입력칸만 돌려준다. 못 찾으면 (None, None)."""
    found = []
    def enum_win(h, _):
        try:
            if 'EVA_Window_Dblclk' not in win32gui.GetClassName(h): return
            if _title(h) != TARGET_ROOM: return
            edits = []
            def enum_c(ch, __):
                if 'RICHEDIT50W' in win32gui.GetClassName(ch): edits.append(ch)
            win32gui.EnumChildWindows(h, enum_c, None)
            if edits: found.append((h, edits[0]))
        except Exception:
            pass
    win32gui.EnumWindows(enum_win, None)
    if not found: return None, None
    return found[0]

def _is_target_foreground(chat_h):
    """지금 맨 앞 창이 바로 그 방인지(물리 클릭·키 입력은 맨 앞 창으로 가므로 입력 직전마다 다시 본다)."""
    try:
        fg = win32gui.GetForegroundWindow()
        return fg == chat_h and _title(fg) == TARGET_ROOM
    except Exception:
        return False

def _clear_edit(edit_h):
    try: win32gui.SendMessage(edit_h, win32con.WM_SETTEXT, 0, '')
    except Exception: pass

def send_message(msg):
    if is_quiet_hour():
        log('[QUIET] 방해금지 시간(23~08시) — 발송 안 함')
        return False
    chat_h, edit_h = find_chat_and_edit()
    if not chat_h or not edit_h:
        log(f'[WAIT] 「{TARGET_ROOM}」 창을 찾을 수 없습니다. (다른 창에는 보내지 않습니다)')
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

    # 2. 채팅창 활성화 — 그 방이 맨 앞이 되지 않으면 아무것도 입력하지 않고 멈춘다
    try:
        win32gui.ShowWindow(chat_h, win32con.SW_RESTORE)
        win32gui.SetForegroundWindow(chat_h)
    except: pass
    time.sleep(0.3)
    if not _is_target_foreground(chat_h):
        log('[ABORT] 대상 방이 맨 앞에 오지 않았습니다 — 입력하지 않고 건너뜁니다')
        return False

    # 3. 입력창 중앙 마우스 클릭 (맨 앞이 여전히 그 방일 때만)
    try:
        rect = win32gui.GetWindowRect(edit_h)
        x = (rect[0] + rect[2]) // 2
        y = (rect[1] + rect[3]) // 2
        ctypes.windll.user32.SetCursorPos(x, y)
        time.sleep(0.05)
        if not _is_target_foreground(chat_h):
            log('[ABORT] 클릭 직전 맨 앞 창이 바뀌었습니다 — 건너뜁니다')
            return False
        ctypes.windll.user32.mouse_event(2, 0, 0, 0, 0) # MOUSEEVENTF_LEFTDOWN
        time.sleep(0.05)
        ctypes.windll.user32.mouse_event(4, 0, 0, 0, 0) # MOUSEEVENTF_LEFTUP
    except: pass
    time.sleep(0.1)

    # 4. 클립보드 붙여넣기 (입력칸 핸들에 직접 보낸다 — 대상 방의 칸 밖으로는 안 간다)
    win32gui.SendMessage(edit_h, win32con.WM_PASTE, 0, 0)
    time.sleep(0.2)

    # 🚨 [길아 사장님 핫픽스] 스페이스 + 백스페이스 입력으로 카톡 전송(Send) 버튼 강제 활성화!
    #    키 입력은 맨 앞 창으로 가므로 시작 전에 다시 확인한다. 어긋나면 붙여 둔 글을 지우고 멈춘다.
    if not _is_target_foreground(chat_h):
        _clear_edit(edit_h)
        log('[ABORT] 전송 직전 맨 앞 창이 바뀌었습니다 — 입력 내용을 지우고 건너뜁니다')
        return False
    ctypes.windll.user32.keybd_event(0x20, 0, 0, 0) # Space Down
    time.sleep(0.05)
    ctypes.windll.user32.keybd_event(0x20, 0, 2, 0) # Space Up
    time.sleep(0.05)
    ctypes.windll.user32.keybd_event(0x08, 0, 0, 0) # Backspace Down
    time.sleep(0.05)
    ctypes.windll.user32.keybd_event(0x08, 0, 2, 0) # Backspace Up
    time.sleep(0.1)

    # 5. 엔터 물리 전송 — 한 번 누를 때마다 맨 앞 창이 그 방인지 본다(어긋나면 즉시 중단)
    for _ in range(3):
        if not _is_target_foreground(chat_h):
            log('[ABORT] 엔터 도중 맨 앞 창이 바뀌었습니다 — 중단합니다')
            return False
        ctypes.windll.user32.keybd_event(0x0D, 0, 0, 0)
        time.sleep(0.05)
        ctypes.windll.user32.keybd_event(0x0D, 0, 2, 0)
        time.sleep(0.1)

    log('[SUCCESS] 핫딜 단톡방 전송 성공!')
    return True

def _single_instance():
    """같은 봇이 두 개 이상 돌면 같은 딜이 두 번 나간다 — 먼저 뜬 하나만 남긴다."""
    try:
        import win32event, win32api, winerror
        h = win32event.CreateMutex(None, False, 'Global\\MomcalHotdealKakaoBot')
        if win32api.GetLastError() == winerror.ERROR_ALREADY_EXISTS:
            log('[EXIT] 이미 다른 봇이 돌고 있어 종료합니다')
            sys.exit(0)
        return h
    except SystemExit:
        raise
    except Exception:
        return None

def run_loop():
    _lock = _single_instance()
    log(f'=== 맘캘린더 핫딜 카톡방 자동 발송 봇 가동 — 대상 「{TARGET_ROOM}」 · 발송 08:00~23:00(KST) ===')
    posted_ids = load_posted_history()
    last_quiet_log = None
    while True:
        try:
            if is_quiet_hour():
                key = now_kst().strftime('%Y-%m-%d %H')
                if key != last_quiet_log:
                    log('[QUIET] 방해금지 시간(23~08시, 한국시간) — 핫딜은 DB 에만 쌓이고 카톡 발송은 쉽니다')
                    last_quiet_log = key
                time.sleep(60)
                continue
            deals = get_latest_hotdeals(limit=5)
            for deal in reversed(deals):
                deal_id = deal.get('id')
                if deal_id in posted_ids:
                    continue
                if _too_old(deal):
                    log(f'[SKIP] ID {deal_id} 올라온 지 {MAX_DEAL_AGE_H}시간이 지나 보내지 않습니다')
                    posted_ids.add(deal_id)
                    save_posted_history(posted_ids)
                    continue
                if is_quiet_hour():   # 보내는 도중 23시를 넘기면 거기서 멈춘다
                    break
                msg = format_kakao_message(deal)
                log(f'[*] 신규 핫딜 발송 시도: ID {deal_id} - {deal.get("title", "")[:20]}')
                sent = send_message(msg)
                if sent:
                    posted_ids.add(deal_id)
                    save_posted_history(posted_ids)
                    time.sleep(3)
        except Exception as e:
            log(f'[LOOP ERROR] {e}')
        time.sleep(30)

if __name__ == '__main__':
    run_loop()
