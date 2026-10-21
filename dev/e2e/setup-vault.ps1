# Windows version of setup-vault.sh: builds the same isolated test vault under
# dev/e2e/work and starts Obsidian on it with the Chrome DevTools Protocol on
# -CdpPort.
#
#   powershell -File dev/e2e/setup-vault.ps1 -SourceVault "C:\path\to\your\vault"
#
# Notebook Navigator, Style Settings, Minimal Theme Settings and the Minimal
# theme are copied from -SourceVault. Everything lands in dev/e2e/work, which
# is git-ignored. Your own Obsidian config is not touched: Obsidian runs with
# its own --user-data-dir. Windows has no headless mode, so a window opens.
# -NoLaunch only prepares the vault and prints the Obsidian command line.
# Stop it with: node dev/e2e/cdp.mjs quit
param(
  [Parameter(Mandatory = $true)] [string]$SourceVault,
  [int]$CdpPort = 9333,
  [string]$Obsidian = "",
  [switch]$NoLaunch
)
$ErrorActionPreference = "Stop"

$Here = $PSScriptRoot
$Repo = (Resolve-Path (Join-Path $Here "../..")).Path
$Work = Join-Path $Here "work"
$Vault = Join-Path $Work "vault"
$UserData = Join-Path $Work "userdata"
$Utf8 = New-Object System.Text.UTF8Encoding $false

function Write-Utf8([string]$Path, [string]$Text) {
  [System.IO.File]::WriteAllText($Path, $Text, $Utf8)
}

if (-not $Obsidian) {
  $Obsidian = @("$env:LOCALAPPDATA\Programs\Obsidian\Obsidian.exe", "$env:ProgramFiles\Obsidian\Obsidian.exe") |
    Where-Object { Test-Path $_ } | Select-Object -First 1
}
if (-not $NoLaunch -and -not $Obsidian) { throw "Obsidian.exe not found; pass -Obsidian" }

if (Test-Path $Work) { Remove-Item -Recurse -Force $Work }
foreach ($dir in @("$Vault\.obsidian\plugins", "$Vault\.obsidian\themes", $UserData, "$Work\shots")) {
  New-Item -ItemType Directory -Force $dir | Out-Null
}

# Folder tree shaped like a DIKM vault.
$folders = @(
  "00. Meta", "01. Inbox",
  "10. Data (D)/101. Fleeting", "10. Data (D)/102. Raw Data",
  "20. Information (I)/201. Patterns", "30. Knowledge (K)/301. Philosophy",
  "40. Meaning (M)/401. Practice", "50. Teaching Materials/502. Obsidian",
  "70. Documentations/705. Minutes", "80. References", "90. Settings",
  "Cards", "kit", "NotePack CODEX"
)
foreach ($dir in $folders) {
  $full = Join-Path $Vault $dir
  New-Item -ItemType Directory -Force $full | Out-Null
  Write-Utf8 (Join-Path $full "note.md") "# test`n"
}

function Copy-Plugin([string]$Id) {
  $src = Join-Path $SourceVault ".obsidian\plugins\$Id"
  if (-not (Test-Path $src)) { Write-Host "skip $Id (not in SourceVault)"; return }
  $dst = Join-Path $Vault ".obsidian\plugins\$Id"
  New-Item -ItemType Directory -Force $dst | Out-Null
  foreach ($file in @("main.js", "manifest.json", "styles.css", "data.json")) {
    if (Test-Path (Join-Path $src $file)) { Copy-Item (Join-Path $src $file) $dst }
  }
}
Copy-Plugin "notebook-navigator"
Copy-Plugin "obsidian-style-settings"
Copy-Plugin "obsidian-minimal-settings"
$theme = Join-Path $SourceVault ".obsidian\themes\Minimal"
if (Test-Path $theme) { Copy-Item -Recurse $theme (Join-Path $Vault ".obsidian\themes") }
$appearance = Join-Path $SourceVault ".obsidian\appearance.json"
if (Test-Path $appearance) { Copy-Item $appearance (Join-Path $Vault ".obsidian") }
if (-not (Test-Path "$Vault\.obsidian\plugins\notebook-navigator\main.js")) { throw "Notebook Navigator is required" }

# The add-on under test, straight from the repo, with demo groups and colors.
$addon = Join-Path $Vault ".obsidian\plugins\achmage-nn-border-addon"
New-Item -ItemType Directory -Force $addon | Out-Null
foreach ($file in @("main.js", "manifest.json", "styles.css")) { Copy-Item (Join-Path $Repo $file) $addon }
Copy-Item (Join-Path $Here "demo-data.json") (Join-Path $addon "data.json")

Write-Utf8 "$Vault\.obsidian\community-plugins.json" '["notebook-navigator","obsidian-style-settings","obsidian-minimal-settings","achmage-nn-border-addon"]'

# Use the same Obsidian build as the desktop app if an update asar exists.
$latestAsar = Get-ChildItem "$env:APPDATA\obsidian\obsidian-*.asar" -ErrorAction SilentlyContinue |
  Sort-Object { [version]($_.BaseName -replace '^obsidian-', '') } | Select-Object -Last 1
if ($latestAsar) { Copy-Item $latestAsar.FullName $UserData }
$vaultJson = $Vault | ConvertTo-Json
Write-Utf8 "$UserData\obsidian.json" "{`"vaults`":{`"e2e0000000000001`":{`"path`":$vaultJson,`"ts`":1700000000000,`"open`":true}},`"updateDisabled`":true}"

# Windows throttles windows it considers hidden; keep the test window rendering.
$arguments = @(
  "--user-data-dir=$UserData",
  "--remote-debugging-port=$CdpPort",
  "--disable-features=CalculateNativeWinOcclusion",
  "--disable-backgrounding-occluded-windows",
  "--disable-renderer-backgrounding"
)
if ($NoLaunch) {
  Write-Host "Vault ready: $Vault"
  Write-Host "Start: `"$Obsidian`" $($arguments -join ' ')"
  return
}

$quoted = $arguments | ForEach-Object { "`"$_`"" }
$process = Start-Process -FilePath $Obsidian -ArgumentList $quoted -PassThru
Write-Utf8 "$Work\obsidian.pid" "$($process.Id)"
for ($i = 0; $i -lt 30; $i++) {
  try { Invoke-RestMethod "http://127.0.0.1:$CdpPort/json/list" | Out-Null; break } catch { Start-Sleep -Seconds 1 }
}
Write-Host "Test Obsidian started (pid $($process.Id), CDP port $CdpPort)."
Write-Host "Next: node dev/e2e/smoke.mjs   Stop: node dev/e2e/cdp.mjs quit"
