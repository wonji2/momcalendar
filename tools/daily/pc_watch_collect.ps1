# PC 광고 프로그램 감시 — 모으는 쪽(읽기만). pc_adware_watch.mjs 가 부른다. 결과는 JSON 한 덩어리를 표준출력으로.
#   모으는 것: 설치 프로그램 목록 · 시작 프로그램(Run) · 마이크로소프트 밖 예약작업 · 서비스·드라이버(사용자 폴더/의심 이름)
#             · 크롬 확장(프로필별 id·이름·넓은 권한) · DNS 기록(광고 서버) · 루트 인증서 지문
#   ⚠ 아무것도 바꾸지 않는다(삭제·설정 변경 없음).
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$o = [ordered]@{}
$keys = 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*','HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*','HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*'
$o.programs = @(Get-ItemProperty $keys | Where-Object { $_.DisplayName } | ForEach-Object { [ordered]@{ name = [string]$_.DisplayName; pub = [string]$_.Publisher; date = [string]$_.InstallDate; loc = [string]$_.InstallLocation; un = ([string]$_.UninstallString) } })
$o.run = @(foreach ($k in 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run','HKLM:\Software\Microsoft\Windows\CurrentVersion\Run','HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Run') { $p = Get-ItemProperty $k; if ($p) { $p.PSObject.Properties | Where-Object { $_.Name -notmatch '^PS' } | ForEach-Object { [ordered]@{ name = $_.Name; cmd = [string]$_.Value } } } })
$o.tasks = @(Get-ScheduledTask | Where-Object { $_.TaskPath -notmatch '^\\Microsoft\\' } | ForEach-Object { [ordered]@{ name = $_.TaskPath + $_.TaskName; cmd = (($_.Actions | ForEach-Object { "$($_.Execute) $($_.Arguments)" }) -join ' ; ') } })
$o.services = @(Get-CimInstance Win32_Service | Where-Object { $_.PathName -match 'AppData|ProgramData\\[^\\]+\\[^\\]+\.exe' -or $_.Name -match 'divert|nori|shopmine|safevisit' } | ForEach-Object { [ordered]@{ name = $_.Name; path = [string]$_.PathName; state = [string]$_.State } })
$o.drivers = @(Get-CimInstance Win32_SystemDriver | Where-Object { $_.PathName -match 'AppData|divert' -or $_.Name -match 'divert' } | ForEach-Object { [ordered]@{ name = $_.Name; path = [string]$_.PathName } })
$ext = @()
foreach ($root in "$env:LOCALAPPDATA\Google\Chrome\User Data","$env:LOCALAPPDATA\Microsoft\Edge\User Data","$env:LOCALAPPDATA\Naver\Naver Whale\User Data","$env:LOCALAPPDATA\Aside\User Data") {
  if (-not (Test-Path $root)) { continue }
  $br = (Split-Path (Split-Path $root -Parent) -Leaf)
  Get-ChildItem $root -Directory | Where-Object { Test-Path (Join-Path $_.FullName 'Extensions') } | ForEach-Object {
    $prof = $_.Name
    Get-ChildItem (Join-Path $_.FullName 'Extensions') -Directory | ForEach-Object {
      $id = $_.Name; $v = Get-ChildItem $_.FullName -Directory | Sort-Object Name -Descending | Select-Object -First 1; if (-not $v) { return }
      $mf = Join-Path $v.FullName 'manifest.json'; if (-not (Test-Path $mf)) { return }
      try { $m = Get-Content $mf -Raw -Encoding UTF8 | ConvertFrom-Json } catch { return }
      $name = [string]$m.name
      if ($name -match '^__MSG_(.+)__$') { $key = $Matches[1]; foreach ($loc in @($m.default_locale,'ko','en')) { $lf = Join-Path $v.FullName "_locales\$loc\messages.json"; if ($loc -and (Test-Path $lf)) { try { $lm = Get-Content $lf -Raw -Encoding UTF8 | ConvertFrom-Json; $hit = $lm.PSObject.Properties | Where-Object { $_.Name -ieq $key } | Select-Object -First 1; if ($hit) { $name = [string]$hit.Value.message; break } } catch {} } } }
      $perm = (@($m.permissions) + @($m.host_permissions) + @($m.content_scripts | ForEach-Object { $_.matches })) -join ','
      $ext += [ordered]@{ browser = $br; profile = $prof; id = $id; name = $name; wide = [bool]($perm -match '<all_urls>|\*://\*/\*|https?://\*/\*'); store = [bool]([string]$m.update_url -match 'clients2\.google\.com|edge\.microsoft\.com|store\.whale') }
    }
  }
}
$o.extensions = $ext
$o.dns = @(Get-DnsClientCache | ForEach-Object { [string]$_.Entry } | Sort-Object -Unique)
$o.roots = @(Get-ChildItem Cert:\LocalMachine\Root,Cert:\CurrentUser\Root | ForEach-Object { [ordered]@{ tp = $_.Thumbprint; subj = $_.Subject; from = $_.NotBefore.ToString('yyyy-MM-dd') } } | Sort-Object { $_.tp } -Unique)
$ie = Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings'
$o.proxy = [ordered]@{ enable = [int]$ie.ProxyEnable; server = [string]$ie.ProxyServer; pac = [string]$ie.AutoConfigURL }
$o | ConvertTo-Json -Depth 5 -Compress
