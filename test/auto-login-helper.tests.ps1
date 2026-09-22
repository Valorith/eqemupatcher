# Unit tests for the pure logic in Invoke-EqAutoLogin.ps1 (layout math, settings
# merging, pixel-state classification). Runs under Windows PowerShell 5.1 or pwsh 7 on
# any OS; the Win32 P/Invoke signatures compile everywhere but are never called here.
# Invoked by test/auto-login-helper.test.js; can also be run directly:
#   pwsh -NoProfile -File test/auto-login-helper.tests.ps1

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

. ([System.IO.Path]::Combine($PSScriptRoot, "..", "src", "electron", "assets", "auto-login", "Invoke-EqAutoLogin.ps1"))

$script:failures = 0
$script:passes = 0

function Assert-Equal {
  param($Expected, $Actual, [string]$Name)
  $expectedText = if ($Expected -is [System.Array]) { $Expected -join "," } else { [string]$Expected }
  $actualText = if ($Actual -is [System.Array]) { $Actual -join "," } else { [string]$Actual }
  if ($expectedText -eq $actualText) {
    $script:passes += 1
    Write-Output "ok - $Name"
  } else {
    $script:failures += 1
    Write-Output "not ok - $Name (expected '$expectedText', got '$actualText')"
  }
}

function New-Pixel {
  param([int]$R, [int]$G, [int]$B)
  [pscustomobject]@{ R = $R; G = $G; B = $B }
}

function New-Probes {
  param([hashtable]$Overrides = @{})
  $dark = New-Pixel 10 10 10
  $probes = [ordered]@{}
  foreach ($name in @("loginErrorButton", "loginErrorBorder", "mainMenuLogin", "mainMenuPasswordField", "mainMenuLoginButton", "mainMenuExitButton")) {
    $pixels = if ($Overrides.ContainsKey($name)) { $Overrides[$name] } else { @($dark) }
    $probes[$name] = New-ProbeSample -Pixels @($pixels)
  }
  return $probes
}

# --- ComputeUiLayoutRect -----------------------------------------------------------------

Assert-Equal @(448, 120, 1024, 768) ([EqAutoLogin.Native]::ComputeUiLayoutRect(1920, 1009, "fit", 1024, 768)) "fit: 1080p maximized client centres a 1024x768 canvas"
Assert-Equal @(0, 0, 1024, 768) ([EqAutoLogin.Native]::ComputeUiLayoutRect(1024, 768, "fit", 1024, 768)) "fit: exact canvas size has no offset"
Assert-Equal @(218, 0, 929, 697) ([EqAutoLogin.Native]::ComputeUiLayoutRect(1366, 697, "fit", 1024, 768)) "fit: short client shrinks canvas keeping 4:3"
Assert-Equal @(0, 84, 800, 600) ([EqAutoLogin.Native]::ComputeUiLayoutRect(800, 768, "fit", 1024, 768)) "fit: narrow client shrinks canvas keeping 4:3"
Assert-Equal @(1408, 696, 1024, 768) ([EqAutoLogin.Native]::ComputeUiLayoutRect(3840, 2160, "fit", 1024, 768)) "fit: 4K client keeps the canvas at native size"
Assert-Equal @(171, -35, 1024, 768) ([EqAutoLogin.Native]::ComputeUiLayoutRect(1366, 697, "centered", 1024, 768)) "centered: fixed canvas may hang past the client edge"
Assert-Equal @(448, 120, 1024, 768) ([EqAutoLogin.Native]::ComputeUiLayoutRect(1920, 1009, "centered", 1024, 768)) "centered: matches fit when the client is large enough"
Assert-Equal @(0, 0, 1366, 697) ([EqAutoLogin.Native]::ComputeUiLayoutRect(1366, 697, "stretch", 1024, 768)) "stretch: canvas fills the client"
Assert-Equal @(448, 120, 1024, 768) ([EqAutoLogin.Native]::ComputeUiLayoutRect(1920, 1009, "FIT ", 1024, 768)) "layout mode is case/space insensitive"
Assert-Equal @(448, 120, 1024, 768) ([EqAutoLogin.Native]::ComputeUiLayoutRect(1920, 1009, "fit", 0, 0)) "invalid canvas size falls back to 1024x768"
Assert-Equal @(448, 120, 1024, 768) ([EqAutoLogin.Native]::ComputeUiLayoutRect(1920, 1009, $null, 1024, 768)) "null layout mode behaves like fit"
$threw = $false
try { [void][EqAutoLogin.Native]::ComputeUiLayoutRect(0, 500, "fit", 1024, 768) } catch { $threw = $true }
Assert-Equal $true $threw "empty client rect throws"

# --- Select-EqRenderWindow ---------------------------------------------------------------

function New-Window {
  param([int]$Handle, [string]$Title, [string]$Class, [int]$W, [int]$H)
  [pscustomobject]@{ Handle = [IntPtr]$Handle; ProcessId = 1; Title = $Title; ClassName = $Class; ClientWidth = $W; ClientHeight = $H; IsMinimized = $false }
}

$splash = New-Window 1 "Splash" "#32770" 400 200
$console = New-Window 2 "" "ConsoleWindowClass" 640 300
$render = New-Window 3 "EverQuest" "_EverQuestwndclass" 1920 1009
$bigRender = New-Window 4 "EverQuest" "_EverQuestwndclass" 3840 2160
Assert-Equal 3 (Select-EqRenderWindow -Windows @($splash, $console, $render)).Handle.ToInt64() "prefers the EverQuest window class over earlier windows"
Assert-Equal 4 (Select-EqRenderWindow -Windows @($render, $bigRender)).Handle.ToInt64() "prefers the largest EverQuest-class window"
Assert-Equal 2 (Select-EqRenderWindow -Windows @($splash, $console)).Handle.ToInt64() "falls back to the largest window with a usable client area"
Assert-Equal $true ($null -eq (Select-EqRenderWindow -Windows @((New-Window 5 "tiny" "x" 100 50)))) "ignores tiny windows"
Assert-Equal $true ($null -eq (Select-EqRenderWindow -Windows @())) "returns null with no windows"

