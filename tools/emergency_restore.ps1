# 윈도우에서 부르기 — 로직은 tools/emergency_restore.sh 한 곳에만 둔다
param([switch]$Yes, [string]$Dst = "")
if ($Dst -ne "") { $env:DST_REF = $Dst }
$mode = if ($Yes) { "--yes" } else { "" }
bash tools/emergency_restore.sh $mode
exit $LASTEXITCODE
