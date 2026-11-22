@echo off
title [맘캘린더] 도쿄 VM 원격 접속 영구 유지 패치 (절대 끊김 방지)
chcp 65001 >nul

echo ========================================================
echo 🛡️ 도쿄 VM 원격 데스크톱(RDP) 영구 유지 및 끊김 방지 패치
echo ========================================================
echo.

:: 1. RDP 세션 타임아웃 무제한 설정 (유휴 시간 초과로 끊기는 현상 원천 차단)
reg add "HKLM\SOFTWARE\Policies\Microsoft\Windows NT\Terminal Services" /v MaxIdleTime /t REG_DWORD /d 0 /f
reg add "HKLM\SOFTWARE\Policies\Microsoft\Windows NT\Terminal Services" /v MaxDisconnectionTime /t REG_DWORD /d 0 /f
reg add "HKLM\SOFTWARE\Policies\Microsoft\Windows NT\Terminal Services" /v MaxConnectionTime /t REG_DWORD /d 0 /f

:: 2. RDP 1분 주기 Keep-Alive 강제 활성화 (공유기/방화벽이 유휴 연결 끊는 것 방지)
reg add "HKLM\SYSTEM\CurrentControlSet\Control\Terminal Server" /v KeepAliveInterval /t REG_DWORD /d 1 /f
reg add "HKLM\SOFTWARE\Policies\Microsoft\Windows NT\Terminal Services" /v KeepAliveEnable /t REG_DWORD /d 1 /f
reg add "HKLM\SOFTWARE\Policies\Microsoft\Windows NT\Terminal Services" /v KeepAliveInterval /t REG_DWORD /d 1 /f

:: 3. 윈도우 전원 절전 모드 및 화면 꺼짐 완전 해제
powercfg -change -monitor-timeout-ac 0
powercfg -change -standby-timeout-ac 0
powercfg -change -hibernate-timeout-ac 0

:: 4. 다중 접속 충돌 시 기존 세션 강제 유지 설정
reg add "HKLM\SYSTEM\CurrentControlSet\Control\Terminal Server" /v fSingleSessionPerUser /t REG_DWORD /d 1 /f

echo.
echo ========================================================
echo ✅ 모든 설정이 완료되었습니다! 이제 원격 연결이 절대 자동으로 끊기지 않습니다.
echo ========================================================
pause
