[CmdletBinding()]
param(
  [string]$EqGamePath = "",
  [string]$Username = "",
  # Base64-encoded UTF-8 JSON produced by the launcher (see auto-login-settings.js).
  # Any key that is missing or invalid falls back to the defaults below.
  [string]$SettingsBase64 = "",
  [switch]$EnterWorld,
  # Legacy overrides kept for manual invocation; they win over the settings payload.
  [int]$WindowWaitSeconds = 0,
  [int]$UdpWaitSeconds = 0,
  [int]$LoginFormWaitSeconds = 0,
  [int]$FocusWaitSeconds = 0,
  [int]$ServerSelectWaitSeconds = 0
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$AutoLoginDefaultSettings = [ordered]@{
  windowWaitSeconds = 45
  preLoginWaitSeconds = 25
  loginFormWaitSeconds = 30
  loginOutcomeWaitSeconds = 10
  serverSelectWaitSeconds = 15
  focusWaitSeconds = 10
  preLoginClickIntervalMs = 150
  clickMoveDelayMs = 20
  clickHoldDelayMs = 20
  credentialFocusDelayMs = 120
  keyDelayMs = 8
  postPasswordDelayMs = 150
  loginOutcomeMinimumAgeMs = 2500
  loginOutcomeStableMs = 1200
  credentialClearBackspaceCount = 64
  credentialAttempts = 2
  probeRadiusPx = 1
  uiLayoutMode = "auto"
  uiLayoutWidth = 1024
  uiLayoutHeight = 768
  # Ratios inside the uiLayoutWidth x uiLayoutHeight reference canvas. Probe points sit in the
  # flat interior of buttons/fields (not on borders or text) so a pixel of rounding, DPI
  # stretching or typed characters cannot change what they read.
  points = [ordered]@{
    eulaAccept = @(0.661, 0.757)
    splashContinue = @(0.5, 0.5)
    mainMenuLogin = @(0.4023, 0.474)
    mainMenuLoginRight = @(0.5781, 0.474)
    mainMenuOptions = @(0.4023, 0.5391)
    mainMenuGap = @(0.4023, 0.5716)
    mainMenuExit = @(0.4023, 0.6042)
    mainMenuBelowExit = @(0.4023, 0.6823)
    loginFormUsername = @(0.5781, 0.3893)
    loginFormPassword = @(0.5781, 0.474)
    loginFormLoginButton = @(0.4023, 0.5391)
    loginFormGap = @(0.4023, 0.5716)
    loginFormQuickConnect = @(0.4023, 0.6042)
    loginFormCancel = @(0.4023, 0.6823)
    loginErrorOkLeft = @(0.4609, 0.6081)
    loginErrorOkRight = @(0.5391, 0.6081)
    loginErrorText = @(0.5586, 0.5326)
    loginErrorLeftOfOk = @(0.4219, 0.6081)
    loginErrorRightOfOk = @(0.5781, 0.6081)
    usernameField = @(0.560, 0.390)
    passwordField = @(0.560, 0.474)
    serverSelectPlay = @(0.724, 0.700)
  }
}

$AutoLoginSettingRanges = @{
  windowWaitSeconds = @(1, 300)
  preLoginWaitSeconds = @(1, 120)
  loginFormWaitSeconds = @(1, 120)
  loginOutcomeWaitSeconds = @(1, 120)
  serverSelectWaitSeconds = @(1, 120)
  focusWaitSeconds = @(1, 60)
  preLoginClickIntervalMs = @(50, 5000)
  clickMoveDelayMs = @(0, 1000)
  clickHoldDelayMs = @(0, 1000)
  credentialFocusDelayMs = @(0, 2000)
  keyDelayMs = @(0, 250)
  postPasswordDelayMs = @(0, 2000)
  loginOutcomeMinimumAgeMs = @(0, 30000)
  loginOutcomeStableMs = @(100, 30000)
  credentialClearBackspaceCount = @(0, 256)
  credentialAttempts = @(1, 5)
  probeRadiusPx = @(0, 8)
  uiLayoutWidth = @(320, 8192)
  uiLayoutHeight = @(240, 8192)
}

$AutoLoginLayoutModes = @("auto", "fit", "centered", "stretch")

# The login-screen windows each point lives in. EverQuest draws each one at its native size
# (from uifiles\default\EQLSUI_*.xml), centred in the client and pinned to the top/left edge
# when the client is smaller - which is what uiLayoutMode "auto" models.
$LoginWindowDefinitions = [ordered]@{
  eula = @{ File = "EQLSUI_EulaWnd.xml"; Screen = "EulaWindow"; Width = 640; Height = 480 }
  splash = @{ File = "EQLSUI_SplashExWnd.xml"; Screen = "SplashExWindow"; Width = 640; Height = 480 }
  main = @{ File = "EQLSUI_MainWnd.xml"; Screen = "main"; Width = 1280; Height = 720 }
  connect = @{ File = "EQLSUI_ConnectWnd.xml"; Screen = "connect"; Width = 1280; Height = 720 }
  okdialog = @{ File = "EQLSUI_OKDialog.xml"; Screen = "okdialog"; Width = 640; Height = 480 }
  serverselect = @{ File = "EQLSUI_ServerSelectWnd.xml"; Screen = "serverselect"; Width = 640; Height = 480 }
}

$PointWindows = @{
  eulaAccept = "eula"
  splashContinue = "splash"
  mainMenuLogin = "main"
  mainMenuLoginRight = "main"
  mainMenuOptions = "main"
  mainMenuGap = "main"
  mainMenuExit = "main"
  mainMenuBelowExit = "main"
  loginFormUsername = "connect"
  loginFormPassword = "connect"
  loginFormLoginButton = "connect"
  loginFormGap = "connect"
  loginFormQuickConnect = "connect"
  loginFormCancel = "connect"
  usernameField = "connect"
  passwordField = "connect"
  loginErrorOkLeft = "okdialog"
  loginErrorOkRight = "okdialog"
  loginErrorText = "okdialog"
  loginErrorLeftOfOk = "okdialog"
  loginErrorRightOfOk = "okdialog"
  serverSelectPlay = "serverselect"
}

function Get-LoginWindowSizes {
  param(
    [string]$GameDirectory = ""
  )

  $sizes = [ordered]@{}
  foreach ($windowName in $LoginWindowDefinitions.Keys) {
    $definition = $LoginWindowDefinitions[$windowName]
    $size = [pscustomobject]@{ Width = $definition.Width; Height = $definition.Height; Source = "default" }
    if ($GameDirectory) {
      $path = [System.IO.Path]::Combine($GameDirectory, "uifiles", "default", $definition.File)
      try {
        if (Test-Path -LiteralPath $path) {
          $xml = [System.IO.File]::ReadAllText($path)
          $pattern = '<Screen\s+item\s*=\s*"' + [regex]::Escape($definition.Screen) + '"\s*>.*?<Size>\s*<CX>\s*(\d+)\s*</CX>\s*<CY>\s*(\d+)\s*</CY>\s*</Size>'
          $match = [regex]::Match($xml, $pattern, [System.Text.RegularExpressions.RegexOptions]::Singleline -bor [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
          if ($match.Success) {
            $width = [int]$match.Groups[1].Value
            $height = [int]$match.Groups[2].Value
            if ($width -ge 64 -and $width -le 8192 -and $height -ge 64 -and $height -le 8192) {
              $size = [pscustomobject]@{ Width = $width; Height = $height; Source = $definition.File }
            }
          }
        }
      } catch {
        # Unreadable UI file: keep the stock size.
      }
    }
    $sizes[$windowName] = $size
  }
  return $sizes
}

function Get-SettingsProperty {
  param(
    $Source,
    [string]$Name
  )

  if ($null -eq $Source) {
    return $null
  }

  if ($Source -is [System.Collections.IDictionary]) {
    if ($Source.Contains($Name)) {
      return $Source[$Name]
    }
    return $null
  }

  $property = $Source.PSObject.Properties[$Name]
  if ($null -eq $property) {
    return $null
  }

  return $property.Value
}

function ConvertTo-ClampedInt {
  param(
    $Value,
    [int]$Minimum,
    [int]$Maximum,
    [int]$Fallback
  )

  if ($null -eq $Value -or ($Value -is [string] -and [string]::IsNullOrWhiteSpace($Value))) {
    return $Fallback
  }

  $parsed = 0.0
  if (-not [double]::TryParse([string]$Value, [System.Globalization.NumberStyles]::Float, [System.Globalization.CultureInfo]::InvariantCulture, [ref]$parsed)) {
    return $Fallback
  }
  if ([double]::IsNaN($parsed) -or [double]::IsInfinity($parsed)) {
    return $Fallback
  }

  $rounded = [int][Math]::Round($parsed)
  return [Math]::Min($Maximum, [Math]::Max($Minimum, $rounded))
}

function ConvertTo-RatioPoint {
  param(
    $Value,
    [double[]]$Fallback
  )

  if ($null -eq $Value) {
    return $Fallback
  }

  $x = $null
  $y = $null
  if ($Value -is [System.Collections.IList] -and $Value.Count -ge 2) {
    $x = $Value[0]
    $y = $Value[1]
  } else {
    $x = Get-SettingsProperty -Source $Value -Name "x"
    $y = Get-SettingsProperty -Source $Value -Name "y"
  }

  $parsedX = 0.0
  $parsedY = 0.0
  if ($null -eq $x -or $null -eq $y) {
    return $Fallback
  }
  if (-not [double]::TryParse([string]$x, [System.Globalization.NumberStyles]::Float, [System.Globalization.CultureInfo]::InvariantCulture, [ref]$parsedX)) {
    return $Fallback
  }
  if (-not [double]::TryParse([string]$y, [System.Globalization.NumberStyles]::Float, [System.Globalization.CultureInfo]::InvariantCulture, [ref]$parsedY)) {
    return $Fallback
  }
  if ($parsedX -lt -0.5 -or $parsedX -gt 1.5 -or $parsedY -lt -0.5 -or $parsedY -gt 1.5) {
    return $Fallback
  }

  return @([double]$parsedX, [double]$parsedY)
}

function Merge-AutoLoginSettings {
  param(
    $Overrides
  )

  $settings = [ordered]@{}
  foreach ($key in $AutoLoginDefaultSettings.Keys) {
    if ($key -eq "points") {
      continue
    }

    $default = $AutoLoginDefaultSettings[$key]
    $override = Get-SettingsProperty -Source $Overrides -Name $key
    if ($key -eq "uiLayoutMode") {
      $candidate = if ($null -ne $override) { ([string]$override).Trim().ToLowerInvariant() } else { "" }
      $settings[$key] = if ($AutoLoginLayoutModes -contains $candidate) { $candidate } else { $default }
      continue
    }

    $range = $AutoLoginSettingRanges[$key]
    $settings[$key] = ConvertTo-ClampedInt -Value $override -Minimum $range[0] -Maximum $range[1] -Fallback $default
  }

  $points = [ordered]@{}
  $overridePoints = Get-SettingsProperty -Source $Overrides -Name "points"
  foreach ($pointName in $AutoLoginDefaultSettings.points.Keys) {
    $points[$pointName] = ConvertTo-RatioPoint -Value (Get-SettingsProperty -Source $overridePoints -Name $pointName) -Fallback $AutoLoginDefaultSettings.points[$pointName]
  }
  $settings.points = $points

  return $settings
}

function Get-AutoLoginSettings {
  param(
    [string]$Base64,
    [System.Collections.IDictionary]$BoundParameters
  )

  $overrides = $null
  if (-not [string]::IsNullOrWhiteSpace($Base64)) {
    try {
      $json = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Base64.Trim()))
      $overrides = $json | ConvertFrom-Json
    } catch {
      $overrides = $null
    }
  }

  $settings = Merge-AutoLoginSettings -Overrides $overrides
  $legacyMap = @{
    WindowWaitSeconds = "windowWaitSeconds"
    UdpWaitSeconds = "loginOutcomeWaitSeconds"
    LoginFormWaitSeconds = "loginFormWaitSeconds"
    FocusWaitSeconds = "focusWaitSeconds"
    ServerSelectWaitSeconds = "serverSelectWaitSeconds"
  }
  foreach ($legacyName in $legacyMap.Keys) {
    if ($BoundParameters.ContainsKey($legacyName) -and [int]$BoundParameters[$legacyName] -gt 0) {
      $key = $legacyMap[$legacyName]
      $range = $AutoLoginSettingRanges[$key]
      $settings[$key] = ConvertTo-ClampedInt -Value $BoundParameters[$legacyName] -Minimum $range[0] -Maximum $range[1] -Fallback $settings[$key]
    }
  }

  return $settings
}

function Get-InnerException {
  param(
    $ErrorRecord
  )

  $exception = $ErrorRecord.Exception
  while ($null -ne $exception -and $exception -is [System.Management.Automation.MethodInvocationException] -and $null -ne $exception.InnerException) {
    $exception = $exception.InnerException
  }
  return $exception
}

$stopwatch = [Diagnostics.Stopwatch]::StartNew()

function Write-AutoLoginEvent {
  param(
    [string]$Stage,
    [string]$Message,
    [string]$Tone = "info",
    [string]$StatusState = "",
    [string]$StatusLabel = "",
    [string]$StatusDetail = "",
    [int]$ProgressValue = -1,
    [int]$ProgressMax = 100,
    [string]$ProgressLabel = "",
    [int]$ProcessId = 0
  )

  $payload = [ordered]@{
    stage = $Stage
    message = $Message
    tone = $Tone
    statusState = $StatusState
    statusLabel = $StatusLabel
    statusDetail = $StatusDetail
    progressValue = $ProgressValue
    progressMax = $ProgressMax
    progressLabel = $ProgressLabel
    elapsedMs = [int]$stopwatch.ElapsedMilliseconds
  }
  if ($ProcessId -gt 0) {
    $payload.processId = $ProcessId
  }
  # Write straight to stdout so events emitted inside helper functions are never
  # swallowed by a caller that captures or discards the function's pipeline output.
  [Console]::Out.WriteLine(($payload | ConvertTo-Json -Compress))
  [Console]::Out.Flush()
}

if (-not ([System.Management.Automation.PSTypeName]"EqAutoLogin.Native").Type) {
  Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

namespace EqAutoLogin
{
    public sealed class WindowInfo
    {
        public IntPtr Handle { get; set; }
        public int ProcessId { get; set; }
        public string Title { get; set; }
        public string ClassName { get; set; }
        public int ClientWidth { get; set; }
        public int ClientHeight { get; set; }
        public bool IsMinimized { get; set; }
    }

    public sealed class WindowGeometry
    {
        public string Title { get; set; }
        public string ClassName { get; set; }
        public int Left { get; set; }
        public int Top { get; set; }
        public int Width { get; set; }
        public int Height { get; set; }
        public int ClientLeft { get; set; }
        public int ClientTop { get; set; }
        public int ClientWidth { get; set; }
        public int ClientHeight { get; set; }
        public int LogicalClientWidth { get; set; }
        public int LogicalClientHeight { get; set; }
        public double Scale { get; set; }
        public int Dpi { get; set; }
        public int MonitorDpi { get; set; }
        public int MonitorLeft { get; set; }
        public int MonitorTop { get; set; }
        public int MonitorWidth { get; set; }
        public int MonitorHeight { get; set; }
        public bool IsMaximized { get; set; }
        public bool IsMinimized { get; set; }
        public string LayoutMode { get; set; }
        public int LayoutLeft { get; set; }
        public int LayoutTop { get; set; }
        public int LayoutWidth { get; set; }
        public int LayoutHeight { get; set; }
    }

    public sealed class ClickResult
    {
        public int X { get; set; }
        public int Y { get; set; }
        public int CursorX { get; set; }
        public int CursorY { get; set; }
        public bool CursorVerified { get; set; }
        public IntPtr WindowAtPoint { get; set; }
        public bool PointerOnTarget { get; set; }
        public bool Clicked { get; set; }
        public string WindowAtPointTitle { get; set; }
        public string WindowAtPointClass { get; set; }
    }

    public static class Native
    {
        private const int SW_RESTORE = 9;
        private const uint GA_ROOT = 2;
        private const uint MONITOR_DEFAULTTONULL = 0;
        private const uint MONITOR_DEFAULTTONEAREST = 2;
        private const int DWMWA_EXTENDED_FRAME_BOUNDS = 9;
        private const uint SRCCOPY = 0x00CC0020;
        public const int INVALID_PIXEL = -1;
        public const int COVERED_PIXEL = -2;

        // Set by GetWindowRelativePixels: how many samples another window covered, and one of them.
        public static int LastCoveredSamples;
        public static IntPtr LastCoveringWindow;
        private const uint SWP_NOSIZE = 0x0001;
        private const uint SWP_NOZORDER = 0x0004;
        private const uint SWP_NOACTIVATE = 0x0010;
        private const uint ASFW_ANY = 0xFFFFFFFF;
        private static readonly IntPtr DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 = new IntPtr(-4);
        private const int DEFAULT_UI_WIDTH = 1024;
        private const int DEFAULT_UI_HEIGHT = 768;
        private const uint INPUT_MOUSE = 0;
        private const uint INPUT_KEYBOARD = 1;
        private const uint KEYEVENTF_KEYUP = 0x0002;
        private const uint KEYEVENTF_UNICODE = 0x0004;
        private const uint KEYEVENTF_SCANCODE = 0x0008;
        private const uint MAPVK_VK_TO_VSC = 0;
        private const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
        private const uint MOUSEEVENTF_LEFTUP = 0x0004;
        private const ushort VK_RETURN = 0x0D;
        private const ushort VK_CONTROL = 0x11;
        private const ushort VK_SHIFT = 0x10;
        private const ushort VK_MENU = 0x12;
        private const ushort VK_BACK = 0x08;

        private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

        [StructLayout(LayoutKind.Sequential)]
        private struct RECT
        {
            public int Left;
            public int Top;
            public int Right;
            public int Bottom;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct POINT
        {
            public int X;
            public int Y;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct MONITORINFO
        {
            public uint cbSize;
            public RECT rcMonitor;
            public RECT rcWork;
            public uint dwFlags;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct INPUT
        {
            public uint type;
            public InputUnion U;
        }

        [StructLayout(LayoutKind.Explicit)]
        private struct InputUnion
        {
            [FieldOffset(0)]
            public MOUSEINPUT mi;
            [FieldOffset(0)]
            public KEYBDINPUT ki;
            [FieldOffset(0)]
            public HARDWAREINPUT hi;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct MOUSEINPUT
        {
            public int dx;
            public int dy;
            public uint mouseData;
            public uint dwFlags;
            public uint time;
            public UIntPtr dwExtraInfo;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct KEYBDINPUT
        {
            public ushort wVk;
            public ushort wScan;
            public uint dwFlags;
            public uint time;
            public UIntPtr dwExtraInfo;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct HARDWAREINPUT
        {
            public uint uMsg;
            public ushort wParamL;
            public ushort wParamH;
        }

        [DllImport("user32.dll")]
        private static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

        [DllImport("user32.dll")]
        private static extern bool IsWindowVisible(IntPtr hWnd);

        [DllImport("user32.dll")]
        private static extern bool IsWindow(IntPtr hWnd);

        [DllImport("user32.dll", SetLastError = true)]
        private static extern int GetWindowTextLength(IntPtr hWnd);

        [DllImport("user32.dll", SetLastError = true)]
        private static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

        [DllImport("user32.dll", SetLastError = true)]
        private static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);

        [DllImport("user32.dll", SetLastError = true)]
        private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

        [DllImport("user32.dll")]
        private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

        [DllImport("user32.dll")]
        private static extern bool IsIconic(IntPtr hWnd);

        [DllImport("user32.dll")]
        private static extern bool IsZoomed(IntPtr hWnd);

        [DllImport("user32.dll")]
        private static extern bool SetForegroundWindow(IntPtr hWnd);

        [DllImport("user32.dll")]
        private static extern IntPtr GetForegroundWindow();

        [DllImport("user32.dll")]
        private static extern bool BringWindowToTop(IntPtr hWnd);

        [DllImport("user32.dll")]
        private static extern void SwitchToThisWindow(IntPtr hWnd, bool fAltTab);

        [DllImport("user32.dll")]
        private static extern bool AllowSetForegroundWindow(uint dwProcessId);

        [DllImport("user32.dll")]
        private static extern bool SetProcessDPIAware();

        [DllImport("user32.dll", SetLastError = true)]
        private static extern bool SetProcessDpiAwarenessContext(IntPtr value);

        [DllImport("user32.dll", SetLastError = true)]
        private static extern IntPtr SetThreadDpiAwarenessContext(IntPtr value);

        [DllImport("user32.dll")]
        private static extern uint GetDpiForWindow(IntPtr hWnd);

        [DllImport("kernel32.dll")]
        private static extern uint GetCurrentThreadId();

        [DllImport("user32.dll")]
        private static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);

        [DllImport("user32.dll", SetLastError = true)]
        private static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

        [DllImport("user32.dll")]
        private static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

        [DllImport("user32.dll", SetLastError = true)]
        private static extern bool GetClientRect(IntPtr hWnd, out RECT lpRect);

        [DllImport("user32.dll", SetLastError = true)]
        private static extern bool ClientToScreen(IntPtr hWnd, ref POINT lpPoint);

        [DllImport("user32.dll", SetLastError = true)]
        private static extern IntPtr GetDC(IntPtr hWnd);

        [DllImport("user32.dll", SetLastError = true)]
        private static extern int ReleaseDC(IntPtr hWnd, IntPtr hDC);

        [DllImport("gdi32.dll", SetLastError = true)]
        private static extern uint GetPixel(IntPtr hdc, int x, int y);

        [DllImport("user32.dll")]
        private static extern bool SetCursorPos(int X, int Y);

        [DllImport("user32.dll")]
        private static extern bool GetCursorPos(out POINT lpPoint);

        [DllImport("user32.dll")]
        private static extern IntPtr WindowFromPoint(POINT point);

        [DllImport("user32.dll")]
        private static extern IntPtr GetAncestor(IntPtr hWnd, uint gaFlags);

        [DllImport("user32.dll")]
        private static extern IntPtr MonitorFromWindow(IntPtr hWnd, uint dwFlags);

        [DllImport("user32.dll")]
        private static extern IntPtr MonitorFromPoint(POINT pt, uint dwFlags);

        [DllImport("user32.dll")]
        private static extern IntPtr GetWindowDpiAwarenessContext(IntPtr hWnd);

        [DllImport("shcore.dll")]
        private static extern int GetDpiForMonitor(IntPtr hMonitor, int dpiType, out uint dpiX, out uint dpiY);

        [DllImport("dwmapi.dll")]
        private static extern int DwmGetWindowAttribute(IntPtr hWnd, int dwAttribute, out RECT pvAttribute, int cbAttribute);

        [DllImport("gdi32.dll", SetLastError = true)]
        private static extern IntPtr CreateCompatibleDC(IntPtr hdc);

        [DllImport("gdi32.dll", SetLastError = true)]
        private static extern IntPtr CreateCompatibleBitmap(IntPtr hdc, int width, int height);

        [DllImport("gdi32.dll")]
        private static extern IntPtr SelectObject(IntPtr hdc, IntPtr obj);

        [DllImport("gdi32.dll", SetLastError = true)]
        private static extern bool BitBlt(IntPtr hdcDest, int xDest, int yDest, int width, int height, IntPtr hdcSrc, int xSrc, int ySrc, uint rop);

        [DllImport("gdi32.dll")]
        private static extern bool DeleteObject(IntPtr obj);

        [DllImport("gdi32.dll")]
        private static extern bool DeleteDC(IntPtr hdc);

        [DllImport("user32.dll")]
        private static extern bool GetMonitorInfo(IntPtr hMonitor, ref MONITORINFO lpmi);

        [DllImport("user32.dll", SetLastError = true)]
        private static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);

        [DllImport("user32.dll")]
        private static extern short VkKeyScanEx(char ch, IntPtr dwhkl);

        [DllImport("user32.dll")]
        private static extern uint MapVirtualKeyEx(uint uCode, uint uMapType, IntPtr dwhkl);

        [DllImport("user32.dll")]
        private static extern IntPtr GetKeyboardLayout(uint idThread);

        public static WindowInfo[] GetProcessWindows(int processId)
        {
            var windows = new List<WindowInfo>();
            EnumWindows((hWnd, lParam) =>
            {
                if (!IsWindowVisible(hWnd))
                {
                    return true;
                }

                uint windowProcessId;
                GetWindowThreadProcessId(hWnd, out windowProcessId);
                if (windowProcessId != processId)
                {
                    return true;
                }

                RECT clientRect;
                int clientWidth = 0;
                int clientHeight = 0;
                if (GetClientRect(hWnd, out clientRect))
                {
                    clientWidth = clientRect.Right - clientRect.Left;
                    clientHeight = clientRect.Bottom - clientRect.Top;
                }

                windows.Add(new WindowInfo
                {
                    Handle = hWnd,
                    ProcessId = (int)windowProcessId,
                    Title = GetTitle(hWnd),
                    ClassName = GetClass(hWnd),
                    ClientWidth = clientWidth,
                    ClientHeight = clientHeight,
                    IsMinimized = IsIconic(hWnd)
                });
                return true;
            }, IntPtr.Zero);

            return windows.ToArray();
        }

        public static bool IsWindowAlive(IntPtr hWnd)
        {
            return hWnd != IntPtr.Zero && IsWindow(hWnd);
        }

        public static void EnableDpiAwareness()
        {
            try
            {
                if (SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2))
                {
                    return;
                }
            }
            catch (EntryPointNotFoundException)
            {
            }
            catch (DllNotFoundException)
            {
            }

            try
            {
                SetProcessDPIAware();
            }
            catch (EntryPointNotFoundException)
            {
            }
            catch (DllNotFoundException)
            {
            }
        }

        public static bool FocusWindow(IntPtr hWnd, int attempt)
        {
            if (!IsWindowAlive(hWnd))
            {
                return false;
            }

            if (IsIconic(hWnd))
            {
                ShowWindow(hWnd, SW_RESTORE);
            }

            if (GetForegroundWindow() == hWnd)
            {
                return true;
            }

            // Escalate: plain SetForegroundWindow with thread input attached, then the
            // ALT-tap trick that releases the foreground lock, then the Alt-Tab switcher path.
            int strategy = attempt % 3;
            if (strategy == 1)
            {
                TapVirtualKey(VK_MENU);
            }

            AllowSetForegroundWindow(ASFW_ANY);
            IntPtr foreground = GetForegroundWindow();
            uint currentThread = GetCurrentThreadId();
            uint targetProcessId;
            uint targetThread = GetWindowThreadProcessId(hWnd, out targetProcessId);
            uint foregroundThread = 0;
            if (foreground != IntPtr.Zero)
            {
                uint foregroundProcessId;
                foregroundThread = GetWindowThreadProcessId(foreground, out foregroundProcessId);
            }

            if (targetThread != 0)
            {
                AttachThreadInput(currentThread, targetThread, true);
            }
            if (foregroundThread != 0 && foregroundThread != targetThread)
            {
                AttachThreadInput(currentThread, foregroundThread, true);
            }

            try
            {
                if (strategy == 2)
                {
                    SwitchToThisWindow(hWnd, true);
                    BringWindowToTop(hWnd);
                }
                bool result = SetForegroundWindow(hWnd);
                if (strategy != 0)
                {
                    BringWindowToTop(hWnd);
                }
                return result || GetForegroundWindow() == hWnd;
            }
            finally
            {
                if (foregroundThread != 0 && foregroundThread != targetThread)
                {
                    AttachThreadInput(currentThread, foregroundThread, false);
                }
                if (targetThread != 0)
                {
                    AttachThreadInput(currentThread, targetThread, false);
                }
            }
        }

        public static bool IsForegroundWindow(IntPtr hWnd)
        {
            return hWnd != IntPtr.Zero && GetForegroundWindow() == hWnd;
        }

        public static IntPtr GetForegroundWindowHandle()
        {
            return GetForegroundWindow();
        }

        public static string DescribeWindow(IntPtr hWnd)
        {
            if (hWnd == IntPtr.Zero || !IsWindow(hWnd))
            {
                // Windows reports no foreground window for a moment while focus is switching.
                return "no window (focus was switching)";
            }

            uint processId;
            GetWindowThreadProcessId(hWnd, out processId);
            return "'" + GetTitle(hWnd) + "' [" + GetClass(hWnd) + "] pid " + processId;
        }

        public static bool EnsureWindowOnScreen(IntPtr hWnd)
        {
            IntPtr previousDpiContext = EnterDpiAwareThreadContext();
            try
            {
                if (!IsWindowAlive(hWnd) || IsZoomed(hWnd) || IsIconic(hWnd))
                {
                    return false;
                }

                // Leave the window alone while every corner of its client area is on some
                // monitor: that covers windows flush with an edge (whose invisible DWM resize
                // borders overhang the work area) and windows deliberately spanning monitors.
                // Moving them would needlessly rewrite the position EQ saves to eqclient.ini.
                ClientMapping mapping = GetClientMapping(hWnd);
                if (mapping.PhysicalWidth <= 0 || mapping.PhysicalHeight <= 0)
                {
                    return false;
                }
                if (IsScreenRectOnMonitors(mapping.PhysicalOrigin.X, mapping.PhysicalOrigin.Y, mapping.PhysicalWidth, mapping.PhysicalHeight))
                {
                    return false;
                }

                RECT windowRect;
                if (!GetWindowRect(hWnd, out windowRect))
                {
                    return false;
                }

                RECT visible;
                if (!TryGetVisibleFrame(hWnd, out visible))
                {
                    visible = windowRect;
                }

                RECT work;
                if (!TryGetMonitorWorkArea(hWnd, out work))
                {
                    return false;
                }

                int dx = 0;
                int dy = 0;
                if (visible.Right > work.Right)
                {
                    dx = work.Right - visible.Right;
                }
                if (visible.Left + dx < work.Left)
                {
                    dx = work.Left - visible.Left;
                }
                if (visible.Bottom > work.Bottom)
                {
                    dy = work.Bottom - visible.Bottom;
                }
                if (visible.Top + dy < work.Top)
                {
                    dy = work.Top - visible.Top;
                }

                if (dx == 0 && dy == 0)
                {
                    return false;
                }

                return SetWindowPos(hWnd, IntPtr.Zero, windowRect.Left + dx, windowRect.Top + dy, 0, 0, SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE);
            }
            finally
            {
                RestoreDpiThreadContext(previousDpiContext);
            }
        }

        public static WindowGeometry GetWindowGeometry(IntPtr hWnd, string layoutMode, int uiWidth, int uiHeight)
        {
            return GetWindowGeometry(hWnd, layoutMode, uiWidth, uiHeight, uiWidth, uiHeight);
        }

        // Layout values are in the window's own (logical) client coordinates; Client* values are
        // physical screen pixels. They differ only when Windows bitmap-stretches a DPI-unaware
        // client (eqgame.exe) on a monitor scaled above 100%.
        public static WindowGeometry GetWindowGeometry(IntPtr hWnd, string layoutMode, int uiWidth, int uiHeight, int screenWidth, int screenHeight)
        {
            IntPtr previousDpiContext = EnterDpiAwareThreadContext();
            try
            {
                var geometry = new WindowGeometry
                {
                    Title = GetTitle(hWnd),
                    ClassName = GetClass(hWnd),
                    IsMaximized = IsZoomed(hWnd),
                    IsMinimized = IsIconic(hWnd),
                    LayoutMode = layoutMode
                };

                RECT windowRect;
                if (GetWindowRect(hWnd, out windowRect))
                {
                    geometry.Left = windowRect.Left;
                    geometry.Top = windowRect.Top;
                    geometry.Width = windowRect.Right - windowRect.Left;
                    geometry.Height = windowRect.Bottom - windowRect.Top;
                }

                ClientMapping mapping = GetClientMapping(hWnd);
                geometry.ClientLeft = mapping.PhysicalOrigin.X;
                geometry.ClientTop = mapping.PhysicalOrigin.Y;
                geometry.ClientWidth = mapping.PhysicalWidth;
                geometry.ClientHeight = mapping.PhysicalHeight;
                geometry.LogicalClientWidth = mapping.LogicalWidth;
                geometry.LogicalClientHeight = mapping.LogicalHeight;
                geometry.Scale = mapping.ScaleX;
                if (mapping.LogicalWidth > 0 && mapping.LogicalHeight > 0)
                {
                    int[] layout = ComputeUiLayoutRect(mapping.LogicalWidth, mapping.LogicalHeight, layoutMode, uiWidth, uiHeight, screenWidth, screenHeight);
                    geometry.LayoutLeft = layout[0];
                    geometry.LayoutTop = layout[1];
                    geometry.LayoutWidth = layout[2];
                    geometry.LayoutHeight = layout[3];
                }

                try
                {
                    geometry.Dpi = (int)GetDpiForWindow(hWnd);
                }
                catch (EntryPointNotFoundException)
                {
                    geometry.Dpi = 0;
                }
                geometry.MonitorDpi = GetMonitorDpi(hWnd);

                RECT monitor;
                if (TryGetMonitorRect(hWnd, out monitor))
                {
                    geometry.MonitorLeft = monitor.Left;
                    geometry.MonitorTop = monitor.Top;
                    geometry.MonitorWidth = monitor.Right - monitor.Left;
                    geometry.MonitorHeight = monitor.Bottom - monitor.Top;
                }

                return geometry;
            }
            finally
            {
                RestoreDpiThreadContext(previousDpiContext);
            }
        }

        public static int[] ComputeUiLayoutRect(int clientWidth, int clientHeight, string layoutMode, int uiWidth, int uiHeight)
        {
            return ComputeUiLayoutRect(clientWidth, clientHeight, layoutMode, uiWidth, uiHeight, uiWidth, uiHeight);
        }

        // Returns { left, top, width, height } of the uiWidth x uiHeight reference canvas that the
        // click/probe ratios are measured in, in client coordinates.
        //  auto     - how the EQ login screen really lays out: each login window (screenWidth x
        //             screenHeight, from EQLSUI_*.xml) is drawn at native size, centred in the
        //             client, and pinned to the top/left edge when the client is smaller than it.
        //             The canvas is positioned where it sits relative to that window when centred.
        //  fit      - shrink the canvas to fit the client, keep aspect, centre it (legacy behaviour)
        //  centered - fixed canvas centred in the client; may hang past the edges (clipped UI)
        //  stretch  - the canvas fills the whole client area
        public static int[] ComputeUiLayoutRect(int clientWidth, int clientHeight, string layoutMode, int uiWidth, int uiHeight, int screenWidth, int screenHeight)
        {
            if (clientWidth <= 0 || clientHeight <= 0)
            {
                throw new InvalidOperationException("The target client rectangle is empty.");
            }

            if (uiWidth <= 0 || uiHeight <= 0)
            {
                uiWidth = DEFAULT_UI_WIDTH;
                uiHeight = DEFAULT_UI_HEIGHT;
            }

            string mode = (layoutMode ?? string.Empty).Trim().ToLowerInvariant();
            if (mode == "auto")
            {
                int windowWidth = screenWidth > 0 ? screenWidth : uiWidth;
                int windowHeight = screenHeight > 0 ? screenHeight : uiHeight;
                int windowLeft = Math.Max(0, (clientWidth - windowWidth) / 2);
                int windowTop = Math.Max(0, (clientHeight - windowHeight) / 2);
                return new int[] { windowLeft + ((windowWidth - uiWidth) / 2), windowTop + ((windowHeight - uiHeight) / 2), uiWidth, uiHeight };
            }

            if (mode == "stretch")
            {
                return new int[] { 0, 0, clientWidth, clientHeight };
            }

            if (mode == "centered")
            {
                return new int[] { (clientWidth - uiWidth) / 2, (clientHeight - uiHeight) / 2, uiWidth, uiHeight };
            }

            int targetWidth = Math.Min(clientWidth, uiWidth);
            int targetHeight = Math.Min(clientHeight, uiHeight);
            double targetAspect = (double)uiWidth / uiHeight;
            double currentAspect = (double)targetWidth / targetHeight;
            if (currentAspect > targetAspect)
            {
                targetWidth = (int)Math.Round(targetHeight * targetAspect);
            }
            else if (currentAspect < targetAspect)
            {
                targetHeight = (int)Math.Round(targetWidth / targetAspect);
            }

            int left = Math.Max(0, (clientWidth - targetWidth) / 2);
            int top = Math.Max(0, (clientHeight - targetHeight) / 2);
            return new int[] { left, top, targetWidth, targetHeight };
        }

        public static int[] GetWindowRelativeScreenPoint(IntPtr hWnd, double xRatio, double yRatio, string layoutMode, int uiWidth, int uiHeight, int screenWidth, int screenHeight)
        {
            IntPtr previousDpiContext = EnterDpiAwareThreadContext();
            try
            {
                POINT point = ResolvePhysicalPoint(GetClientMapping(hWnd), xRatio, yRatio, layoutMode, uiWidth, uiHeight, screenWidth, screenHeight);
                return new int[] { point.X, point.Y };
            }
            finally
            {
                RestoreDpiThreadContext(previousDpiContext);
            }
        }

        public static ClickResult ClickWindowRelative(IntPtr hWnd, double xRatio, double yRatio, int moveDelayMilliseconds, int holdDelayMilliseconds, string layoutMode, int uiWidth, int uiHeight)
        {
            return ClickWindowRelative(hWnd, xRatio, yRatio, moveDelayMilliseconds, holdDelayMilliseconds, layoutMode, uiWidth, uiHeight, uiWidth, uiHeight);
        }

        public static ClickResult ClickWindowRelative(IntPtr hWnd, double xRatio, double yRatio, int moveDelayMilliseconds, int holdDelayMilliseconds, string layoutMode, int uiWidth, int uiHeight, int screenWidth, int screenHeight)
        {
            IntPtr previousDpiContext = EnterDpiAwareThreadContext();
            try
            {
                POINT point = ResolvePhysicalPoint(GetClientMapping(hWnd), xRatio, yRatio, layoutMode, uiWidth, uiHeight, screenWidth, screenHeight);
                var result = new ClickResult { X = point.X, Y = point.Y };

                POINT cursor = new POINT();
                bool haveCursor = false;
                for (int attempt = 0; attempt < 3; attempt += 1)
                {
                    SetCursorPos(point.X, point.Y);
                    Thread.Sleep(attempt == 0 ? 0 : 15);
                    if (GetCursorPos(out cursor))
                    {
                        haveCursor = true;
                        if (Math.Abs(cursor.X - point.X) <= 1 && Math.Abs(cursor.Y - point.Y) <= 1)
                        {
                            result.CursorVerified = true;
                            break;
                        }
                    }
                }
                result.CursorX = cursor.X;
                result.CursorY = cursor.Y;

                // Hit-test where the button press will actually land (the real cursor position)
                // and never click when that is some other application's window.
                POINT hit = haveCursor ? cursor : point;
                IntPtr windowAtPoint = GetAncestor(WindowFromPoint(hit), GA_ROOT);
                result.WindowAtPoint = windowAtPoint;
                result.PointerOnTarget = windowAtPoint == hWnd;
                if (!result.PointerOnTarget)
                {
                    if (windowAtPoint != IntPtr.Zero)
                    {
                        result.WindowAtPointTitle = GetTitle(windowAtPoint);
                        result.WindowAtPointClass = GetClass(windowAtPoint);
                    }
                    return result;
                }

                if (moveDelayMilliseconds > 0)
                {
                    Thread.Sleep(moveDelayMilliseconds);
                }
                SendMouseButton(MOUSEEVENTF_LEFTDOWN);
                if (holdDelayMilliseconds > 0)
                {
                    Thread.Sleep(holdDelayMilliseconds);
                }
                SendMouseButton(MOUSEEVENTF_LEFTUP);
                result.Clicked = true;
                return result;
            }
            finally
            {
                RestoreDpiThreadContext(previousDpiContext);
            }
        }

        // Samples every probe in one pass: for each (x, y) ratio pair it reads the centre pixel
        // plus four neighbours (radius px) so a one-pixel rounding difference between machines
        // cannot flip the classification. The bounding box of all samples is copied off the
        // screen with a single BitBlt, because GetPixel on the screen DC is a separate
        // compositor read-back per call. Samples that are not on any monitor are INVALID_PIXEL.
        public static int[] GetWindowRelativePixels(IntPtr hWnd, double[] ratios, int radius, string layoutMode, int uiWidth, int uiHeight)
        {
            return GetWindowRelativePixels(hWnd, ratios, null, radius, layoutMode, uiWidth, uiHeight);
        }

        // screenSizes: optional width/height pair per probe - the size of the login window the
        // probe belongs to (see ComputeUiLayoutRect "auto").
        public static int[] GetWindowRelativePixels(IntPtr hWnd, double[] ratios, int[] screenSizes, int radius, string layoutMode, int uiWidth, int uiHeight)
        {
            if (ratios == null || ratios.Length == 0 || ratios.Length % 2 != 0)
            {
                throw new ArgumentException("Pixel probes must be given as x/y ratio pairs.");
            }
            if (screenSizes != null && screenSizes.Length != ratios.Length)
            {
                throw new ArgumentException("Pixel probes need one window width/height pair per x/y ratio pair.");
            }

            IntPtr previousDpiContext = EnterDpiAwareThreadContext();
            IntPtr screenDc = IntPtr.Zero;
            IntPtr memoryDc = IntPtr.Zero;
            IntPtr bitmap = IntPtr.Zero;
            IntPtr previousBitmap = IntPtr.Zero;
            try
            {
                int[] offsetsX = radius > 0 ? new int[] { 0, -radius, radius, 0, 0 } : new int[] { 0 };
                int[] offsetsY = radius > 0 ? new int[] { 0, 0, 0, -radius, radius } : new int[] { 0 };
                int probeCount = ratios.Length / 2;
                var samples = new POINT[probeCount * offsetsX.Length];
                var onScreen = new bool[samples.Length];
                int minX = int.MaxValue, minY = int.MaxValue, maxX = int.MinValue, maxY = int.MinValue;
                var covered = new bool[samples.Length];
                LastCoveredSamples = 0;
                LastCoveringWindow = IntPtr.Zero;
                ClientMapping mapping = GetClientMapping(hWnd);
                for (int probe = 0; probe < probeCount; probe += 1)
                {
                    int screenWidth = screenSizes != null ? screenSizes[probe * 2] : uiWidth;
                    int screenHeight = screenSizes != null ? screenSizes[(probe * 2) + 1] : uiHeight;
                    POINT centre = ResolvePhysicalPoint(mapping, ratios[probe * 2], ratios[(probe * 2) + 1], layoutMode, uiWidth, uiHeight, screenWidth, screenHeight);
                    for (int offset = 0; offset < offsetsX.Length; offset += 1)
                    {
                        int index = (probe * offsetsX.Length) + offset;
                        samples[index] = new POINT { X = centre.X + offsetsX[offset], Y = centre.Y + offsetsY[offset] };
                        onScreen[index] = MonitorFromPoint(samples[index], MONITOR_DEFAULTTONULL) != IntPtr.Zero;
                        if (onScreen[index])
                        {
                            // Never read another window's pixels as EverQuest's.
                            IntPtr root = GetAncestor(WindowFromPoint(samples[index]), GA_ROOT);
                            if (root != hWnd)
                            {
                                covered[index] = true;
                                onScreen[index] = false;
                                LastCoveredSamples += 1;
                                if (LastCoveringWindow == IntPtr.Zero)
                                {
                                    LastCoveringWindow = root;
                                }
                            }
                        }
                        if (onScreen[index])
                        {
                            minX = Math.Min(minX, samples[index].X);
                            minY = Math.Min(minY, samples[index].Y);
                            maxX = Math.Max(maxX, samples[index].X);
                            maxY = Math.Max(maxY, samples[index].Y);
                        }
                    }
                }

                var colors = new int[samples.Length];
                for (int index = 0; index < colors.Length; index += 1)
                {
                    colors[index] = covered[index] ? COVERED_PIXEL : INVALID_PIXEL;
                }
                if (minX > maxX)
                {
                    return colors;
                }

                int width = (maxX - minX) + 1;
                int height = (maxY - minY) + 1;
                screenDc = GetDC(IntPtr.Zero);
                if (screenDc == IntPtr.Zero)
                {
                    throw new Win32Exception(Marshal.GetLastWin32Error(), "Unable to read the screen device context.");
                }
                memoryDc = CreateCompatibleDC(screenDc);
                bitmap = CreateCompatibleBitmap(screenDc, width, height);
                if (memoryDc == IntPtr.Zero || bitmap == IntPtr.Zero)
                {
                    throw new Win32Exception(Marshal.GetLastWin32Error(), "Unable to allocate a " + width + "x" + height + " screen capture buffer.");
                }
                previousBitmap = SelectObject(memoryDc, bitmap);
                if (!BitBlt(memoryDc, 0, 0, width, height, screenDc, minX, minY, SRCCOPY))
                {
                    throw new Win32Exception(Marshal.GetLastWin32Error(), "Unable to copy the screen area at " + minX + "," + minY + " (" + width + "x" + height + ").");
                }

                for (int index = 0; index < samples.Length; index += 1)
                {
                    if (!onScreen[index])
                    {
                        continue;
                    }
                    uint color = GetPixel(memoryDc, samples[index].X - minX, samples[index].Y - minY);
                    colors[index] = color == 0xFFFFFFFF ? INVALID_PIXEL : unchecked((int)color);
                }

                return colors;
            }
            finally
            {
                if (previousBitmap != IntPtr.Zero)
                {
                    SelectObject(memoryDc, previousBitmap);
                }
                if (bitmap != IntPtr.Zero)
                {
                    DeleteObject(bitmap);
                }
                if (memoryDc != IntPtr.Zero)
                {
                    DeleteDC(memoryDc);
                }
                if (screenDc != IntPtr.Zero)
                {
                    ReleaseDC(IntPtr.Zero, screenDc);
                }
                RestoreDpiThreadContext(previousDpiContext);
            }
        }

        public static int GetPixelSamplesPerProbe(int radius)
        {
            return radius > 0 ? 5 : 1;
        }

        // The client area as EverQuest itself sees it (logical) and where it really is on screen
        // (physical). eqgame.exe is DPI-unaware, so on a monitor scaled above 100% Windows renders
        // it at 96 DPI and bitmap-stretches the result: the login UI is laid out in logical pixels
        // but must be clicked and read in physical ones.
        private sealed class ClientMapping
        {
            public POINT LogicalOrigin;
            public int LogicalWidth;
            public int LogicalHeight;
            public POINT PhysicalOrigin;
            public double ScaleX = 1.0;
            public double ScaleY = 1.0;

            public int PhysicalWidth { get { return (int)Math.Round(LogicalWidth * ScaleX); } }
            public int PhysicalHeight { get { return (int)Math.Round(LogicalHeight * ScaleY); } }
        }

        // Reads the client rectangle twice: in EverQuest's own DPI context (the logical size its
        // login UI is laid out in) and per-monitor aware (where it really is, in physical pixels).
        // Measured on a DPI-unaware eqgame.exe at 150%: 1280x670 at 103,126 logical versus
        // 1920x1005 at 155,189 physical. The ratio of the two sizes is the stretch factor.
        private static ClientMapping GetClientMapping(IntPtr hWnd)
        {
            if (!IsWindowAlive(hWnd))
            {
                throw new InvalidOperationException("The EverQuest window handle is no longer valid.");
            }

            RECT logicalRect;
            var logicalOrigin = new POINT { X = 0, Y = 0 };
            IntPtr previousDpiContext = EnterWindowDpiContext(hWnd);
            try
            {
                if (!GetClientRect(hWnd, out logicalRect))
                {
                    throw new Win32Exception(Marshal.GetLastWin32Error(), "Unable to read the target client rectangle.");
                }
                ClientToScreen(hWnd, ref logicalOrigin);
            }
            finally
            {
                RestoreDpiThreadContext(previousDpiContext);
            }

            RECT physicalRect;
            var physicalOrigin = new POINT { X = 0, Y = 0 };
            previousDpiContext = EnterDpiAwareThreadContext();
            try
            {
                if (!GetClientRect(hWnd, out physicalRect))
                {
                    throw new Win32Exception(Marshal.GetLastWin32Error(), "Unable to read the target client rectangle.");
                }
                if (!ClientToScreen(hWnd, ref physicalOrigin))
                {
                    throw new Win32Exception(Marshal.GetLastWin32Error(), "Unable to translate the target client origin.");
                }
            }
            finally
            {
                RestoreDpiThreadContext(previousDpiContext);
            }

            var mapping = new ClientMapping
            {
                LogicalOrigin = logicalOrigin,
                LogicalWidth = logicalRect.Right - logicalRect.Left,
                LogicalHeight = logicalRect.Bottom - logicalRect.Top,
                PhysicalOrigin = physicalOrigin
            };

            int physicalWidth = physicalRect.Right - physicalRect.Left;
            int physicalHeight = physicalRect.Bottom - physicalRect.Top;
            if (mapping.LogicalWidth > 0 && mapping.LogicalHeight > 0 && physicalWidth > 0 && physicalHeight > 0)
            {
                double scaleX = (double)physicalWidth / mapping.LogicalWidth;
                double scaleY = (double)physicalHeight / mapping.LogicalHeight;
                if (scaleX >= 0.5 && scaleX <= 5.0 && scaleY >= 0.5 && scaleY <= 5.0)
                {
                    mapping.ScaleX = scaleX;
                    mapping.ScaleY = scaleY;
                }
            }
            else if (physicalWidth > 0 && physicalHeight > 0)
            {
                // No window-context read available: treat the physical client as the layout space.
                mapping.LogicalWidth = physicalWidth;
                mapping.LogicalHeight = physicalHeight;
            }

            return mapping;
        }

        private static POINT ResolvePhysicalPoint(ClientMapping mapping, double xRatio, double yRatio, string layoutMode, int uiWidth, int uiHeight, int screenWidth, int screenHeight)
        {
            int[] layout = ComputeUiLayoutRect(mapping.LogicalWidth, mapping.LogicalHeight, layoutMode, uiWidth, uiHeight, screenWidth, screenHeight);
            double logicalX = layout[0] + Math.Round(layout[2] * xRatio);
            double logicalY = layout[1] + Math.Round(layout[3] * yRatio);
            return new POINT
            {
                X = mapping.PhysicalOrigin.X + (int)Math.Round(logicalX * mapping.ScaleX),
                Y = mapping.PhysicalOrigin.Y + (int)Math.Round(logicalY * mapping.ScaleY)
            };
        }

        private static IntPtr EnterWindowDpiContext(IntPtr hWnd)
        {
            try
            {
                IntPtr windowContext = GetWindowDpiAwarenessContext(hWnd);
                return windowContext == IntPtr.Zero ? IntPtr.Zero : SetThreadDpiAwarenessContext(windowContext);
            }
            catch (EntryPointNotFoundException)
            {
                return IntPtr.Zero;
            }
        }

        private static int GetMonitorDpi(IntPtr hWnd)
        {
            try
            {
                IntPtr monitor = MonitorFromWindow(hWnd, MONITOR_DEFAULTTONEAREST);
                uint dpiX;
                uint dpiY;
                return monitor != IntPtr.Zero && GetDpiForMonitor(monitor, 0, out dpiX, out dpiY) == 0 ? (int)dpiX : 0;
            }
            catch (DllNotFoundException)
            {
                return 0;
            }
            catch (EntryPointNotFoundException)
            {
                return 0;
            }
        }

        private static bool TryGetMonitorRect(IntPtr hWnd, out RECT rect)
        {
            rect = new RECT();
            IntPtr monitor = MonitorFromWindow(hWnd, MONITOR_DEFAULTTONEAREST);
            if (monitor == IntPtr.Zero)
            {
                return false;
            }

            var info = new MONITORINFO { cbSize = (uint)Marshal.SizeOf(typeof(MONITORINFO)) };
            if (!GetMonitorInfo(monitor, ref info))
            {
                return false;
            }

            rect = info.rcMonitor;
            return true;
        }

        private static bool TryGetMonitorWorkArea(IntPtr hWnd, out RECT rect)
        {
            rect = new RECT();
            IntPtr monitor = MonitorFromWindow(hWnd, MONITOR_DEFAULTTONEAREST);
            if (monitor == IntPtr.Zero)
            {
                return false;
            }

            var info = new MONITORINFO { cbSize = (uint)Marshal.SizeOf(typeof(MONITORINFO)) };
            if (!GetMonitorInfo(monitor, ref info))
            {
                return false;
            }

            rect = info.rcWork;
            return true;
        }

        private static bool IsScreenRectOnMonitors(int left, int top, int width, int height)
        {
            int right = left + width - 1;
            int bottom = top + height - 1;
            return IsPointOnMonitor(left, top)
                && IsPointOnMonitor(right, top)
                && IsPointOnMonitor(left, bottom)
                && IsPointOnMonitor(right, bottom);
        }

        private static bool IsPointOnMonitor(int x, int y)
        {
            return MonitorFromPoint(new POINT { X = x, Y = y }, MONITOR_DEFAULTTONULL) != IntPtr.Zero;
        }

        // GetWindowRect includes the invisible DWM resize borders on Windows 10+; the extended
        // frame bounds are what the user actually sees.
        private static bool TryGetVisibleFrame(IntPtr hWnd, out RECT rect)
        {
            rect = new RECT();
            try
            {
                return DwmGetWindowAttribute(hWnd, DWMWA_EXTENDED_FRAME_BOUNDS, out rect, Marshal.SizeOf(typeof(RECT))) == 0
                    && rect.Right > rect.Left
                    && rect.Bottom > rect.Top;
            }
            catch (DllNotFoundException)
            {
                return false;
            }
            catch (EntryPointNotFoundException)
            {
                return false;
            }
        }



        // Types text while verifying around every character that the target window still owns
        // the foreground, so a stolen focus stops typing immediately. Input is injected
        // asynchronously, so a focus change in the instant between the check and delivery can
        // still redirect one character; the post-send check reports that case explicitly.
        public static int SendText(IntPtr hWnd, string text, int keyDelayMilliseconds)
        {
            IntPtr layout = GetKeyboardLayoutForWindow(hWnd);
            int sent = 0;
            int total = (text ?? string.Empty).Length;
            foreach (char c in text ?? string.Empty)
            {
                if (hWnd != IntPtr.Zero && GetForegroundWindow() != hWnd)
                {
                    throw new InvalidOperationException("The EverQuest window lost the foreground while typing (" + sent + " of " + total + " characters sent; foreground is now " + DescribeWindow(GetForegroundWindow()) + ").");
                }

                SendCharacter(c, layout);
                sent += 1;
                if (hWnd != IntPtr.Zero && GetForegroundWindow() != hWnd)
                {
                    throw new InvalidOperationException("The EverQuest window lost the foreground while typing (" + sent + " of " + total + " characters sent; the last one may have reached " + DescribeWindow(GetForegroundWindow()) + ").");
                }
                if (keyDelayMilliseconds > 0)
                {
                    Thread.Sleep(keyDelayMilliseconds);
                }
            }

            return sent;
        }

        public static void ClearText(IntPtr hWnd, int characterCount, int keyDelayMilliseconds)
        {
            IntPtr layout = GetKeyboardLayoutForWindow(hWnd);
            int normalizedCount = characterCount < 0 ? 0 : characterCount;
            for (int index = 0; index < normalizedCount; index += 1)
            {
                if (hWnd != IntPtr.Zero && GetForegroundWindow() != hWnd)
                {
                    throw new InvalidOperationException("The EverQuest window lost the foreground while clearing a field.");
                }

                SendVirtualKeyAsScanCode(VK_BACK, layout);
                if (keyDelayMilliseconds > 0)
                {
                    Thread.Sleep(keyDelayMilliseconds);
                }
            }
        }

        public static void SendEnter(IntPtr hWnd, int keyDelayMilliseconds)
        {
            if (hWnd != IntPtr.Zero && GetForegroundWindow() != hWnd)
            {
                throw new InvalidOperationException("The EverQuest window lost the foreground before Enter could be pressed (foreground is now " + DescribeWindow(GetForegroundWindow()) + ").");
            }
            SendVirtualKeyAsScanCode(VK_RETURN, GetKeyboardLayoutForWindow(hWnd));
            if (keyDelayMilliseconds > 0)
            {
                Thread.Sleep(keyDelayMilliseconds);
            }
        }

        private static IntPtr GetKeyboardLayoutForWindow(IntPtr hWnd)
        {
            if (hWnd != IntPtr.Zero)
            {
                uint processId;
                uint threadId = GetWindowThreadProcessId(hWnd, out processId);
                if (threadId != 0)
                {
                    IntPtr layout = GetKeyboardLayout(threadId);
                    if (layout != IntPtr.Zero)
                    {
                        return layout;
                    }
                }
            }

            return GetKeyboardLayout(0);
        }

        private static string GetTitle(IntPtr hWnd)
        {
            int length = GetWindowTextLength(hWnd);
            if (length <= 0)
            {
                return string.Empty;
            }

            var builder = new StringBuilder(length + 1);
            GetWindowText(hWnd, builder, builder.Capacity);
            return builder.ToString();
        }

        private static string GetClass(IntPtr hWnd)
        {
            var builder = new StringBuilder(256);
            int length = GetClassName(hWnd, builder, builder.Capacity);
            return length > 0 ? builder.ToString(0, length) : string.Empty;
        }

        private static IntPtr EnterDpiAwareThreadContext()
        {
            try
            {
                return SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
            }
            catch (EntryPointNotFoundException)
            {
                return IntPtr.Zero;
            }
            catch (DllNotFoundException)
            {
                return IntPtr.Zero;
            }
        }

        private static void RestoreDpiThreadContext(IntPtr previousContext)
        {
            if (previousContext == IntPtr.Zero)
            {
                return;
            }

            try
            {
                SetThreadDpiAwarenessContext(previousContext);
            }
            catch (EntryPointNotFoundException)
            {
            }
            catch (DllNotFoundException)
            {
            }
        }

        private static void SendMouseButton(uint flags)
        {
            var inputs = new INPUT[]
            {
                new INPUT
                {
                    type = INPUT_MOUSE,
                    U = new InputUnion
                    {
                        mi = new MOUSEINPUT
                        {
                            dwFlags = flags
                        }
                    }
                }
            };

            SendInputOrThrow(inputs);
        }

        private static void TapVirtualKey(ushort virtualKey)
        {
            try
            {
                IntPtr layout = GetKeyboardLayout(0);
                SendVirtualKeyAsScanCodeDown(virtualKey, layout);
                SendVirtualKeyAsScanCodeUp(virtualKey, layout);
            }
            catch (Exception)
            {
                // Best effort only; the caller retries focus regardless.
            }
        }

        private static void SendCharacter(char value, IntPtr layout)
        {
            short keyScan = VkKeyScanEx(value, layout);
            if (keyScan == -1)
            {
                SendUnicodeCharacter(value);
                return;
            }

            ushort virtualKey = (ushort)(keyScan & 0xff);
            byte shiftState = (byte)((keyScan >> 8) & 0xff);

            if ((shiftState & 1) != 0)
            {
                SendVirtualKeyAsScanCodeDown(VK_SHIFT, layout);
            }
            if ((shiftState & 2) != 0)
            {
                SendVirtualKeyAsScanCodeDown(VK_CONTROL, layout);
            }
            if ((shiftState & 4) != 0)
            {
                SendVirtualKeyAsScanCodeDown(VK_MENU, layout);
            }

            try
            {
                SendVirtualKeyAsScanCode(virtualKey, layout);
            }
            finally
            {
                if ((shiftState & 4) != 0)
                {
                    SendVirtualKeyAsScanCodeUp(VK_MENU, layout);
                }
                if ((shiftState & 2) != 0)
                {
                    SendVirtualKeyAsScanCodeUp(VK_CONTROL, layout);
                }
                if ((shiftState & 1) != 0)
                {
                    SendVirtualKeyAsScanCodeUp(VK_SHIFT, layout);
                }
            }
        }

        private static void SendUnicodeCharacter(char value)
        {
            var inputs = new INPUT[]
            {
                new INPUT
                {
                    type = INPUT_KEYBOARD,
                    U = new InputUnion
                    {
                        ki = new KEYBDINPUT
                        {
                            wVk = 0,
                            wScan = value,
                            dwFlags = KEYEVENTF_UNICODE
                        }
                    }
                },
                new INPUT
                {
                    type = INPUT_KEYBOARD,
                    U = new InputUnion
                    {
                        ki = new KEYBDINPUT
                        {
                            wVk = 0,
                            wScan = value,
                            dwFlags = KEYEVENTF_UNICODE | KEYEVENTF_KEYUP
                        }
                    }
                }
            };

            SendInputOrThrow(inputs);
        }

        private static void SendVirtualKeyAsScanCode(ushort virtualKey, IntPtr layout)
        {
            SendVirtualKeyAsScanCodeDown(virtualKey, layout);
            SendVirtualKeyAsScanCodeUp(virtualKey, layout);
        }

        private static void SendVirtualKeyAsScanCodeDown(ushort virtualKey, IntPtr layout)
        {
            SendScanCode(VirtualKeyToScanCode(virtualKey, layout), false);
        }

        private static void SendVirtualKeyAsScanCodeUp(ushort virtualKey, IntPtr layout)
        {
            SendScanCode(VirtualKeyToScanCode(virtualKey, layout), true);
        }

        private static ushort VirtualKeyToScanCode(ushort virtualKey, IntPtr layout)
        {
            uint scanCode = MapVirtualKeyEx(virtualKey, MAPVK_VK_TO_VSC, layout);
            if (scanCode == 0)
            {
                throw new InvalidOperationException("Unable to map virtual key 0x" + virtualKey.ToString("X2") + " to a scan code.");
            }

            return (ushort)scanCode;
        }

        private static void SendScanCode(ushort scanCode, bool keyUp)
        {
            var inputs = new INPUT[]
            {
                new INPUT
                {
                    type = INPUT_KEYBOARD,
                    U = new InputUnion
                    {
                        ki = new KEYBDINPUT
                        {
                            wScan = scanCode,
                            dwFlags = KEYEVENTF_SCANCODE | (keyUp ? KEYEVENTF_KEYUP : 0)
                        }
                    }
                }
            };

            SendInputOrThrow(inputs);
        }

        private static void SendInputOrThrow(INPUT[] inputs)
        {
            uint sent = SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(INPUT)));
            if (sent != inputs.Length)
            {
                throw new Win32Exception(Marshal.GetLastWin32Error(), "SendInput did not send the full input sequence.");
            }
        }
    }
}
"@
}

$EqWindowClassName = "_EverQuestwndclass"
$MinimumRenderClientWidth = 320
$MinimumRenderClientHeight = 240

function Select-EqRenderWindow {
  param(
    [Parameter(Mandatory = $true)]
    [AllowEmptyCollection()]
    [object[]]$Windows
  )

  $candidates = @($Windows | Where-Object { $null -ne $_ })
  if ($candidates.Count -eq 0) {
    return $null
  }

  $byClass = @($candidates | Where-Object { $_.ClassName -eq $EqWindowClassName })
  if ($byClass.Count -gt 0) {
    return ($byClass | Sort-Object -Property @{ Expression = { [long]$_.ClientWidth * [long]$_.ClientHeight }; Descending = $true } | Select-Object -First 1)
  }

  $bySize = @($candidates | Where-Object { $_.ClientWidth -ge $MinimumRenderClientWidth -and $_.ClientHeight -ge $MinimumRenderClientHeight })
  if ($bySize.Count -gt 0) {
    return ($bySize | Sort-Object -Property @{ Expression = { [long]$_.ClientWidth * [long]$_.ClientHeight }; Descending = $true } | Select-Object -First 1)
  }

  return $null
}

function Convert-ColorRef {
  param(
    [Parameter(Mandatory = $true)]
    [int]$Color
  )

  $unsigned = [uint32]($Color -band 0xFFFFFFFF)
  [pscustomobject]@{
    R = [int]($unsigned -band 0xFF)
    G = [int](($unsigned -shr 8) -band 0xFF)
    B = [int](($unsigned -shr 16) -band 0xFF)
  }
}

function Format-Pixel {
  param(
    $Pixel
  )

  if ($null -eq $Pixel) {
    return "?"
  }
  return "$($Pixel.R),$($Pixel.G),$($Pixel.B)"
}

function Test-BrightPixel {
  param(
    [Parameter(Mandatory = $true)]
    $Pixel
  )

  return $Pixel.R -ge 180 -and $Pixel.G -ge 180 -and $Pixel.B -ge 160
}

function Test-MutedGrayPixel {
  param(
    [Parameter(Mandatory = $true)]
    $Pixel
  )

  $max = [Math]::Max($Pixel.R, [Math]::Max($Pixel.G, $Pixel.B))
  $min = [Math]::Min($Pixel.R, [Math]::Min($Pixel.G, $Pixel.B))
  return $max -ge 45 -and $max -le 130 -and ($max - $min) -le 35
}

function Test-BlueButtonPixel {
  param(
    [Parameter(Mandatory = $true)]
    $Pixel
  )

  return $Pixel.B -ge 85 -and $Pixel.R -le 90 -and $Pixel.G -le 110
}

function Test-DarkPixel {
  param(
    [Parameter(Mandatory = $true)]
    $Pixel
  )

  $max = [Math]::Max($Pixel.R, [Math]::Max($Pixel.G, $Pixel.B))
  return $max -le 45
}

function Test-ButtonPixel {
  param(
    [Parameter(Mandatory = $true)]
    $Pixel
  )

  # EQ login buttons are a flat, nearly neutral grey (66,69,66), and turn blue while the
  # pointer hovers them. The tinted frame between buttons (22,41,55) must not count.
  $max = [Math]::Max($Pixel.R, [Math]::Max($Pixel.G, $Pixel.B))
  $min = [Math]::Min($Pixel.R, [Math]::Min($Pixel.G, $Pixel.B))
  $neutralGray = $max -ge 50 -and $max -le 130 -and ($max - $min) -le 15
  return $neutralGray -or (Test-BlueButtonPixel -Pixel $Pixel)
}

function Test-NotButtonPixel {
  param(
    [Parameter(Mandatory = $true)]
    $Pixel
  )

  return -not (Test-ButtonPixel -Pixel $Pixel)
}

function Test-MainMenuLoginButtonPixel {
  param(
    [Parameter(Mandatory = $true)]
    $Pixel
  )

  return (Test-BlueButtonPixel -Pixel $Pixel) -or (Test-BrightPixel -Pixel $Pixel)
}

function Test-ServerSelectPlayButtonPixel {
  param(
    [Parameter(Mandatory = $true)]
    $Pixel
  )

  return (Test-MutedGrayPixel -Pixel $Pixel) -or (Test-BlueButtonPixel -Pixel $Pixel) -or (Test-BrightPixel -Pixel $Pixel)
}

function Test-PixelMajority {
  param(
    [Parameter(Mandatory = $true)]
    [AllowEmptyCollection()]
    [object[]]$Pixels,
    [Parameter(Mandatory = $true)]
    [scriptblock]$Predicate
  )

  $samples = @($Pixels | Where-Object { $null -ne $_ })
  if ($samples.Count -eq 0) {
    return $false
  }

  $matchCount = 0
  foreach ($pixel in $samples) {
    if (& $Predicate $pixel) {
      $matchCount += 1
    }
  }

  return $matchCount * 2 -gt $samples.Count
}

function New-ProbeSample {
  param(
    [Parameter(Mandatory = $true)]
    [AllowEmptyCollection()]
    [object[]]$Pixels
  )

  $samples = @($Pixels | Where-Object { $null -ne $_ })
  [pscustomobject]@{
    Pixels = $samples
    Center = if ($samples.Count -gt 0) { $samples[0] } else { $null }
  }
}

function Test-Probe {
  param(
    [Parameter(Mandatory = $true)]
    $Probe,
    [Parameter(Mandatory = $true)]
    [scriptblock]$Predicate
  )

  return Test-PixelMajority -Pixels $Probe.Pixels -Predicate $Predicate
}

# Each screen is recognised by a signature over several probes - including gaps that must NOT
# look like a button - so a logo or text on another screen cannot match it by coincidence.
$LoginScreenSignatures = [ordered]@{
  "login-error" = [ordered]@{
    loginErrorOkLeft = "Test-BlueButtonPixel"
    loginErrorOkRight = "Test-BlueButtonPixel"
    loginErrorText = "Test-DarkPixel"
    # OK is a short button; a wide hovered button (QUICK CONNECT sits here at 4K) is not OK.
    loginErrorLeftOfOk = "Test-NotButtonPixel"
    loginErrorRightOfOk = "Test-NotButtonPixel"
  }
  "main-menu" = [ordered]@{
    mainMenuLogin = "Test-MainMenuLoginButtonPixel"
    mainMenuLoginRight = "Test-MainMenuLoginButtonPixel"
    mainMenuOptions = "Test-ButtonPixel"
    mainMenuGap = "Test-NotButtonPixel"
    mainMenuExit = "Test-ButtonPixel"
    mainMenuBelowExit = "Test-NotButtonPixel"
  }
  "login-form" = [ordered]@{
    loginFormUsername = "Test-DarkPixel"
    loginFormPassword = "Test-DarkPixel"
    loginFormLoginButton = "Test-ButtonPixel"
    loginFormGap = "Test-NotButtonPixel"
    loginFormQuickConnect = "Test-ButtonPixel"
    loginFormCancel = "Test-ButtonPixel"
  }
}

$LoginCanvasProbeNames = @($LoginScreenSignatures.Values | ForEach-Object { $_.Keys }) | Select-Object -Unique

function Resolve-LoginCanvasState {
  param(
    [Parameter(Mandatory = $true)]
    $Probes
  )

  # First full match wins; the error dialog is checked first because it overlays the form.
  # Login-form field probes sit on the empty right-hand side of the fields: typed characters
  # start at the left edge, so they never reach them.
  foreach ($state in $LoginScreenSignatures.Keys) {
    $signature = $LoginScreenSignatures[$state]
    $matched = $true
    foreach ($probeName in $signature.Keys) {
      $predicate = (Get-Command -Name $signature[$probeName] -CommandType Function).ScriptBlock
      if (-not $Probes.Contains($probeName) -or -not (Test-Probe -Probe $Probes[$probeName] -Predicate $predicate)) {
        $matched = $false
        break
      }
    }
    if ($matched) {
      return $state
    }
  }

  return "advanced"
}

function Format-ProbeSummary {
  param(
    [Parameter(Mandatory = $true)]
    $Probes
  )

  $parts = @()
  foreach ($name in $Probes.Keys) {
    $parts += "$name=$(Format-Pixel -Pixel $Probes[$name].Center)"
  }
  return ($parts -join " ")
}

if ($MyInvocation.InvocationName -eq ".") {
  # Dot-sourced for unit tests: expose the functions/types without running the login flow.
  return
}

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
[EqAutoLogin.Native]::EnableDpiAwareness()

$Settings = Get-AutoLoginSettings -Base64 $SettingsBase64 -BoundParameters $PSBoundParameters
$LayoutMode = [string]$Settings.uiLayoutMode
$LoginWindowSizes = Get-LoginWindowSizes
$LayoutWidth = [int]$Settings.uiLayoutWidth
$LayoutHeight = [int]$Settings.uiLayoutHeight
$Session = @{
  Process = $null
  Handle = [IntPtr]::Zero
  Title = ""
  ClassName = ""
  LastProbes = $null
  LastState = ""
  LastProbeError = $null
  OcclusionWarnings = @{}
  CursorWarned = $false
}
$WindowReacquireGraceMs = 3000

function Get-Point {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Name
  )

  return $Settings.points[$Name]
}

