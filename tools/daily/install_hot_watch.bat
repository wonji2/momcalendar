@echo off
chcp 65001 >nul
rem 핫이슈 감시 작업 등록 — 2026-10-02
rem 한 시간에 한 번(08:00~24:00) 터진 연예 이슈가 있는지 보고, 있으면 글 1편을 써서 바로 올린다.
rem 끄기:  schtasks /Change /TN njob-hot-watch /DISABLE
rem 지우기: schtasks /Delete /TN njob-hot-watch /F

set "PS=powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"C:\Users\FAMILY\Desktop\MOMCALENDAR\tools\daily\njob_hot_watch.ps1\""

schtasks /Create /TN "njob-hot-watch" /TR "%PS%" /SC DAILY /ST 08:00 /RI 60 /DU 16:00 /F
if errorlevel 1 (
  echo.
  echo [실패] 작업을 만들지 못했습니다. 위 메시지를 그대로 알려주세요.
  exit /b 1
)

echo.
echo [등록됨] njob-hot-watch — 08:00부터 한 시간마다 자정까지
schtasks /Query /TN "njob-hot-watch" /FO LIST | findstr /C:"TaskName" /C:"Next Run Time" /C:"Status" /C:"Scheduled Task State"
echo.
echo 끄려면:  schtasks /Change /TN njob-hot-watch /DISABLE
exit /b 0
