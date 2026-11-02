"""
맘캘린더 PC 카카오톡 핫딜 무인 자동 발송기 (0토큰, 0원 무인 파이프라인)
- 작동 원리: 30초 간격으로 수파베이스 신규 핫딜 감지 -> PC 카카오톡 '핫딜단톡방' 창에 자동 전송
- 재부팅 복구: 윈도우 시작프로그램 등록 시 PC 재부팅 후 카톡 실행 시 자동 복구 및 백그라운드 상주
- 토큰 소모: 0원 (순수 Windows API + Supabase REST API)
- 템플릿: 카톡 목록 미리보기를 위해 '상품명'으로만 첫 줄 시작 + 개별 단위 가격(1장당 N원) 필수 포함
"""

import os
import sys
import time
import json
import re
import urllib.request
import urllib.parse
from datetime import datetime, timezone, timedelta

# 한국 시간
KST = timezone(timedelta(hours=9))

# 수파베이스 설정 (토큰 0원 REST API)
SUPABASE_URL = os.environ.get('SUPABASE_URL', 'https://hycaqsqeogjtbscmzrtm.supabase.co')
SUPABASE_ANON_KEY = os.environ.get('SUPABASE_ANON_KEY', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh5Y2Fxc3Flb2dqdGJzY216cnRtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Mzg1MDU4NjAsImV4cCI6MjA1NDA4MTg2MH0.2o1E4Xk0iOQ4J7hZ_X2u2u2u2u2u2u2u2u2u2u2u2u2')

# 단톡방 대상 명칭 및 오픈채팅 링크 (인원수 숫자 1, 2 등 제외한 순수 방 이름)
TARGET_ROOM_NAME = "[맘캘린더] 핫딜공지방"
OPEN_CHAT_URL = "https://open.kakao.com/o/pKNUHgVi"

# 발송 이력 로컬 저장 파일 (중복 발송 100% 방지)
HISTORY_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "kakao_posted_deals.json")

def load_posted_history():
    if os.path.exists(HISTORY_FILE):
        try:
            with open(HISTORY_FILE, "r", encoding="utf-8") as f:
                return set(json.load(f))
        except Exception:
            return set()
    return set()

def save_posted_history(posted_ids):
    try:
        ids_list = list(posted_ids)[-500:]
        with open(HISTORY_FILE, "w", encoding="utf-8") as f:
            json.dump(ids_list, f, ensure_ascii=False)
    except Exception as e:
        print(f"[ERROR] 발송 이력 저장 실패: {e}")

def get_latest_hotdeals(limit=5):
    """수파베이스에서 최신 핫딜 목록 조회 (0토큰 무료 REST API)"""
    try:
        # link 컬럼(길아 님의 쿠팡파트너스/링크프라이스 직결 수익링크) 필수 포함
        url = f"{SUPABASE_URL}/rest/v1/hotdeals?select=id,title,price,img_url,mall,link,created_at&order=id.desc&limit={limit}"
        req = urllib.request.Request(url, headers={
            "apikey": SUPABASE_ANON_KEY,
            "Authorization": f"Bearer {SUPABASE_ANON_KEY}"
        })
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read().decode('utf-8'))
    except Exception as e:
        print(f"[WARN] 핫딜 조회 일시 지연: {e}")
        return []

def calculate_unit_price(title, price):
    """상품명과 가격에서 개별 단위 가격 자동 계산 (쿠팡/맘캘 단위가 로직)"""
    if not price or price <= 0:
        return ""
    
    t = title.lower()

    # 1. kg 단위 (예: 5kg, 10kg, 1.5kg)
    m_kg = re.search(r'(\d+(?:\.\d+)?)\s*kg', t)
    if m_kg:
        kg = float(m_kg.group(1))
        if kg > 0:
            unit_val = int(round(price / kg))
            return f"(1kg당 {unit_val:,}원)"

    # 2. g 단위 (예: 800g, 500g) -> 100g당
    m_g = re.search(r'(\d+)\s*g(?![a-z])', t)
    if m_g:
        g = float(m_g.group(1))
        if g >= 100:
            unit_val = int(round((price / g) * 100))
            return f"(100g당 {unit_val:,}원)"

    # 3. 장/매/개/입/팩/포/캔/병 단위
    # 예: 3박스 세트, 120매, 30포, 12캔
    m_count = re.search(r'(\d+)\s*(?:매|장|개|입|팩|포|캔|병|롤|봉)', t)
    if m_count:
        cnt = int(m_count.group(1))
        unit_word = re.search(r'(매|장|개|입|팩|포|캔|병|롤|봉)', m_count.group(0)).group(1)
        # 통일감: 매->장
        if unit_word == '매': unit_word = '장'
        if unit_word == '입': unit_word = '개'
        if cnt > 1:
            unit_val = int(round(price / cnt))
            return f"(1{unit_word}당 {unit_val:,}원)"

    # 기본값 없음
    return ""