# --- Settings merge ----------------------------------------------------------------------

function Encode-Settings {
  param([string]$Json)
  [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($Json))
}

$defaults = Get-AutoLoginSettings -Base64 "" -BoundParameters @{}
Assert-Equal 45 $defaults.windowWaitSeconds "defaults: windowWaitSeconds"
Assert-Equal "fit" $defaults.uiLayoutMode "defaults: uiLayoutMode"
Assert-Equal @(0.661, 0.757) $defaults.points["eulaAccept"] "defaults: eulaAccept point"

$custom = Get-AutoLoginSettings -Base64 (Encode-Settings '{"windowWaitSeconds":"90","keyDelayMs":30.4,"probeRadiusPx":99,"uiLayoutMode":" Centered","points":{"serverSelectPlay":[0.7,0.71],"usernameField":{"x":0.4,"y":0.5},"passwordField":[7,7],"bogus":[0.1,0.1]}}') -BoundParameters @{}
Assert-Equal 90 $custom.windowWaitSeconds "merge: string numbers are accepted"
Assert-Equal 30 $custom.keyDelayMs "merge: fractional values round"
Assert-Equal 8 $custom.probeRadiusPx "merge: values are clamped to range"
Assert-Equal "centered" $custom.uiLayoutMode "merge: layout mode is normalised"
Assert-Equal @(0.7, 0.71) $custom.points["serverSelectPlay"] "merge: array point override"
Assert-Equal @(0.4, 0.5) $custom.points["usernameField"] "merge: object point override"
Assert-Equal @(0.56, 0.474) $custom.points["passwordField"] "merge: out-of-range point falls back"
Assert-Equal $false $custom.points.Contains("bogus") "merge: unknown points are dropped"

$garbage = Get-AutoLoginSettings -Base64 "not-base64!!" -BoundParameters @{}
Assert-Equal 45 $garbage.windowWaitSeconds "merge: undecodable payload falls back to defaults"

$legacy = Get-AutoLoginSettings -Base64 (Encode-Settings '{"windowWaitSeconds":90}') -BoundParameters @{ WindowWaitSeconds = 120; UdpWaitSeconds = 20; FocusWaitSeconds = 0 }
Assert-Equal 120 $legacy.windowWaitSeconds "legacy: explicit parameter overrides payload"
Assert-Equal 20 $legacy.loginOutcomeWaitSeconds "legacy: UdpWaitSeconds maps to loginOutcomeWaitSeconds"
Assert-Equal 10 $legacy.focusWaitSeconds "legacy: zero-valued parameter is ignored"

# --- Pixel classification ----------------------------------------------------------------

Assert-Equal $true (Test-PixelMajority -Pixels @((New-Pixel 10 10 10), (New-Pixel 10 10 10), (New-Pixel 200 200 200)) -Predicate ${function:Test-DarkPixel}) "majority: 2 of 3 dark wins"
Assert-Equal $false (Test-PixelMajority -Pixels @((New-Pixel 10 10 10), (New-Pixel 200 200 200)) -Predicate ${function:Test-DarkPixel}) "majority: a tie is not a match"
Assert-Equal $false (Test-PixelMajority -Pixels @() -Predicate ${function:Test-DarkPixel}) "majority: no samples is not a match"

$blue = New-Pixel 30 40 150
$bright = New-Pixel 220 220 210
$gray = New-Pixel 80 80 90
$dark = New-Pixel 10 10 10

Assert-Equal "login-form" (Resolve-LoginCanvasState -Probes (New-Probes @{ mainMenuLoginButton = @($gray) })) "state: dark menu + gray login button is the login form"
Assert-Equal "main-menu" (Resolve-LoginCanvasState -Probes (New-Probes @{ mainMenuLogin = @($blue); mainMenuLoginButton = @($gray); mainMenuExitButton = @($gray) })) "state: blue Login + gray buttons is the main menu"
Assert-Equal "login-error" (Resolve-LoginCanvasState -Probes (New-Probes @{ loginErrorButton = @($blue); loginErrorBorder = @($bright); mainMenuLoginButton = @($gray) })) "state: error dialog wins over the login form"
Assert-Equal "advanced" (Resolve-LoginCanvasState -Probes (New-Probes @{})) "state: all dark is unrecognised (advanced)"
Assert-Equal "login-form" (Resolve-LoginCanvasState -Probes (New-Probes @{ mainMenuLoginButton = @($gray, $gray, $gray, $bright, $dark) })) "state: majority vote tolerates two off samples"
Assert-Equal "advanced" (Resolve-LoginCanvasState -Probes (New-Probes @{ mainMenuLoginButton = @($gray, $bright, $bright, $dark, $dark) })) "state: minority gray sample does not classify"

Assert-Equal "mainMenuLogin=30,40,150" (Format-ProbeSummary -Probes ([ordered]@{ mainMenuLogin = (New-ProbeSample -Pixels @($blue)) })) "probe summary formats the centre sample"
$colorRef = Convert-ColorRef -Color 0x00996633
Assert-Equal "51,102,153" "$($colorRef.R),$($colorRef.G),$($colorRef.B)" "COLORREF is decoded as BGR"

Write-Output "# passes $script:passes"
Write-Output "# failures $script:failures"
if ($script:failures -gt 0) {
  exit 1
}
exit 0
