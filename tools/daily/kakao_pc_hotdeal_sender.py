import os, sys, time, ctypes, win32gui, win32con, win32clipboard, re, json, urllib.request

sys.stdout.reconfigure(encoding='utf-8')
sys.stderr.reconfigure(encoding='utf-8')

SUPABASE_URL = 'https://hycaqsqeogjtbscmzrtm.supabase.co'
SUPABASE_ANON_KEY = 'sb_publishable_u4hR4mdNTSss3kdjFH6R5Q_iuJ2MuGE'
HISTORY_FILE = r'C:\MomcalBot\kakao_posted_deals.json'
LOG_FILE = r'C:\MomcalBot\bot.log'

def log(msg):
    t = time.strftime('%Y-%m-%d %H:%M:%S')
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

def find_chat_and_edit():
    chat_h, edit_h = None, None
    def enum_win(h, _):
        nonlocal chat_h, edit_h
        c = win32gui.GetClassName(h)
        if 'EVA_Window_Dblclk' in c:
            def enum_c(ch, _):
                nonlocal edit_h
                if 'RICHEDIT50W' in win32gui.GetClassName(ch):
                    edit_h = ch
            win32gui.EnumChildWindows(h, enum_c, None)
            if edit_h:
                chat_h = h
                return
    win32gui.EnumWindows(enum_win, None)
    return chat_h, edit_h

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

    # 4. 클립보드 붙여넣기
    win32gui.SendMessage(edit_h, win32con.WM_PASTE, 0, 0)
    time.sleep(0.2)

    # 🚨 [길아 사장님 핫픽스] 스페이스 + 백스페이스 입력으로 카톡 전송(Send) 버튼 강제 활성화!
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
        ctypes.windll.user32.keybd_event(0x0D, 0, 0, 0)
        time.sleep(0.05)
        ctypes.windll.user32.keybd_event(0x0D, 0, 2, 0)
        time.sleep(0.1)

    log('[SUCCESS] 핫딜 단톡방 전송 성공!')
    return True

def run_loop():
    log('=== 맘캘린더 핫딜 카톡방 자동 발송 봇 가동 (전송 버튼 활성화 보정 완료) ===')
    posted_ids = load_posted_history()
    while True:
        try:
            deals = get_latest_hotdeals(limit=5)
            for deal in reversed(deals):
                deal_id = deal.get('id')
                if deal_id not in posted_ids:
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