def format_kakao_message(deal):
    """
    사장님 확정 템플릿:
    1. 카톡 목록 미리보기에서 바로 보이도록 '상품명'으로만 첫 줄 시작
    2. 사이트에 올라가는 개별 단위 가격(1장당 N원) 필수 포함
    """
    raw_title = deal.get("title", "").strip()
    price = deal.get("price", 0)
    deal_id = deal.get("id")

    # 불필요한 앞머리 어그로 특수문자 제거 후 순수 상품명 추출
    clean_title = re.sub(r'^(?:🔥|⚡|📢|\[[^\]]+\]|\([^\)]+\))\s*', '', raw_title).strip()
    if not clean_title:
        clean_title = raw_title

    price_str = f"{price:,}원" if isinstance(price, (int, float)) and price > 0 else "특가 확인"
    unit_str = calculate_unit_price(clean_title, price)

    # 2줄째: 핫딜 가격 + 단위가격
    second_line = f"- 핫딜 🔥 {price_str}"
    if unit_str:
        second_line += f" {unit_str}"

    # 맘캘린더 공식 도메인으로 제휴코드/긴 주소 100% 마스킹 & 0.1초 자동 리디렉트
    clean_momcal_link = f"https://momcalendar.com/r.html?id={deal_id}" if deal_id else deal.get("link")

    msg = (
        f"{clean_title}\n"
        f"{second_line}\n\n"
        f"👉 구매하러 가기:\n"
        f"{clean_momcal_link}"
    )
    return msg

def send_to_kakao_windows(room_title, message):
    """Windows API를 활용한 카카오톡 무인 메시지 전송 (0토큰, 백그라운드)"""
    try:
        import win32gui
        import win32con
        import win32clipboard

        # 1. 대상 단톡방 핸들 찾기 (인원수가 1, 2, 50명으로 늘어나도 '핫딜공지방' 자동 감지)
        hwnd = win32gui.FindWindow(None, room_title)
        if not hwnd:
            def find_win(h, _):
                nonlocal hwnd
                if hwnd:
                    return
                t = win32gui.GetWindowText(h)
                if "핫딜공지방" in t or "[맘캘린더]" in t and "핫딜" in t:
                    hwnd = h
            win32gui.EnumWindows(find_win, None)

        if not hwnd:
            print(f"[WAIT] 카카오톡 '{room_title}' 창이 열려있지 않습니다.")
            return False

        # 2. 클립보드에 메시지 복사
        win32clipboard.OpenClipboard()
        win32clipboard.EmptyClipboard()
        win32clipboard.SetClipboardText(message, win32clipboard.CF_UNICODETEXT)
        win32clipboard.CloseClipboard()

        # 3. 채팅 입력창 핸들 찾기 (Edit control)
        edit_hwnd = None
        def enum_child(child, _):
            nonlocal edit_hwnd
            cls_name = win32gui.GetClassName(child)
            if "RICHEDIT" in cls_name.upper() or "EDIT" in cls_name.upper():
                edit_hwnd = child
        win32gui.EnumChildWindows(hwnd, enum_child, None)

        target_hwnd = edit_hwnd if edit_hwnd else hwnd

        # 4. 붙여넣기 (Ctrl+V) & 전송 (Enter)
        win32gui.SendMessage(target_hwnd, win32con.WM_PASTE, 0, 0)
        time.sleep(0.1)
        win32gui.SendMessage(target_hwnd, win32con.WM_KEYDOWN, win32con.VK_RETURN, 0)
        win32gui.SendMessage(target_hwnd, win32con.WM_KEYUP, win32con.VK_RETURN, 0)

        print(f"[SUCCESS] '{room_title}'에 핫딜 발송 완료!")
        return True
    except ImportError:
        print("[ERROR] pywin32 모듈이 필요합니다. (pip install pywin32)")
        return False
    except Exception as e:
        print(f"[ERROR] 카카오 전송 에러: {e}")
        return False

def main_loop():
    print("=" * 60)
    print("🚀 맘캘린더 PC 카카오톡 핫딜 무인 자동 발송기 가동")
    print(f"🎯 대상 단톡방: {TARGET_ROOM_NAME}")
    print(f"📝 템플릿: 상품명 첫 줄 시작 + 사이트 개별 단위가 필수 표기")
    print("=" * 60)

    posted_ids = load_posted_history()

    if not posted_ids:
        initial_deals = get_latest_hotdeals(limit=10)
        for d in initial_deals:
            posted_ids.add(d["id"])
        save_posted_history(posted_ids)
        print(f"[*] 초기화 완료: 기존 핫딜 {len(posted_ids)}건은 발송 완료로 마킹했습니다.")

    while True:
        try:
            deals = get_latest_hotdeals(limit=5)
            for deal in reversed(deals):
                deal_id = deal.get("id")
                if deal_id not in posted_ids:
                    msg = format_kakao_message(deal)
                    sent = send_to_kakao_windows(TARGET_ROOM_NAME, msg)
                    if sent:
                        posted_ids.add(deal_id)
                        save_posted_history(posted_ids)
                        time.sleep(3)
        except Exception as e:
            print(f"[LOOP ERROR] {e}")

        time.sleep(30)

if __name__ == "__main__":
    main_loop()