# Native size of the login window a point belongs to (used by uiLayoutMode "auto").
function Get-PointWindowSize {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Name
  )

  $size = $LoginWindowSizes[$PointWindows[$Name]]
  return @([int]$size.Width, [int]$size.Height)
}

function Assert-ProcessRunning {
  param(
    [string]$Stage
  )

  $process = $Session.Process
  if ($null -eq $process) {
    return
  }

  $process.Refresh()
  if ($process.HasExited) {
    $exitCode = $process.ExitCode
    throw "eqgame.exe exited with code $exitCode during $Stage. Check for an EverQuest error dialog or an already-running client."
  }
}

function Resolve-TargetWindow {
  param(
    [string]$Stage = "input"
  )

  if ([EqAutoLogin.Native]::IsWindowAlive($Session.Handle)) {
    return $Session.Handle
  }

  # EQ recreates its window when it switches display modes; give it a moment to reappear.
  $deadline = (Get-Date).AddMilliseconds($WindowReacquireGraceMs)
  $candidate = $null
  do {
    Assert-ProcessRunning -Stage $Stage
    $windows = @([EqAutoLogin.Native]::GetProcessWindows($Session.Process.Id))
    $candidate = Select-EqRenderWindow -Windows $windows
    if ($null -ne $candidate) {
      break
    }
    Start-Sleep -Milliseconds 50
  } while ((Get-Date) -lt $deadline)

  if ($null -eq $candidate) {
    throw "The EverQuest window disappeared during $Stage and no replacement window appeared within $WindowReacquireGraceMs ms."
  }

  $Session.Handle = $candidate.Handle
  $Session.Title = $candidate.Title
  $Session.ClassName = $candidate.ClassName
  Write-AutoLoginEvent -Stage "window-reacquired" -Message "Re-acquired the EverQuest window '$($candidate.Title)' [$($candidate.ClassName)] during $Stage." -Tone "warning"
  return $Session.Handle
}

