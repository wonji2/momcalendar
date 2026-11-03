#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
맘캘린더 네이버 블로그 & 네이버 카페(momcal) 일간 포스팅 자동 생성기
- 데이터: Supabase 실시간 오늘 오픈 공구(150+건) + 오늘 마감 공구(120+건) + 실시간 최저가 핫딜(100+건)
- 키워드: tools/daily/blog_keywords.json 및 블로그/카페 관리자 실측 골든 브랜드 가중치 반영
- 전환 퍼널: 모바일 83% 유입에 맞춘 맘캘린더 공식 앱 다운로드(App Store / Google Play) 링크 최우선 배치
- 참여 유도: 네이버 카페 글 최하단 맘캘봇 댓글 유도 멘트 자동 탑재
"""

import os
import sys
import json
import urllib.request
from datetime import datetime, timezone, timedelta

KST = timezone(timedelta(hours=9))
now = datetime.now(KST)
today_str = now.strftime('%Y-%m-%d')
month = now.month
day = now.day
weekday_names = ['월', '화', '수', '목', '금', '토', '일']
weekday = weekday_names[now.weekday()]

SUPABASE_URL = os.environ.get('SUPABASE_URL', 'https://hycaqsqeogjtbscmzrtm.supabase.co')
SUPABASE_KEY = os.environ.get('SUPABASE_KEY', 'sb_publishable_u4hR4mdNTSss3kdjFH6R5Q_iuJ2MuGE')
HEADERS = {'apikey': SUPABASE_KEY, 'Authorization': f'Bearer {SUPABASE_KEY}'}

APP_STORE_IOS = 'https://apps.apple.com/kr/app/id6826126083'
APP_STORE_AOS = 'https://play.google.com/store/apps/details?id=com.wantsb.momcalendar'

# 블로그/카페 실측 골든 브랜드 가중치 리스트
GOLDEN_BRANDS = [
    '우아한김', '라온킴', '알텐바흐', '탁가온', '얼라맘마', '미니두두', '한일매트',
    '스트라이더', '노부영', '소마셈', '러닝리소스', '다짜고짜', '짤순이', '데코아르',
    '비타바움', '차일드라이프', '타요', '마이쿠커', '두리', '모두안', '꿈꾸는달팽이', '어스본'
]

def fetch_json(url):
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read().decode('utf-8'))

def clean_text(s):
    if not s:
        return ''
    return s.strip().replace('\r', '').replace('\n', ' ')

def main():
    print(f"[{today_str}] 맘캘린더 일간 포스팅 생성 시작...")

    # 1. 오늘 오픈 공구 수집
    u_open = f"{SUPABASE_URL}/rest/v1/gonggu?approved=eq.true&open_date=eq.{today_str}&select=id,name,influencer,major,minor,open_date,end_date,vendor_id&order=id.desc&limit=500"
    g_open = fetch_json(u_open)

    # 2. 오늘 마감 공구 수집
    u_end = f"{SUPABASE_URL}/rest/v1/gonggu?approved=eq.true&end_date=eq.{today_str}&select=id,name,influencer,major,minor,open_date,end_date,vendor_id&order=id.desc&limit=500"
    g_end = fetch_json(u_end)

    # 3. 실시간 핫딜 수집 (최대 100건)
    u_hd = f"{SUPABASE_URL}/rest/v1/hotdeals?select=id,title,price,unit_price,unit_label,major,mall,discount_rate,img_url&or=(pin_random.is.true,expires_at.is.null,expires_at.gt.now())&order=created_at.desc&limit=100"
    deals = fetch_json(u_hd)

    print(f"-> 오픈 공구 {len(g_open)}건, 마감 공구 {len(g_end)}건, 핫딜 {len(deals)}건 수집 완료")

    # 오늘 오픈 중 골든 브랜드 매칭
    matched = []
    for b in GOLDEN_BRANDS:
        for g in g_open:
            name = g.get('name') or ''
            if b in name and b not in matched:
                matched.append(b)

    top_brands = matched[:4] if matched else ['인기육아템', '필수생필품']
    top_brands_str = ' · '.join(top_brands)

    # 4. 제목 생성
    # 네이버 블로그용 제목: 실측 1위~4위 키워드 반영
    blog_title = f"{month}월 {day}일({weekday}) 오늘의 공구 일정 | {top_brands_str} 인스타 공구 & 실시간 핫딜 모음"
    # 네이버 카페용 제목
    cafe_title = f"[공구일정] {month}월 {day}일({weekday}) 오늘의 공구 모음 | {top_brands_str} & 실시간 최저가 핫딜"

    # 카테고리별 공구 분류
    cats = ['육아', '식품', '리빙', '패션', '뷰티', '가전', '건강', '기타']
    cat_map = {c: [] for c in cats}
    for g in g_open:
        major = g.get('major') or '기타'
        target_cat = major if major in cat_map else '기타'
        cat_map[target_cat].append(g)

    # ── 네이버 블로그 원고 작성 ──
    b_lines = []
    b_lines.append(f"제목: {blog_title}\n")
    b_lines.append("────────────────────────────────────────")
    b_lines.append("📲 맘캘린더 공식 앱 다운받기 (실시간 특가 & 공구 알림)")
    b_lines.append("내가 찜한 브랜드 공구 시작할 때, 기저귀·분유 역대최저가 뜰 때 1초 실시간 푸시!")
    b_lines.append(f"· 아이폰 (App Store): {APP_STORE_IOS}")
    b_lines.append(f"· 갤럭시/안드로이드 (Google Play): {APP_STORE_AOS}")
    b_lines.append("────────────────────────────────────────\n")

    b_lines.append(f"안녕하세요 육아맘 여러분! 💜")
    b_lines.append(f"{month}월 {day}일 {weekday}요일, 오늘 새롭게 오픈하는 전체 인스타 공구 일정({len(g_open)}건)과")
    b_lines.append(f"온라인 쇼핑몰 실시간 역대 최저가 핫딜({len(deals)}건)을 빠짐없이 전수 정리해 드립니다.\n")

    b_lines.append(f"■ 오늘의 신규 오픈 공구 일정 ({len(g_open)}건 전수)\n")
    for c in cats:
        items = cat_map[c]
        if not items:
            continue
        b_lines.append(f"[{c}]")
        for it in items:
            name = clean_text(it.get('name'))
            inf = clean_text(it.get('influencer'))
            end_d = clean_text(it.get('end_date'))
            end_str = f" (~{end_d} 마감)" if end_d else ""
            b_lines.append(f"· {name} — {inf}{end_str}")
        b_lines.append("")

    b_lines.append("────────────────────────────────────────")
    b_lines.append(f"■ 오늘의 실시간 쇼핑몰 최저가 핫딜 ({len(deals)}건 전수)\n")
    b_lines.append("※ 실시간 가격 변동 및 조기 품절될 수 있으니 서두르세요!")
    for d in deals:
        t = clean_text(d.get('title'))
        p = d.get('price')
        p_str = f"{p:,}원" if p else ""
        mall = clean_text(d.get('mall') or '')
        mall_str = f"[{mall}] " if mall else ""
        u_p = d.get('unit_price')
        u_lbl = clean_text(d.get('unit_label') or '')
        unit_str = f" ({u_lbl})" if u_lbl else (f" (단위당 {u_p:,}원)" if u_p else "")
        d_id = d.get('id')
        link_str = f" 👉 https://momcalendar.com/go.html?id={d_id}" if d_id else ""
        b_lines.append(f"· {mall_str}{t} — {p_str}{unit_str}{link_str}")

    b_lines.append("\n※ 찾으시는 핫딜이나 생필품은 맘캘린더 앱에서 키워드 알림을 등록해 두시면 실시간 푸시로 바로 쏴드려요!")
    b_lines.append(f"👉 맘캘린더 앱 설치하기: {APP_STORE_IOS}\n")

    b_lines.append("────────────────────────────────────────")
    b_lines.append(f"■ 오늘 마감하는 공구 일정 ({len(g_end)}건 전수)\n")
    for it in g_end:
        name = clean_text(it.get('name'))
        inf = clean_text(it.get('influencer'))
        b_lines.append(f"· {name} — {inf}")

    b_lines.append("\n────────────────────────────────────────")
    b_lines.append("오늘의 공구 및 최저가 핫딜 정보가 도움 되셨다면 공감과 이웃 추가 부탁드립니다! 💜")
    b_lines.append("#인스타공구 #공구일정 #인스타공구일정 #오늘의공구일정 #육아템공구 #핫딜 #역대최저가 #맘캘린더")

    # ── 네이버 카페 원고 작성 ──
    c_lines = []
    c_lines.append(f"제목: {cafe_title}\n")
    c_lines.append(f"맘캘 회원님들 안녕하세요! 💜")
    c_lines.append(f"{month}월 {day}일 {weekday}요일, 오늘 오픈하는 전체 공구 리스트와 실시간 최저가 핫딜 전수 모아왔습니다.\n")

    c_lines.append("────────────────────────────────────────")
    c_lines.append("📲 원하는 육아템 놓치지 않게 실시간 알림 받기")
    c_lines.append(f"· 아이폰 (App Store): {APP_STORE_IOS}")
    c_lines.append(f"· 갤럭시/안드로이드 (Google Play): {APP_STORE_AOS}")
    c_lines.append("────────────────────────────────────────\n")

    c_lines.append(f"■ 오늘 오픈 공구 일정 ({len(g_open)}건)\n")
    for c in cats:
        items = cat_map[c]
        if not items:
            continue
        c_lines.append(f"[{c}]")
        for it in items:
            name = clean_text(it.get('name'))
            inf = clean_text(it.get('influencer'))
            end_d = clean_text(it.get('end_date'))
            end_str = f" (~{end_d} 마감)" if end_d else ""
            c_lines.append(f"· {name} — {inf}{end_str}")
        c_lines.append("")

    c_lines.append("────────────────────────────────────────")
    c_lines.append(f"■ 실시간 최저가 핫딜 모음 ({len(deals)}건)\n")
    for d in deals:
        t = clean_text(d.get('title'))
        p = d.get('price')
        p_str = f"{p:,}원" if p else ""
        mall = clean_text(d.get('mall') or '')
        mall_str = f"[{mall}] " if mall else ""
        u_p = d.get('unit_price')
        u_lbl = clean_text(d.get('unit_label') or '')
        unit_str = f" ({u_lbl})" if u_lbl else (f" (단위당 {u_p:,}원)" if u_p else "")
        d_id = d.get('id')
        link_str = f" 👉 https://momcalendar.com/go.html?id={d_id}" if d_id else ""
        c_lines.append(f"· {mall_str}{t} — {p_str}{unit_str}{link_str}")

    c_lines.append("\n────────────────────────────────────────")
    c_lines.append(f"■ 오늘 마감하는 공구 일정 ({len(g_end)}건)\n")
    for it in g_end:
        name = clean_text(it.get('name'))
        inf = clean_text(it.get('influencer'))
        c_lines.append(f"· {name} — {inf}")

    c_lines.append("\n────────────────────────────────────────")
    c_lines.append("💬 혹시 오늘 리스트에 없거나 애타게 기다리고 계신 공구·핫딜이 있으신가요?")
    c_lines.append("댓글로 편하게 남겨주시면 맘캘봇이 두 눈 부릅뜨고 찾아올게요! 👀💜")
    c_lines.append("────────────────────────────────────────")

    # 파일 출력
    os.makedirs("scratchpad/output", exist_ok=True)
    blog_path = "scratchpad/output/blog_today.txt"
    cafe_path = "scratchpad/output/cafe_today.txt"

    with open(blog_path, "w", encoding="utf-8") as f:
        f.write("\n".join(b_lines))

    with open(cafe_path, "w", encoding="utf-8") as f:
        f.write("\n".join(c_lines))

    print(f"-> 블로그 원고 생성 완료: {blog_path}")
    print(f"-> 카페 원고 생성 완료: {cafe_path}")

if __name__ == '__main__':
    main()
