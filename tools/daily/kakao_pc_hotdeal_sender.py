"""
맘캘린더 PC 카카오톡 핫딜 무인 자동 발송기 (0토큰, 0원 무인 파이프라인)
- 작동 원리: 30초 간격으로 수파베이스 신규 핫딜 감지 -> PC 카카오톡 '핫딜단톡방' 창에 자동 전송
- 재부팅 복구: 윈도우 시작프로그램 등록 시 PC 재부팅 후 카톡 실행 시 자동 복구 및 백그라운드 상주
- 토큰 소모: 0원 (순수 Windows API + Supabase REST API)
"""

import os
import sys
import time
import json
import urllib.request
import urllib.parse
from datetime import datetime, timezone, timedelta

# 한국 시간
KST = timezone(timedelta(hours=9))

# 수파베이스 설정 (토큰 0원 REST API)
SUPABASE_URL = os.environ.get('SUPABASE_URL', 'https://hycaqsqeogjtbscmzrtm.supabase.co')
SUPABASE_ANON_KEY = os.environ.get('SUPABASE_ANON_KEY', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh5Y2Fxc3Flb2dqdGJzY216cnRtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Mzg1MDU4NjAsImV4cCI6MjA1NDA4MTg2MH0.2o1E4Xk0iOQ4J7hZ_X2u2u2u2u2u2u2u2u2u2u2u2u2')

# 단톡방 대상 명칭
TARGET_ROOM_NAME = "핫딜단톡방"

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
        # 최근 500개만 유지 (파일 비대화 방지)
        ids_list = list(posted_ids)[-500:]
        with open(HISTORY_FILE, "w", encoding="utf-8") as f:
            json.dump(ids_list, f, ensure_ascii=False)
    except Exception as e:
        print(f"[ERROR] 발송 이력 저장 실패: {e}")

def get_latest_hotdeals(limit=5):
    """수파베이스에서 최신 핫딜 목록 조회 (0토큰 무료 REST API)"""
    try:
        url = f"{SUPABASE_URL}/rest/v1/hotdeals?select=id,title,price,img_url,mall,created_at&order=id.desc&limit={limit}"
        req = urllib.request.Request(url, headers={
            "apikey": SUPABASE_ANON_KEY,
            "Authorization": f"Bearer {SUPABASE_ANON_KEY}"
        })
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read().decode('utf-8'))
    except Exception as e:
        print(f"[WARN] 핫딜 조회 일시 지연: {e}")
        return []

def format_kakao_message(deal):
    """카카오톡 최적화 텍스트 템플릿 포맷팅 (토큰 0원)"""
    title = deal.get("title", "")
    price = deal.get("price", 0)
    mall = deal.get("mall", "특가")
    deal_id = deal.get("id")

    price_str = f"{price:,}원" if isinstance(price, (int, float)) and price > 0 else "특가 확인"

    msg = (
        f"🔥 [실시간 핫딜] {title}\n\n"
        f"💰 가격: {price_str} ({mall})\n"
        f"👉 역대최저가 차트 & 득템하러 가기:\n"
        f"https://momcalendar.com/?deal_id={deal_id}"
    )
    return msg

def send_to_kakao_windows(room_title, message):
    """Windows API를 활용한 카카오톡 무인 메시지 전송 (0토큰, 백그라운드)"""
    try:
        import win32gui
        import win32con
        import win32clipboard

        # 1. 대상 단톡방 핸들 찾기
        hwnd = win32gui.FindWindow(None, room_title)
        if not hwnd:
            print(f"[WAIT] 카카오톡 '{room_title}' 창이 열려있지 않습니다. (창을 최소화해두어도 작동합니다)")
            return False

        # 2. 클립보드에 메시지 복사
        win32clipboard.OpenClipboard()
        win32clipboard.EmptyClipboard()
        win32clipboard.SetClipboardText(message, win32clipboard.CF_UNICODETEXT)
        win32clipboard.CloseClipboard()

        # 3. 채팅 입력창 핸들 찾기 (Edit control)
        # 카카오톡 채팅창 내부의 자식 윈도우 탐색
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
        # win32gui 모듈 미설치 시 안내
        print("[ERROR] pywin32 모듈이 필요합니다. (cmd에서: pip install pywin32)")
        return False
    except Exception as e:
        print(f"[ERROR] 카카오 전송 에러: {e}")
        return False

def main_loop():
    print("=" * 60)
    print("🚀 맘캘린더 PC 카카오톡 핫딜 무인 자동 발송기 가동")
    print(f"🎯 대상 단톡방: {TARGET_ROOM_NAME}")
    print(f"🔄 감시 주기: 30초 (토큰 소모 0원, 비용 0원)")
    print("=" * 60)

    posted_ids = load_posted_history()

    # 최초 실행 시 현재 DB의 최신 건들을 발송 완료로 초기화 (과거 핫딜이 한꺼번에 쏟아지는 도배 방지)
    if not posted_ids:
        initial_deals = get_latest_hotdeals(limit=10)
        for d in initial_deals:
            posted_ids.add(d["id"])
        save_posted_history(posted_ids)
        print(f"[*] 초기화 완료: 기존 핫딜 {len(posted_ids)}건은 발송 완료로 마킹했습니다.")

    while True:
        try:
            deals = get_latest_hotdeals(limit=5)
            # 오래된 순서대로 발송하기 위해 reverse
            for deal in reversed(deals):
                deal_id = deal.get("id")
                if deal_id not in posted_ids:
                    msg = format_kakao_message(deal)
                    sent = send_to_kakao_windows(TARGET_ROOM_NAME, msg)
                    if sent:
                        posted_ids.add(deal_id)
                        save_posted_history(posted_ids)
                        time.sleep(3)  # 단톡방 도배 방지용 3초 텀
            
        except Exception as e:
            print(f"[LOOP ERROR] {e}")

        # 30초마다 신규 핫딜 체크
        time.sleep(30)

if __name__ == "__main__":
    main_loop()
