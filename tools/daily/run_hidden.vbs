' 예약작업을 창 없이 돌린다 (사장님 2026-09-07: "10분에 하나씩 검은 창이 계속 뜬다")
' 윈도우 예약작업이 node.exe 를 직접 부르면 InteractiveToken 이라 콘솔 창이 보인다.
' 이 스크립트를 wscript.exe 로 부르고 실제 명령을 인자로 넘기면 창 숨김(0)으로 실행된다.
'   동작: wscript.exe //B run_hidden.vbs "<실행파일>" "<인자1>" "<인자2>" ...
'   작업 폴더는 예약작업의 WorkingDirectory 를 그대로 물려받는다.
Option Explicit
Dim sh, cmd, i
If WScript.Arguments.Count < 1 Then WScript.Quit 2
Set sh = CreateObject("WScript.Shell")
cmd = ""
For i = 0 To WScript.Arguments.Count - 1
  cmd = cmd & """" & WScript.Arguments(i) & """ "
Next
' 0 = 창 숨김, True = 끝날 때까지 기다려 종료코드를 예약작업에 돌려준다 (LastTaskResult 가 그대로 살아남는다)
' ⚠ 실행파일이 없으면 sh.Run 이 예외를 던지고 wscript 는 0 으로 끝난다 (검증자 실측 2026-09-07) → 127 로 바꿔 예약작업에 실패가 보이게 한다
Dim rc
On Error Resume Next
rc = sh.Run(cmd, 0, True)
If Err.Number <> 0 Then rc = 127
On Error GoTo 0
WScript.Quit rc
