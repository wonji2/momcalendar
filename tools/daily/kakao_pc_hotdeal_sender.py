import os, sys, time, random, ctypes, win32gui, win32con, win32clipboard, re, json, urllib.request
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
# 카톡 방 창 제목 끝에는 인원수가 붙을 수 있다(「[맘캘린더] 핫딜공지방 34」). 방 이름 + 선택적 숫자만 전체 일치로 받고, 다른 방·개인톡은 거부한다(2026-11-04 가이드 ①).
TARGET_TITLE_RE = re.compile(r'^\[맘캘린더\]\s*핫딜공지방(?:\s*\d+)?$')
def _is_target_title(t):
    return bool(TARGET_TITLE_RE.match(str(t or '').strip()))
# ② 밤 22:00 ~ 아침 09:00(한국시간, 2026-11-04 가이드 ③)에는 카톡으로 아무것도 보내지 않는다(새벽 3시반 발송 사고). 그때 올라온 딜은 DB 에만 쌓인다.
QUIET_START_H, QUIET_END_H = 22, 9
# ③ 시간 계산은 PC 시계·시간대 설정과 상관없이 항상 한국시간(UTC+9)으로 한다.
KST = timezone(timedelta(hours=9))
# 방해금지 시간(23~08시)에 쌓인 딜은 아침 8시부터 **한꺼번에가 아니라 하나씩 간격을 두고** 순서대로 보낸다(사장님 2026-11-04 「한번엔 아니지만 순차적으로 오전에 좀 많이」).
#   · 보내는 간격: 매번 GAP_MIN_S~GAP_MAX_S 초 사이 무작위(몰아치기·봇 티 방지). 낮에 새 딜이 겹쳐 올라와도 같은 간격으로 풀린다.
#   · 밤사이 쌓인 딜을 놓치지 않게 한 번에 FETCH_LIMIT 개까지 읽고, 올라온 지 MAX_DEAL_AGE_H 시간이 지난 딜은 보내지 않고 처리 끝으로만 표시한다.
FETCH_LIMIT = 40
MAX_DEAL_AGE_H = 14
GAP_MIN_S, GAP_MAX_S = 180, 300
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

def deal_gate(deal):
    """딜 하나를 보낼지 정한다 -> ('send' | 'drop', 사유).
    가격이 올랐거나(changed) 품절(soldout)로 **명확히 확인된 딜만** 뺀다.
    same·fresh·unknown(쿠팡·지마켓 봇체크로 못 읽음)·확인 전·그 밖의 값은 전부 보낸다(사장님 2026-11-04) —
    수집 자체가 검증된 데이터라, 가격을 못 읽는다고 발송을 막지 않는다. 대기(wait)는 없다."""
    st = deal.get('price_status')
    if st == 'changed':
        return 'drop', '가격이 달라짐(확인됨)'
    if st == 'soldout':
        return 'drop', '품절(확인됨)'
    return 'send', '발송'

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
        url = f'{SUPABASE_URL}/rest/v1/hotdeals?select=id,title,price,img_url,mall,link,created_at,price_status&order=id.desc&limit={limit}'
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
            if not _is_target_title(_title(h)): return
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
        return fg == chat_h and _is_target_title(_title(fg))
    except Exception:
        return False

def _clear_edit(edit_h):
    try: win32gui.SendMessage(edit_h, win32con.WM_SETTEXT, 0, '')
    except Exception: pass

def _edit_len(edit_h):
    """입력칸에 남은 글자 수. 못 읽으면 None(발송 확인을 건너뛴다)."""
    try:
        n = win32gui.SendMessage(edit_h, 0x000E, 0, 0)   # WM_GETTEXTLENGTH
        return n if isinstance(n, int) else None
    except Exception:
        return None

def _post_key(edit_h, vk):
    """입력칸 핸들에 키 메시지를 직접 보낸다 — 원격 데스크톱이 끊기거나 창이 맨 앞이 아니어도 전달된다."""
    try:
        win32gui.PostMessage(edit_h, win32con.WM_KEYDOWN, vk, 0)
        time.sleep(0.03)
        win32gui.PostMessage(edit_h, win32con.WM_KEYUP, vk, 0xC0000001)
    except Exception:
        pass

def _click_send_button(chat_h):
    """전송 버튼은 별도 창이 아니라 화면에 그려진 버튼이다 — 창 오른쪽 아래 모서리 기준 위치를 마우스로 누른다.
    (이 PC 에서는 keybd_event·SendInput 키 입력이 카톡에 안 들어가고 마우스 클릭만 먹었다. 맨 앞이 그 방일 때만 누른다.)"""
    try:
        if not _is_target_foreground(chat_h): return False
        l, t, r, b = win32gui.GetWindowRect(chat_h)
        x = int(r - (r - l) * 0.089)
        y = int(b - (b - t) * 0.0414)
        ctypes.windll.user32.SetCursorPos(x, y)
        time.sleep(0.1)
        if not _is_target_foreground(chat_h): return False
        ctypes.windll.user32.mouse_event(2, 0, 0, 0, 0)
        time.sleep(0.05)
        ctypes.windll.user32.mouse_event(4, 0, 0, 0, 0)
        return True
    except Exception:
        return False

