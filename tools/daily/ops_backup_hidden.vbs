' 창 없이 ops_backup.ps1 실행 (예약작업 momcal-ops-backup 이 이 파일을 부른다)
' 2026-09-28 사장님 지시: 작업 중 파란 PowerShell 창이 갑자기 뜨지 않게
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
sh.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & dir & "\ops_backup.ps1""", 0, False
