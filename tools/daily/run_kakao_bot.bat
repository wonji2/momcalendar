@echo off
title 맘캘린더 PC 카카오 핫딜 무인 발송기
cd /d "%~dp0"

echo ======================================================
echo 🚀 맘캘린더 PC 카카오톡 핫딜 무인 자동 발송기 (0원 / 0토큰)
echo ======================================================

:: 필수 라이브러리 자동 점검 (없으면 1초 설치)
python -c "import win32gui" >nul 2>&1
if %errorlevel% neq 0 (
    echo [*] 필수 Windows 통신 모듈 설치 중...
    pip install pywin32
)

:: 파이썬 무인 발송기 백그라운드 상주 실행
python kakao_pc_hotdeal_sender.py
pause