def _wake_send_button(edit_h):
    """붙여넣기만으로는 카톡이 입력을 못 알아봐 전송 버튼이 꺼진 채 있다 — 글자 하나를 넣었다 지워 깨운다."""
    try:
        win32gui.SendMessage(edit_h, 0x0102, 0x20, 0)   # WM_CHAR 스페이스
        time.sleep(0.05)
    except Exception:
        pass
    _post_key(edit_h, 0x08)   # 백스페이스
    time.sleep(0.1)

def send_message(msg):
    if is_quiet_hour():
        log('[QUIET] 방해금지 시간(22~09시) — 발송 안 함')
        return False
    chat_h, edit_h = find_chat_and_edit()
    if not chat_h or not edit_h:
        log(f'[WAIT] 「{TARGET_ROOM}」 창을 찾을 수 없습니다. (다른 창에는 보내지 않습니다)')
        return False

    # 0. 지난번 실패로 남은 글이 있으면 비운다(안 비우면 딜이 입력칸에 계속 쌓인다)
    _clear_edit(edit_h)

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
    _wake_send_button(edit_h)   # 메시지 방식으로도 한 번 깨운다(아래 물리 키 입력은 원격 화면이 끊기면 안 먹는다)

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

    # 5. 엔터 — 물리 키 → 안 나가면 메시지 방식. 입력칸이 비었는지 보고 나간 걸 확인한다(안 나갔으면 지우고 실패로 돌려 다음에 다시)
    for _ in range(3):
        if not _is_target_foreground(chat_h):
            log('[ABORT] 엔터 도중 맨 앞 창이 바뀌었습니다 — 중단합니다')
            _clear_edit(edit_h)
            return False
        ctypes.windll.user32.keybd_event(0x0D, 0, 0, 0)
        time.sleep(0.05)
        ctypes.windll.user32.keybd_event(0x0D, 0, 2, 0)
        time.sleep(0.3)
        if _edit_len(edit_h) in (0, None): break
    if _edit_len(edit_h):
        log('[RETRY] 엔터로 안 나가 전송 버튼을 마우스로 누릅니다')
        _wake_send_button(edit_h)
        _click_send_button(chat_h)
        time.sleep(0.5)
    if _edit_len(edit_h):
        log('[RETRY] 그래도 안 나가 메시지 방식으로 다시 보냅니다')
        for _ in range(3):
            _wake_send_button(edit_h)
            _post_key(edit_h, 0x0D)
            time.sleep(0.4)
            if not _edit_len(edit_h): break
    if _edit_len(edit_h):
        _clear_edit(edit_h)
        log('[FAIL] 전송이 안 되어 입력칸을 비우고 다음에 다시 보냅니다')
        return False

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
    log(f'=== 맘캘린더 핫딜 카톡방 자동 발송 봇 가동 — 대상 「{TARGET_ROOM}」 · 발송 09:00~22:00(KST) ===')
    first_run = not os.path.exists(HISTORY_FILE)
    posted_ids = load_posted_history()
    if first_run:
        # 기록 파일이 없으면(새로 설치·파일 삭제) 지금 DB 에 있는 딜은 이미 나간 것으로 본다 — 안 그러면 옛 딜이 줄줄이 나간다
        init = get_latest_hotdeals(limit=FETCH_LIMIT)
        for d in init:
            if d.get('id') is not None: posted_ids.add(d.get('id'))
        save_posted_history(posted_ids)
        log(f'[INIT] 기록 파일이 없어 현재 핫딜 {len(init)}건은 발송 완료로 표시했습니다')
    last_quiet_log = None
    while True:
        try:
            if is_quiet_hour():
                key = now_kst().strftime('%Y-%m-%d %H')
                if key != last_quiet_log:
                    log('[QUIET] 방해금지 시간(22~09시, 한국시간) — 핫딜은 DB 에만 쌓이고 카톡 발송은 쉽니다')
                    last_quiet_log = key
                time.sleep(60)
                continue
            deals = sorted(get_latest_hotdeals(limit=FETCH_LIMIT), key=lambda d: d.get('id') or 0)   # 오래된 딜부터 차례로
            for deal in deals:
                deal_id = deal.get('id')
                if deal_id in posted_ids:
                    continue
                if _too_old(deal):
                    log(f'[SKIP] ID {deal_id} 올라온 지 {MAX_DEAL_AGE_H}시간이 지나 보내지 않습니다')
                    posted_ids.add(deal_id)
                    save_posted_history(posted_ids)
                    continue
                gate, why = deal_gate(deal)
                if gate == 'drop':
                    log(f'[SKIP] ID {deal_id} {why} — 보내지 않습니다')
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
                    time.sleep(random.randint(GAP_MIN_S, GAP_MAX_S))   # 다음 딜까지 간격(순차 발송)
        except Exception as e:
            log(f'[LOOP ERROR] {e}')
        time.sleep(30)

if __name__ == '__main__':
    run_loop()