function Wait-ForProcessWindow {
  param(
    [Parameter(Mandatory = $true)]
    [int]$TimeoutSeconds
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  $seenWindows = @()
  do {
    Assert-ProcessRunning -Stage "window wait"
    $windows = @([EqAutoLogin.Native]::GetProcessWindows($Session.Process.Id))
    $candidate = Select-EqRenderWindow -Windows $windows
    if ($null -ne $candidate) {
      return $candidate
    }

    foreach ($window in $windows) {
      $descriptor = "'$($window.Title)' [$($window.ClassName)] $($window.ClientWidth)x$($window.ClientHeight)"
      if ($seenWindows -notcontains $descriptor) {
        $seenWindows += $descriptor
      }
    }

    Start-Sleep -Milliseconds 50
  } while ((Get-Date) -lt $deadline)

  $seenSummary = if ($seenWindows.Count -gt 0) { " Visible windows seen: $($seenWindows -join '; ')." } else { "" }
  throw "Timed out after $TimeoutSeconds seconds waiting for the EverQuest render window.$seenSummary"
}

function Wait-ForTargetWindowForeground {
  param(
    [Parameter(Mandatory = $true)]
    [int]$TimeoutSeconds,
    [string]$Stage = "focus"
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  $attempt = 0
  do {
    $handle = Resolve-TargetWindow -Stage $Stage
    if ([EqAutoLogin.Native]::IsForegroundWindow($handle)) {
      return $handle
    }

    [void][EqAutoLogin.Native]::FocusWindow($handle, $attempt)
    if ([EqAutoLogin.Native]::IsForegroundWindow($handle)) {
      return $handle
    }

    $attempt += 1
    Start-Sleep -Milliseconds 100
  } while ((Get-Date) -lt $deadline)

  $foreground = [EqAutoLogin.Native]::DescribeWindow([EqAutoLogin.Native]::GetForegroundWindowHandle())
  throw "Timed out after $TimeoutSeconds seconds waiting for the EverQuest window to become foreground during $Stage. Foreground window is $foreground."
}

function Invoke-WindowClick {
  param(
    [Parameter(Mandatory = $true)]
    [string]$PointName,
    [string]$Stage = "click",
    # Throw instead of silently skipping when the click could not be delivered to EverQuest.
    [switch]$Required
  )

  $point = Get-Point -Name $PointName
  $windowSize = Get-PointWindowSize -Name $PointName
  $handle = Resolve-TargetWindow -Stage $Stage
  $result = [EqAutoLogin.Native]::ClickWindowRelative($handle, $point[0], $point[1], $Settings.clickMoveDelayMs, $Settings.clickHoldDelayMs, $LayoutMode, $LayoutWidth, $LayoutHeight, $windowSize[0], $windowSize[1])
  if (-not $result.CursorVerified -and -not $Session.CursorWarned) {
    $Session.CursorWarned = $true
    Write-AutoLoginEvent -Stage "cursor" -Message "The pointer could not be positioned at $($result.X),$($result.Y) for $PointName (it is at $($result.CursorX),$($result.CursorY))." -Tone "warning"
  }
  if (-not $result.Clicked) {
    $covering = if ($result.WindowAtPoint -ne [IntPtr]::Zero) { "another window $([EqAutoLogin.Native]::DescribeWindow($result.WindowAtPoint))" } else { "no window" }
    $message = "Skipped the $PointName click at $($result.CursorX),$($result.CursorY) because it would land on $covering instead of EverQuest; something may be covering the client."
    if (-not $Session.OcclusionWarnings.ContainsKey($covering)) {
      $Session.OcclusionWarnings[$covering] = $true
      Write-AutoLoginEvent -Stage "occlusion" -Message $message -Tone "warning"
    }
    if ($Required) {
      throw [System.InvalidOperationException]::new($message)
    }
  }
  return $result
}

# Reads every probe in one screen capture. Returns one pixel array per ratio pair; samples
# that are not on any monitor are dropped, so an array can be empty.
function Read-ProbeSamples {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Stage,
    [Parameter(Mandatory = $true)]
    [double[]]$Ratios,
    [Parameter(Mandatory = $true)]
    [int[]]$WindowSizes
  )

  $handle = Resolve-TargetWindow -Stage $Stage
  $colors = [EqAutoLogin.Native]::GetWindowRelativePixels($handle, $Ratios, $WindowSizes, $Settings.probeRadiusPx, $LayoutMode, $LayoutWidth, $LayoutHeight)
  $perProbe = [EqAutoLogin.Native]::GetPixelSamplesPerProbe($Settings.probeRadiusPx)
  $probes = New-Object System.Collections.Generic.List[object]
  for ($start = 0; $start -lt $colors.Length; $start += $perProbe) {
    $pixels = @()
    for ($index = $start; $index -lt ($start + $perProbe); $index += 1) {
      if ($colors[$index] -ge 0) {
        $pixels += Convert-ColorRef -Color $colors[$index]
      }
    }
    $probes.Add($pixels)
  }
  return ,$probes
}

function Get-LoginCanvasProbes {
  $ratios = New-Object System.Collections.Generic.List[double]
  $windowSizes = New-Object System.Collections.Generic.List[int]
  foreach ($name in $LoginCanvasProbeNames) {
    $point = Get-Point -Name $name
    $ratios.Add([double]$point[0])
    $ratios.Add([double]$point[1])
    $windowSizes.AddRange([int[]](Get-PointWindowSize -Name $name))
  }

  $samples = Read-ProbeSamples -Stage "screen probe" -Ratios $ratios.ToArray() -WindowSizes $windowSizes.ToArray()
  if ([EqAutoLogin.Native]::LastCoveredSamples -gt 0) {
    # Something sits on top of the login screen; its pixels say nothing about EverQuest's state.
    return $null
  }
  $probes = [ordered]@{}
  for ($index = 0; $index -lt $LoginCanvasProbeNames.Count; $index += 1) {
    $name = $LoginCanvasProbeNames[$index]
    if (@($samples[$index]).Count -eq 0) {
      throw "The $name probe is not on any monitor; the EverQuest client may be off-screen or uiLayoutMode '$LayoutMode' does not match this client."
    }
    $probes[$name] = New-ProbeSample -Pixels @($samples[$index])
  }
  return $probes
}

function Get-LoginCanvasState {
  $probes = Get-LoginCanvasProbes
  if ($null -eq $probes) {
    $Session.LastState = "covered"
    $Session.LastProbeError = "the login screen is covered by $([EqAutoLogin.Native]::DescribeWindow([EqAutoLogin.Native]::LastCoveringWindow))"
    return "covered"
  }
  $Session.LastProbes = $probes
  $Session.LastProbeError = $null
  $state = Resolve-LoginCanvasState -Probes $probes
  $Session.LastState = $state
  return $state
}

# Polling loops tolerate transient probe failures; remember the latest one so a timeout
# reports the real cause instead of a stale reading.
function Save-ProbeError {
  param(
    [Parameter(Mandatory = $true)]
    $ErrorRecord
  )

  $Session.LastProbeError = (Get-InnerException -ErrorRecord $ErrorRecord).Message
}

function Get-LastProbeDescription {
  $parts = @()
  if ($null -ne $Session.LastProbes) {
    $parts += "last state '$($Session.LastState)' with probes $(Format-ProbeSummary -Probes $Session.LastProbes)"
  } else {
    $parts += "no screen probes were read"
  }
  if ($Session.LastProbeError) {
    $parts += "latest probe error: $($Session.LastProbeError)"
  }
  return ($parts -join "; ")
}

function Test-ServerSelectPlayButtonReady {
  $base = Get-Point -Name "serverSelectPlay"
  $windowSize = Get-PointWindowSize -Name "serverSelectPlay"
  $ratios = New-Object System.Collections.Generic.List[double]
  $windowSizes = New-Object System.Collections.Generic.List[int]
  foreach ($offset in @(@(0, 0), @(-0.040, 0), @(0.040, 0), @(0, -0.012), @(0, 0.012))) {
    $ratios.Add([double]$base[0] + $offset[0])
    $ratios.Add([double]$base[1] + $offset[1])
    $windowSizes.AddRange([int[]]$windowSize)
  }

  $samples = Read-ProbeSamples -Stage "server select" -Ratios $ratios.ToArray() -WindowSizes $windowSizes.ToArray()
  foreach ($pixels in $samples) {
    $probe = New-ProbeSample -Pixels @($pixels)
    if (Test-Probe -Probe $probe -Predicate ${function:Test-ServerSelectPlayButtonPixel}) {
      return $true
    }
  }

  return $false
}

function Write-WindowDiagnostics {
  $handle = Resolve-TargetWindow -Stage "diagnostics"
  $mainSize = Get-PointWindowSize -Name "mainMenuLogin"
  $geometry = [EqAutoLogin.Native]::GetWindowGeometry($handle, $LayoutMode, $LayoutWidth, $LayoutHeight, $mainSize[0], $mainSize[1])
  $stateFlags = @()
  if ($geometry.IsMaximized) { $stateFlags += "maximized" }
  if ($geometry.IsMinimized) { $stateFlags += "minimized" }
  $flags = if ($stateFlags.Count -gt 0) { " " + ($stateFlags -join ",") } else { "" }
  $dpiText = if ($geometry.Dpi -gt 0) { "window $($geometry.Dpi) dpi" } else { "window dpi n/a" }
  $monitorDpiText = if ($geometry.MonitorDpi -gt 0) { "monitor $($geometry.MonitorDpi) dpi" } else { "monitor dpi n/a" }
  $scaleText = if ([Math]::Abs($geometry.Scale - 1.0) -gt 0.001) { " (EverQuest sees $($geometry.LogicalClientWidth)x$($geometry.LogicalClientHeight); Windows stretches it x$([Math]::Round($geometry.Scale, 3)))" } else { "" }
  $windowText = ($LoginWindowSizes.Keys | ForEach-Object { "$_ $($LoginWindowSizes[$_].Width)x$($LoginWindowSizes[$_].Height)" }) -join ", "
  $message = "Window '$($geometry.Title)' [$($geometry.ClassName)] at $($geometry.Left),$($geometry.Top) $($geometry.Width)x$($geometry.Height)$flags; client $($geometry.ClientWidth)x$($geometry.ClientHeight) at $($geometry.ClientLeft),$($geometry.ClientTop)$scaleText; $dpiText, $monitorDpiText; monitor $($geometry.MonitorLeft),$($geometry.MonitorTop) $($geometry.MonitorWidth)x$($geometry.MonitorHeight); layout $($geometry.LayoutMode), login canvas at $($geometry.LayoutLeft),$($geometry.LayoutTop); login windows: $windowText."
  Write-AutoLoginEvent -Stage "diagnostics" -Message $message
  return $geometry
}

function Wait-ForPreLoginScreen {
  param(
    [Parameter(Mandatory = $true)]
    [int]$TimeoutSeconds
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  $clickNames = @("eulaAccept", "splashContinue")
  $clickIndex = 0
  $lastClick = [DateTime]::MinValue
  do {
    Wait-ForTargetWindowForeground -TimeoutSeconds $Settings.focusWaitSeconds -Stage "EULA/splash" | Out-Null
    $state = "advanced"
    try {
      $state = Get-LoginCanvasState
    } catch {
      # The client may still be creating its render surface; keep clicking through.
      Save-ProbeError -ErrorRecord $_
    }

    if ($state -eq "main-menu" -or $state -eq "login-form") {
      return $state
    }

    if (((Get-Date) - $lastClick).TotalMilliseconds -ge $Settings.preLoginClickIntervalMs) {
      Invoke-WindowClick -PointName $clickNames[$clickIndex % $clickNames.Count] -Stage "EULA/splash" | Out-Null
      $clickIndex += 1
      $lastClick = Get-Date
    }

    Start-Sleep -Milliseconds 50
  } while ((Get-Date) -lt $deadline)

  throw "Timed out after $TimeoutSeconds seconds clicking through the EULA/splash screens; $(Get-LastProbeDescription)."
}

function Wait-ForLoginFormReady {
  param(
    [Parameter(Mandatory = $true)]
    [int]$TimeoutSeconds
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  $lastMenuClick = [DateTime]::MinValue
  do {
    Wait-ForTargetWindowForeground -TimeoutSeconds $Settings.focusWaitSeconds -Stage "login form" | Out-Null
    $state = "advanced"
    try {
      $state = Get-LoginCanvasState
    } catch {
      # Transient surface swap; retry on the next poll.
      Save-ProbeError -ErrorRecord $_
    }
    if ($state -eq "login-form") {
      return
    }

    if ($state -eq "main-menu" -and ((Get-Date) - $lastMenuClick).TotalMilliseconds -ge 500) {
      Invoke-WindowClick -PointName "mainMenuLogin" -Stage "main menu" | Out-Null
      $lastMenuClick = Get-Date
    }

    Start-Sleep -Milliseconds 100
  } while ((Get-Date) -lt $deadline)

  throw "Timed out after $TimeoutSeconds seconds waiting for the EverQuest login form; $(Get-LastProbeDescription)."
}

function Enter-CredentialField {
  param(
    [Parameter(Mandatory = $true)]
    [string]$PointName,
    [Parameter(Mandatory = $true)]
    [string]$Text,
    [Parameter(Mandatory = $true)]
    [string]$Stage
  )

  $lastError = $null
  for ($attempt = 1; $attempt -le $Settings.credentialAttempts; $attempt += 1) {
    try {
      Wait-ForTargetWindowForeground -TimeoutSeconds $Settings.focusWaitSeconds -Stage $Stage | Out-Null
      Invoke-WindowClick -PointName $PointName -Stage $Stage -Required | Out-Null
      if ($Settings.credentialFocusDelayMs -gt 0) {
        Start-Sleep -Milliseconds $Settings.credentialFocusDelayMs
      }
      $handle = Wait-ForTargetWindowForeground -TimeoutSeconds $Settings.focusWaitSeconds -Stage $Stage
      [EqAutoLogin.Native]::ClearText($handle, $Settings.credentialClearBackspaceCount, $Settings.keyDelayMs)
      [void][EqAutoLogin.Native]::SendText($handle, $Text, $Settings.keyDelayMs)
      return
    } catch {
      $inner = Get-InnerException -ErrorRecord $_
      if (-not ($inner -is [System.InvalidOperationException])) {
        throw
      }

      # Foreground lost or window handle changed mid-typing: re-focus, re-click the field and retype.
      $lastError = $inner.Message
      if ($attempt -lt $Settings.credentialAttempts) {
        Write-AutoLoginEvent -Stage "credentials-retry" -Message "Retrying $Stage (attempt $($attempt + 1) of $($Settings.credentialAttempts)): $lastError" -Tone "warning"
        Start-Sleep -Milliseconds 250
      }
    }
  }

  throw "Unable to complete $Stage after $($Settings.credentialAttempts) attempts: $lastError"
}

function Wait-ForLoginOutcome {
  param(
    [Parameter(Mandatory = $true)]
    [int]$TimeoutSeconds,
    [switch]$DetectServerSelect
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  $eligibleAt = (Get-Date).AddMilliseconds($Settings.loginOutcomeMinimumAgeMs)
  $advancedSince = $null
  do {
    Wait-ForTargetWindowForeground -TimeoutSeconds $Settings.focusWaitSeconds -Stage "login result" | Out-Null
    try {
      $state = Get-LoginCanvasState
    } catch {
      Save-ProbeError -ErrorRecord $_
      $state = "advanced"
    }

    if ($state -eq "login-error" -or $state -eq "main-menu") {
      return $state
    }

    $now = Get-Date
    # Give the login dialogs time to clear first: the Play-button colour test is permissive
    # enough to match a grey "logging in" frame.
    if ($DetectServerSelect -and $state -eq "advanced" -and $now -ge $eligibleAt) {
      try {
        if (Test-ServerSelectPlayButtonReady) {
          return "server-select"
        }
      } catch {
        # The client may briefly resize or swap surfaces while loading server select.
        Save-ProbeError -ErrorRecord $_
      }
    }

    # "covered" (another window over the client) resets the stability window: it is never success.
    if ($state -eq "advanced" -and $now -ge $eligibleAt) {
      if ($null -eq $advancedSince) {
        $advancedSince = $now
      } elseif (($now - $advancedSince).TotalMilliseconds -ge $Settings.loginOutcomeStableMs) {
        return $state
      }
    } else {
      $advancedSince = $null
    }

    Start-Sleep -Milliseconds 100
  } while ((Get-Date) -lt $deadline)

  try {
    return Get-LoginCanvasState
  } catch {
    return "advanced"
  }
}

function Wait-ForServerSelectReady {
  param(
    [Parameter(Mandatory = $true)]
    [int]$TimeoutSeconds
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    Wait-ForTargetWindowForeground -TimeoutSeconds $Settings.focusWaitSeconds -Stage "server select" | Out-Null
    try {
      if (Test-ServerSelectPlayButtonReady) {
        return
      }
    } catch {
      # The client may briefly resize or swap surfaces while loading server select.
      Save-ProbeError -ErrorRecord $_
    }

    Start-Sleep -Milliseconds 100
  } while ((Get-Date) -lt $deadline)

  $probeError = if ($Session.LastProbeError) { " Latest probe error: $($Session.LastProbeError)" } else { "" }
  throw "Timed out after $TimeoutSeconds seconds waiting for the EverQuest server select screen.$probeError"
}

$password = ""
$currentStage = "startup"
try {
  # Manual runs usually pipe the password in with a trailing newline; never type that as Enter.
  $password = ([string][Console]::In.ReadToEnd()).TrimEnd([char]13, [char]10)
  if (-not $EqGamePath) {
    throw "No eqgame.exe path was provided to the auto-login helper."
  }
  if (-not $Username) {
    throw "No username was provided to the auto-login helper."
  }
  if (-not $password) {
    throw "No password was provided to the auto-login helper."
  }

  $resolvedPath = (Resolve-Path -LiteralPath $EqGamePath).Path
  $workingDirectory = Split-Path -Parent $resolvedPath
  $LoginWindowSizes = Get-LoginWindowSizes -GameDirectory $workingDirectory
  Write-AutoLoginEvent -Stage "settings" -Message "Auto-login timing: window $($Settings.windowWaitSeconds)s, pre-login $($Settings.preLoginWaitSeconds)s, form $($Settings.loginFormWaitSeconds)s, outcome $($Settings.loginOutcomeWaitSeconds)s, server select $($Settings.serverSelectWaitSeconds)s, focus $($Settings.focusWaitSeconds)s; layout $LayoutMode $($LayoutWidth)x$($LayoutHeight); key delay $($Settings.keyDelayMs)ms."

  $currentStage = "launch"
  Write-AutoLoginEvent -Stage "launch" -Message "Starting eqgame.exe patchme." -StatusState "running" -StatusLabel "Launching" -StatusDetail "Starting EverQuest." -ProgressValue 15 -ProgressLabel "Starting EverQuest"
  $Session.Process = Start-Process -FilePath $resolvedPath -ArgumentList "patchme" -WorkingDirectory $workingDirectory -PassThru
  Write-AutoLoginEvent -Stage "process-started" -Message "" -ProcessId $Session.Process.Id

  $currentStage = "window-wait"
  Write-AutoLoginEvent -Stage "window-wait" -Message "Waiting for the EverQuest window." -StatusState "running" -StatusLabel "Waiting" -StatusDetail "Waiting for the EverQuest window." -ProgressValue 25 -ProgressLabel "Waiting for EverQuest window"
  $window = Wait-ForProcessWindow -TimeoutSeconds $Settings.windowWaitSeconds
  $Session.Handle = $window.Handle
  $Session.Title = $window.Title
  $Session.ClassName = $window.ClassName

  $currentStage = "focus"
  Write-AutoLoginEvent -Stage "focus" -Message "Waiting for the new EverQuest window to become foreground." -StatusState "running" -StatusLabel "Focusing" -StatusDetail "Waiting for the newly launched EverQuest client before sending input." -ProgressValue 30 -ProgressLabel "Focusing EverQuest"
  Wait-ForTargetWindowForeground -TimeoutSeconds $Settings.focusWaitSeconds -Stage "initial launch" | Out-Null
  if ([EqAutoLogin.Native]::EnsureWindowOnScreen($Session.Handle)) {
    Write-AutoLoginEvent -Stage "window-moved" -Message "The EverQuest window was partially off-screen and was moved onto its monitor." -Tone "warning"
  }
  Write-WindowDiagnostics | Out-Null

  $currentStage = "eula"
  Write-AutoLoginEvent -Stage "eula" -Message "Clicking through the EULA and splash screens until the login menu appears." -StatusState "running" -StatusLabel "Accepting" -StatusDetail "Advancing through the EULA and splash screens." -ProgressValue 40 -ProgressLabel "Accepting EULA"
  $preLoginState = Wait-ForPreLoginScreen -TimeoutSeconds $Settings.preLoginWaitSeconds
  Write-AutoLoginEvent -Stage "splash" -Message "Reached the $preLoginState screen." -StatusState "running" -StatusLabel "Advancing" -StatusDetail "Reached the EverQuest login menu." -ProgressValue 58 -ProgressLabel "Advancing login splash"

  $currentStage = "login-form"
  Write-AutoLoginEvent -Stage "login-form" -Message "Waiting for the login form." -StatusState "running" -StatusLabel "Waiting" -StatusDetail "Waiting for the EverQuest login form before typing." -ProgressValue 66 -ProgressLabel "Waiting for login form"
  Wait-ForLoginFormReady -TimeoutSeconds $Settings.loginFormWaitSeconds

  $currentStage = "credentials"
  Write-AutoLoginEvent -Stage "credentials" -Message "Sending the username, password, and pressing Enter." -StatusState "running" -StatusLabel "Signing in" -StatusDetail "Sending account credentials." -ProgressValue 72 -ProgressLabel "Sending credentials"
  Enter-CredentialField -PointName "usernameField" -Text $Username -Stage "username entry"
  Enter-CredentialField -PointName "passwordField" -Text $password -Stage "password entry"
  if ($Settings.postPasswordDelayMs -gt 0) {
    Start-Sleep -Milliseconds $Settings.postPasswordDelayMs
  }
  $submitHandle = Wait-ForTargetWindowForeground -TimeoutSeconds $Settings.focusWaitSeconds -Stage "login submit"
  [EqAutoLogin.Native]::SendEnter($submitHandle, $Settings.keyDelayMs)

  $currentStage = "confirm"
  Write-AutoLoginEvent -Stage "confirm" -Message "Checking the EverQuest login screen state." -StatusState "running" -StatusLabel "Confirming" -StatusDetail "Checking whether the client advanced past the login form." -ProgressValue 86 -ProgressLabel "Confirming login result"
  $loginOutcome = Wait-ForLoginOutcome -TimeoutSeconds $Settings.loginOutcomeWaitSeconds -DetectServerSelect:$EnterWorld
  if ($loginOutcome -eq "advanced" -or $loginOutcome -eq "server-select") {
    if ($EnterWorld) {
      $currentStage = "server-select"
      $serverSelectMessage = if ($loginOutcome -eq "server-select") { "Play EverQuest is ready." } else { "Waiting for the server select Play EverQuest button." }
      Write-AutoLoginEvent -Stage "server-select" -Message $serverSelectMessage -StatusState "running" -StatusLabel "Server select" -StatusDetail "Waiting for Play EverQuest before entering the selected server." -ProgressValue 94 -ProgressLabel "Waiting for Play EverQuest"
      try {
        if ($loginOutcome -ne "server-select") {
          Wait-ForServerSelectReady -TimeoutSeconds $Settings.serverSelectWaitSeconds
        }
        Wait-ForTargetWindowForeground -TimeoutSeconds $Settings.focusWaitSeconds -Stage "Play EverQuest" | Out-Null
        Write-AutoLoginEvent -Stage "enter-world" -Message "Clicking Play EverQuest." -StatusState "running" -StatusLabel "Entering" -StatusDetail "Clicking Play EverQuest on the server select screen." -ProgressValue 98 -ProgressLabel "Clicking Play EverQuest"
        Invoke-WindowClick -PointName "serverSelectPlay" -Stage "Play EverQuest" -Required | Out-Null
        Write-AutoLoginEvent -Stage "enter-world-complete" -Message "Play EverQuest was pressed." -Tone "success" -StatusState "success" -StatusLabel "Entering world" -StatusDetail "Play EverQuest was pressed on the server select screen." -ProgressValue 100 -ProgressLabel "Entering world"
        exit 0
      } catch {
        Write-AutoLoginEvent -Stage "enter-world-timeout" -Message (Get-InnerException -ErrorRecord $_).Message -Tone "warning" -StatusState "warning" -StatusLabel "Server select" -StatusDetail "The login succeeded, but Play EverQuest could not be pressed automatically." -ProgressValue 100 -ProgressLabel "Server select ready"
      }
    }

    Write-AutoLoginEvent -Stage "complete" -Message "EverQuest advanced past the login form." -Tone "success" -StatusState "success" -StatusLabel "Login advanced" -StatusDetail "EverQuest advanced past the login form." -ProgressValue 100 -ProgressLabel "Auto login complete"
    exit 0
  }

  if ($loginOutcome -eq "login-error" -or $loginOutcome -eq "main-menu") {
    Write-AutoLoginEvent -Stage "login-error" -Message "The game client did not accept the login ($loginOutcome screen detected)." -Tone "warning" -StatusState "warning" -StatusLabel "Login rejected" -StatusDetail "The game client did not accept the login. Check the saved username and password." -ProgressValue 92 -ProgressLabel "Login rejected"
    exit 3
  }

  if ($loginOutcome -eq "covered") {
    Write-AutoLoginEvent -Stage "confirm-timeout" -Message "The login result could not be confirmed because $($Session.LastProbeError)." -Tone "warning" -StatusState "warning" -StatusLabel "Login not confirmed" -StatusDetail "Another window is covering EverQuest, so the login result could not be read." -ProgressValue 92 -ProgressLabel "Login not confirmed"
    exit 2
  }
  Write-AutoLoginEvent -Stage "confirm-timeout" -Message "The client did not advance past the login form; $(Get-LastProbeDescription)." -Tone "warning" -StatusState "warning" -StatusLabel "Login not confirmed" -StatusDetail "The login sequence was sent, but the client still appears to be on the login form." -ProgressValue 92 -ProgressLabel "Login not confirmed"
  exit 2
} catch {
  $message = "[$currentStage] $((Get-InnerException -ErrorRecord $_).Message)"
  Write-AutoLoginEvent -Stage "error" -Message $message -Tone "error" -StatusState "error" -StatusLabel "Launch failed" -StatusDetail $message
  [Console]::Error.WriteLine($message)
  exit 1
} finally {
  $password = $null
}
