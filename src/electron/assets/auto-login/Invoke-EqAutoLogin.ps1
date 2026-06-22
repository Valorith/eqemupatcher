[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$EqGamePath,
  [Parameter(Mandatory = $true)]
  [string]$Username,
  [ValidateRange(1, 300)]
  [int]$WindowWaitSeconds = 45,
  [ValidateRange(1, 60)]
  [int]$UdpWaitSeconds = 10,
  [ValidateRange(1, 60)]
  [int]$LoginFormWaitSeconds = 30,
  [ValidateRange(1, 30)]
  [int]$FocusWaitSeconds = 10,
  [ValidateRange(1, 30)]
  [int]$EulaClickAttempts = 10,
  [ValidateRange(0, 5000)]
  [int]$EulaRetryDelayMilliseconds = 100,
  [ValidateRange(0, 1000)]
  [int]$ClickMoveDelayMilliseconds = 20,
  [ValidateRange(0, 1000)]
  [int]$ClickHoldDelayMilliseconds = 20,
  [ValidateRange(0, 1000)]
  [int]$CredentialFocusDelayMilliseconds = 120,
  [ValidateRange(0, 1000)]
  [int]$KeyDelayMilliseconds = 8,
  [ValidateRange(0, 1000)]
  [int]$PostPasswordDelayMilliseconds = 150,
  [switch]$EnterWorld,
  [ValidateRange(1, 60)]
  [int]$ServerSelectWaitSeconds = 15
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::InputEncoding = [System.Text.Encoding]::UTF8

$stopwatch = [Diagnostics.Stopwatch]::StartNew()
$LoginOutcomeMinimumAgeMilliseconds = 2500
$LoginOutcomeStableMilliseconds = 1200
$LoginUsernameXRatio = 0.560
$LoginUsernameYRatio = 0.390
$LoginPasswordXRatio = 0.560
$LoginPasswordYRatio = 0.474
$CredentialClearBackspaceCount = 64
$ServerSelectPlayButtonXRatio = 0.724
$ServerSelectPlayButtonYRatio = 0.700

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
    [string]$ProgressLabel = ""
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
  $payload | ConvertTo-Json -Compress
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
    }

    public static class Native
    {
        private const int SW_RESTORE = 9;
        private static readonly IntPtr DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 = new IntPtr(-4);
        private const int LEGACY_EQ_UI_WIDTH = 1024;
        private const int LEGACY_EQ_UI_HEIGHT = 768;
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

        [DllImport("user32.dll", SetLastError = true)]
        private static extern int GetWindowTextLength(IntPtr hWnd);

        [DllImport("user32.dll", SetLastError = true)]
        private static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

        [DllImport("user32.dll", SetLastError = true)]
        private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

        [DllImport("user32.dll")]
        private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

        [DllImport("user32.dll")]
        private static extern bool IsIconic(IntPtr hWnd);

        [DllImport("user32.dll")]
        private static extern bool SetForegroundWindow(IntPtr hWnd);

        [DllImport("user32.dll")]
        private static extern IntPtr GetForegroundWindow();

        [DllImport("user32.dll")]
        private static extern bool SetProcessDPIAware();

        [DllImport("user32.dll", SetLastError = true)]
        private static extern bool SetProcessDpiAwarenessContext(IntPtr value);

        [DllImport("user32.dll", SetLastError = true)]
        private static extern IntPtr SetThreadDpiAwarenessContext(IntPtr value);

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
        private static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);

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

                windows.Add(new WindowInfo
                {
                    Handle = hWnd,
                    ProcessId = (int)windowProcessId,
                    Title = GetTitle(hWnd)
                });
                return true;
            }, IntPtr.Zero);

            return windows.ToArray();
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

        public static bool FocusWindow(IntPtr hWnd)
        {
            if (IsIconic(hWnd))
            {
                ShowWindow(hWnd, SW_RESTORE);
            }

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
            if (foregroundThread != 0)
            {
                AttachThreadInput(currentThread, foregroundThread, true);
            }

            try
            {
                return SetForegroundWindow(hWnd);
            }
            finally
            {
                if (foregroundThread != 0)
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
            return GetForegroundWindow() == hWnd;
        }

        public static void ClickWindowRelative(IntPtr hWnd, double xRatio, double yRatio, int moveDelayMilliseconds, int holdDelayMilliseconds)
        {
            IntPtr previousDpiContext = EnterDpiAwareThreadContext();
            try
            {
                POINT point = GetWindowRelativeScreenPoint(hWnd, xRatio, yRatio);

                SetCursorPos(point.X, point.Y);
                if (moveDelayMilliseconds > 0)
                {
                    Thread.Sleep(moveDelayMilliseconds);
                }
                mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, UIntPtr.Zero);
                if (holdDelayMilliseconds > 0)
                {
                    Thread.Sleep(holdDelayMilliseconds);
                }
                mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, UIntPtr.Zero);
            }
            finally
            {
                RestoreDpiThreadContext(previousDpiContext);
            }
        }

        public static int GetWindowRelativePixel(IntPtr hWnd, double xRatio, double yRatio)
        {
            IntPtr previousDpiContext = EnterDpiAwareThreadContext();
            IntPtr hdc = IntPtr.Zero;
            try
            {
                POINT point = GetWindowRelativeScreenPoint(hWnd, xRatio, yRatio);
                hdc = GetDC(IntPtr.Zero);
                if (hdc == IntPtr.Zero)
                {
                    throw new Win32Exception(Marshal.GetLastWin32Error(), "Unable to read the screen device context.");
                }

                uint color = GetPixel(hdc, point.X, point.Y);
                if (color == 0xFFFFFFFF)
                {
                    throw new Win32Exception(Marshal.GetLastWin32Error(), "Unable to read the target pixel.");
                }

                return unchecked((int)color);
            }
            finally
            {
                if (hdc != IntPtr.Zero)
                {
                    ReleaseDC(IntPtr.Zero, hdc);
                }
                RestoreDpiThreadContext(previousDpiContext);
            }
        }

        private static POINT GetWindowRelativeScreenPoint(IntPtr hWnd, double xRatio, double yRatio)
        {
            RECT clientRect;
            if (!GetClientRect(hWnd, out clientRect))
            {
                throw new Win32Exception(Marshal.GetLastWin32Error(), "Unable to read the target client rectangle.");
            }

            var clientOrigin = new POINT { X = clientRect.Left, Y = clientRect.Top };
            if (!ClientToScreen(hWnd, ref clientOrigin))
            {
                throw new Win32Exception(Marshal.GetLastWin32Error(), "Unable to translate the target client origin.");
            }

            int clientWidth = clientRect.Right - clientRect.Left;
            int clientHeight = clientRect.Bottom - clientRect.Top;
            if (clientWidth <= 0 || clientHeight <= 0)
            {
                throw new InvalidOperationException("The target client rectangle is empty.");
            }

            RECT targetRect = GetCenteredLegacyEqUiRect(clientWidth, clientHeight);
            return new POINT
            {
                X = clientOrigin.X + targetRect.Left + (int)Math.Round((targetRect.Right - targetRect.Left) * xRatio),
                Y = clientOrigin.Y + targetRect.Top + (int)Math.Round((targetRect.Bottom - targetRect.Top) * yRatio)
            };
        }

        private static RECT GetCenteredLegacyEqUiRect(int clientWidth, int clientHeight)
        {
            int targetWidth = Math.Min(clientWidth, LEGACY_EQ_UI_WIDTH);
            int targetHeight = Math.Min(clientHeight, LEGACY_EQ_UI_HEIGHT);

            if (targetWidth <= 0 || targetHeight <= 0)
            {
                return new RECT { Left = 0, Top = 0, Right = clientWidth, Bottom = clientHeight };
            }

            double targetAspect = (double)LEGACY_EQ_UI_WIDTH / LEGACY_EQ_UI_HEIGHT;
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
            return new RECT
            {
                Left = left,
                Top = top,
                Right = left + targetWidth,
                Bottom = top + targetHeight
            };
        }

        public static void SendText(string text, int keyDelayMilliseconds)
        {
            foreach (char c in text ?? string.Empty)
            {
                SendCharacter(c);
                if (keyDelayMilliseconds > 0)
                {
                    Thread.Sleep(keyDelayMilliseconds);
                }
            }
        }

        public static void ClearText(int characterCount, int keyDelayMilliseconds)
        {
            int normalizedCount = characterCount < 0 ? 0 : characterCount;
            for (int index = 0; index < normalizedCount; index += 1)
            {
                SendVirtualKeyAsScanCode(VK_BACK);
                if (keyDelayMilliseconds > 0)
                {
                    Thread.Sleep(keyDelayMilliseconds);
                }
            }
        }

        public static void SendEnter(int keyDelayMilliseconds)
        {
            SendVirtualKeyAsScanCode(VK_RETURN);
            if (keyDelayMilliseconds > 0)
            {
                Thread.Sleep(keyDelayMilliseconds);
            }
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

        private static void SendCharacter(char value)
        {
            IntPtr layout = GetKeyboardLayout(0);
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
                SendVirtualKeyAsScanCodeDown(VK_SHIFT);
            }
            if ((shiftState & 2) != 0)
            {
                SendVirtualKeyAsScanCodeDown(VK_CONTROL);
            }
            if ((shiftState & 4) != 0)
            {
                SendVirtualKeyAsScanCodeDown(VK_MENU);
            }

            try
            {
                SendVirtualKeyAsScanCode(virtualKey);
            }
            finally
            {
                if ((shiftState & 4) != 0)
                {
                    SendVirtualKeyAsScanCodeUp(VK_MENU);
                }
                if ((shiftState & 2) != 0)
                {
                    SendVirtualKeyAsScanCodeUp(VK_CONTROL);
                }
                if ((shiftState & 1) != 0)
                {
                    SendVirtualKeyAsScanCodeUp(VK_SHIFT);
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

        private static void SendVirtualKeyAsScanCode(ushort virtualKey)
        {
            SendVirtualKeyAsScanCodeDown(virtualKey);
            SendVirtualKeyAsScanCodeUp(virtualKey);
        }

        private static void SendVirtualKeyAsScanCodeDown(ushort virtualKey)
        {
            SendScanCode(VirtualKeyToScanCode(virtualKey), false);
        }

        private static void SendVirtualKeyAsScanCodeUp(ushort virtualKey)
        {
            SendScanCode(VirtualKeyToScanCode(virtualKey), true);
        }

        private static ushort VirtualKeyToScanCode(ushort virtualKey)
        {
            IntPtr layout = GetKeyboardLayout(0);
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

[EqAutoLogin.Native]::EnableDpiAwareness()

function Wait-ForProcessWindow {
  param(
    [Parameter(Mandatory = $true)]
    [int]$TargetProcessId,
    [Parameter(Mandatory = $true)]
    [int]$TimeoutSeconds
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    $windows = @([EqAutoLogin.Native]::GetProcessWindows($TargetProcessId))
    if ($windows.Count -gt 0) {
      return $windows[0]
    }

    Start-Sleep -Milliseconds 50
  } while ((Get-Date) -lt $deadline)

  throw "Timed out waiting for a visible EverQuest window."
}

function Wait-ForTargetWindowForeground {
  param(
    [Parameter(Mandatory = $true)]
    [IntPtr]$WindowHandle,
    [Parameter(Mandatory = $true)]
    [int]$TimeoutSeconds,
    [string]$Stage = "focus"
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    if ([EqAutoLogin.Native]::IsForegroundWindow($WindowHandle)) {
      return
    }

    [void][EqAutoLogin.Native]::FocusWindow($WindowHandle)
    if ([EqAutoLogin.Native]::IsForegroundWindow($WindowHandle)) {
      return
    }

    Start-Sleep -Milliseconds 100
  } while ((Get-Date) -lt $deadline)

  throw "Timed out waiting for the new EverQuest window to become foreground during $Stage."
}

function Convert-ColorRef {
  param(
    [Parameter(Mandatory = $true)]
    [int]$Color
  )

  $unsigned = [uint32]$Color
  [pscustomobject]@{
    R = [int]($unsigned -band 0xFF)
    G = [int](($unsigned -shr 8) -band 0xFF)
    B = [int](($unsigned -shr 16) -band 0xFF)
  }
}

function Get-WindowRelativePixel {
  param(
    [Parameter(Mandatory = $true)]
    [IntPtr]$WindowHandle,
    [Parameter(Mandatory = $true)]
    [double]$XRatio,
    [Parameter(Mandatory = $true)]
    [double]$YRatio
  )

  Convert-ColorRef -Color ([EqAutoLogin.Native]::GetWindowRelativePixel($WindowHandle, $XRatio, $YRatio))
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

function Get-ServerSelectPlayButtonProbePoints {
  @(
    @{ X = $ServerSelectPlayButtonXRatio; Y = $ServerSelectPlayButtonYRatio },
    @{ X = $ServerSelectPlayButtonXRatio - 0.040; Y = $ServerSelectPlayButtonYRatio },
    @{ X = $ServerSelectPlayButtonXRatio + 0.040; Y = $ServerSelectPlayButtonYRatio },
    @{ X = $ServerSelectPlayButtonXRatio; Y = $ServerSelectPlayButtonYRatio - 0.012 },
    @{ X = $ServerSelectPlayButtonXRatio; Y = $ServerSelectPlayButtonYRatio + 0.012 }
  )
}

function Test-ServerSelectPlayButtonReady {
  param(
    [Parameter(Mandatory = $true)]
    [IntPtr]$WindowHandle
  )

  foreach ($point in Get-ServerSelectPlayButtonProbePoints) {
    $pixel = Get-WindowRelativePixel -WindowHandle $WindowHandle -XRatio $point.X -YRatio $point.Y
    if (Test-ServerSelectPlayButtonPixel -Pixel $pixel) {
      return $true
    }
  }

  return $false
}

function Get-LoginCanvasState {
  param(
    [Parameter(Mandatory = $true)]
    [IntPtr]$WindowHandle
  )

  $errorButton = Get-WindowRelativePixel -WindowHandle $WindowHandle -XRatio 0.49 -YRatio 0.61
  $errorBorder = Get-WindowRelativePixel -WindowHandle $WindowHandle -XRatio 0.49 -YRatio 0.59
  if ((Test-BlueButtonPixel -Pixel $errorButton) -and (Test-BrightPixel -Pixel $errorBorder)) {
    return "login-error"
  }

  $mainMenuLoginButton = Get-WindowRelativePixel -WindowHandle $WindowHandle -XRatio 0.497 -YRatio 0.456
  $passwordField = Get-WindowRelativePixel -WindowHandle $WindowHandle -XRatio 0.497 -YRatio 0.486
  $loginButton = Get-WindowRelativePixel -WindowHandle $WindowHandle -XRatio 0.497 -YRatio 0.526
  $exitButton = Get-WindowRelativePixel -WindowHandle $WindowHandle -XRatio 0.497 -YRatio 0.600

  if ((Test-MainMenuLoginButtonPixel -Pixel $mainMenuLoginButton) -and (Test-MutedGrayPixel -Pixel $loginButton) -and (Test-MutedGrayPixel -Pixel $exitButton)) {
    return "main-menu"
  }

  if ((Test-DarkPixel -Pixel $mainMenuLoginButton) -and (Test-DarkPixel -Pixel $passwordField) -and (Test-MutedGrayPixel -Pixel $loginButton)) {
    return "login-form"
  }

  return "advanced"
}

function Wait-ForLoginOutcome {
  param(
    [Parameter(Mandatory = $true)]
    [IntPtr]$WindowHandle,
    [Parameter(Mandatory = $true)]
    [int]$TimeoutSeconds,
    [Parameter(Mandatory = $true)]
    [int]$FocusWaitSeconds
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  $eligibleAt = (Get-Date).AddMilliseconds($LoginOutcomeMinimumAgeMilliseconds)
  $advancedSince = $null
  do {
    Wait-ForTargetWindowForeground -WindowHandle $WindowHandle -TimeoutSeconds $FocusWaitSeconds -Stage "login result"
    try {
      $state = Get-LoginCanvasState -WindowHandle $WindowHandle
    } catch {
      $state = "advanced"
    }

    if ($state -eq "login-error" -or $state -eq "main-menu") {
      return $state
    }

    $now = Get-Date
    if ($state -eq "advanced" -and $now -ge $eligibleAt) {
      if ($null -eq $advancedSince) {
        $advancedSince = $now
      } elseif (($now - $advancedSince).TotalMilliseconds -ge $LoginOutcomeStableMilliseconds) {
        return $state
      }
    } else {
      $advancedSince = $null
    }

    Start-Sleep -Milliseconds 100
  } while ((Get-Date) -lt $deadline)

  try {
    return Get-LoginCanvasState -WindowHandle $WindowHandle
  } catch {
    return "advanced"
  }
}

function Wait-ForLoginFormReady {
  param(
    [Parameter(Mandatory = $true)]
    [IntPtr]$WindowHandle,
    [Parameter(Mandatory = $true)]
    [int]$TimeoutSeconds,
    [Parameter(Mandatory = $true)]
    [int]$FocusWaitSeconds,
    [Parameter(Mandatory = $true)]
    [int]$ClickMoveDelayMilliseconds,
    [Parameter(Mandatory = $true)]
    [int]$ClickHoldDelayMilliseconds
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  $lastMenuClick = [DateTime]::MinValue
  do {
    Wait-ForTargetWindowForeground -WindowHandle $WindowHandle -TimeoutSeconds $FocusWaitSeconds -Stage "login form"
    $state = Get-LoginCanvasState -WindowHandle $WindowHandle
    if ($state -eq "login-form") {
      return
    }

    if ($state -eq "main-menu" -and ((Get-Date) - $lastMenuClick).TotalMilliseconds -ge 500) {
      [EqAutoLogin.Native]::ClickWindowRelative($WindowHandle, 0.497, 0.456, $ClickMoveDelayMilliseconds, $ClickHoldDelayMilliseconds)
      $lastMenuClick = Get-Date
    }

    Start-Sleep -Milliseconds 100
  } while ((Get-Date) -lt $deadline)

  throw "Timed out waiting for the EverQuest login form."
}

function Wait-ForServerSelectReady {
  param(
    [Parameter(Mandatory = $true)]
    [IntPtr]$WindowHandle,
    [Parameter(Mandatory = $true)]
    [int]$TimeoutSeconds,
    [Parameter(Mandatory = $true)]
    [int]$FocusWaitSeconds
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    Wait-ForTargetWindowForeground -WindowHandle $WindowHandle -TimeoutSeconds $FocusWaitSeconds -Stage "server select"
    try {
      if (Test-ServerSelectPlayButtonReady -WindowHandle $WindowHandle) {
        return
      }
    } catch {
      # The client may briefly resize or swap surfaces while loading server select.
    }

    Start-Sleep -Milliseconds 100
  } while ((Get-Date) -lt $deadline)

  throw "Timed out waiting for the EverQuest server select screen."
}

$password = ""
try {
  $password = [Console]::In.ReadToEnd()
  if (-not $Username) {
    throw "No username was provided to the auto-login helper."
  }
  if (-not $password) {
    throw "No password was provided to the auto-login helper."
  }

  $resolvedPath = (Resolve-Path -LiteralPath $EqGamePath).Path
  $workingDirectory = Split-Path -Parent $resolvedPath
  Write-AutoLoginEvent -Stage "launch" -Message "Starting eqgame.exe patchme." -StatusState "running" -StatusLabel "Launching" -StatusDetail "Starting EverQuest." -ProgressValue 15 -ProgressLabel "Starting EverQuest"
  $process = Start-Process -FilePath $resolvedPath -ArgumentList "patchme" -WorkingDirectory $workingDirectory -PassThru

  Write-AutoLoginEvent -Stage "window-wait" -Message "Waiting for the EverQuest window." -StatusState "running" -StatusLabel "Waiting" -StatusDetail "Waiting for the EverQuest window." -ProgressValue 25 -ProgressLabel "Waiting for EverQuest window"
  $window = Wait-ForProcessWindow -TargetProcessId $process.Id -TimeoutSeconds $WindowWaitSeconds

  Write-AutoLoginEvent -Stage "focus" -Message "Waiting for the new EverQuest window to become foreground." -StatusState "running" -StatusLabel "Focusing" -StatusDetail "Waiting for the newly launched EverQuest client before sending input." -ProgressValue 30 -ProgressLabel "Focusing EverQuest"
  Wait-ForTargetWindowForeground -WindowHandle $window.Handle -TimeoutSeconds $FocusWaitSeconds -Stage "initial launch"

  Write-AutoLoginEvent -Stage "eula" -Message "Clicking the EULA accept position." -StatusState "running" -StatusLabel "Accepting" -StatusDetail "Advancing through the EULA screen." -ProgressValue 40 -ProgressLabel "Accepting EULA"
  for ($attempt = 1; $attempt -le $EulaClickAttempts; $attempt += 1) {
    Wait-ForTargetWindowForeground -WindowHandle $window.Handle -TimeoutSeconds $FocusWaitSeconds -Stage "EULA"
    [EqAutoLogin.Native]::ClickWindowRelative($window.Handle, 0.661, 0.757, $ClickMoveDelayMilliseconds, $ClickHoldDelayMilliseconds)
    if ($attempt -lt $EulaClickAttempts -and $EulaRetryDelayMilliseconds -gt 0) {
      Start-Sleep -Milliseconds $EulaRetryDelayMilliseconds
    }
  }

  Write-AutoLoginEvent -Stage "splash" -Message "Clicking the SOE splash/menu center." -StatusState "running" -StatusLabel "Advancing" -StatusDetail "Advancing through the loading splash." -ProgressValue 58 -ProgressLabel "Advancing login splash"
  Wait-ForTargetWindowForeground -WindowHandle $window.Handle -TimeoutSeconds $FocusWaitSeconds -Stage "splash"
  [EqAutoLogin.Native]::ClickWindowRelative($window.Handle, 0.5, 0.5, $ClickMoveDelayMilliseconds, $ClickHoldDelayMilliseconds)

  Write-AutoLoginEvent -Stage "login-form" -Message "Waiting for the login form." -StatusState "running" -StatusLabel "Waiting" -StatusDetail "Waiting for the EverQuest login form before typing." -ProgressValue 66 -ProgressLabel "Waiting for login form"
  Wait-ForLoginFormReady -WindowHandle $window.Handle -TimeoutSeconds $LoginFormWaitSeconds -FocusWaitSeconds $FocusWaitSeconds -ClickMoveDelayMilliseconds $ClickMoveDelayMilliseconds -ClickHoldDelayMilliseconds $ClickHoldDelayMilliseconds

  Write-AutoLoginEvent -Stage "credentials" -Message "Sending the username, password, and pressing Enter." -StatusState "running" -StatusLabel "Signing in" -StatusDetail "Sending account credentials." -ProgressValue 72 -ProgressLabel "Sending credentials"
  Wait-ForTargetWindowForeground -WindowHandle $window.Handle -TimeoutSeconds $FocusWaitSeconds -Stage "credentials"
  [EqAutoLogin.Native]::ClickWindowRelative($window.Handle, $LoginUsernameXRatio, $LoginUsernameYRatio, $ClickMoveDelayMilliseconds, $ClickHoldDelayMilliseconds)
  if ($CredentialFocusDelayMilliseconds -gt 0) {
    Start-Sleep -Milliseconds $CredentialFocusDelayMilliseconds
  }
  Wait-ForTargetWindowForeground -WindowHandle $window.Handle -TimeoutSeconds $FocusWaitSeconds -Stage "username entry"
  [EqAutoLogin.Native]::ClearText($CredentialClearBackspaceCount, $KeyDelayMilliseconds)
  [EqAutoLogin.Native]::SendText($Username, $KeyDelayMilliseconds)
  [EqAutoLogin.Native]::ClickWindowRelative($window.Handle, $LoginPasswordXRatio, $LoginPasswordYRatio, $ClickMoveDelayMilliseconds, $ClickHoldDelayMilliseconds)
  if ($CredentialFocusDelayMilliseconds -gt 0) {
    Start-Sleep -Milliseconds $CredentialFocusDelayMilliseconds
  }
  Wait-ForTargetWindowForeground -WindowHandle $window.Handle -TimeoutSeconds $FocusWaitSeconds -Stage "password entry"
  [EqAutoLogin.Native]::ClearText($CredentialClearBackspaceCount, $KeyDelayMilliseconds)
  [EqAutoLogin.Native]::SendText($password, $KeyDelayMilliseconds)
  if ($PostPasswordDelayMilliseconds -gt 0) {
    Start-Sleep -Milliseconds $PostPasswordDelayMilliseconds
  }
  Wait-ForTargetWindowForeground -WindowHandle $window.Handle -TimeoutSeconds $FocusWaitSeconds -Stage "login submit"
  [EqAutoLogin.Native]::SendEnter($KeyDelayMilliseconds)

  Write-AutoLoginEvent -Stage "confirm" -Message "Checking the EverQuest login screen state." -StatusState "running" -StatusLabel "Confirming" -StatusDetail "Checking whether the client advanced past the login form." -ProgressValue 86 -ProgressLabel "Confirming login result"
  $loginOutcome = Wait-ForLoginOutcome -WindowHandle $window.Handle -TimeoutSeconds $UdpWaitSeconds -FocusWaitSeconds $FocusWaitSeconds
  if ($loginOutcome -eq "advanced") {
    if ($EnterWorld) {
      Write-AutoLoginEvent -Stage "server-select" -Message "Waiting for the server select Play EverQuest button." -StatusState "running" -StatusLabel "Server select" -StatusDetail "Waiting for Play EverQuest before entering the selected server." -ProgressValue 94 -ProgressLabel "Waiting for Play EverQuest"
      try {
        Wait-ForServerSelectReady -WindowHandle $window.Handle -TimeoutSeconds $ServerSelectWaitSeconds -FocusWaitSeconds $FocusWaitSeconds
        Wait-ForTargetWindowForeground -WindowHandle $window.Handle -TimeoutSeconds $FocusWaitSeconds -Stage "Play EverQuest"
        Write-AutoLoginEvent -Stage "enter-world" -Message "Clicking Play EverQuest." -StatusState "running" -StatusLabel "Entering" -StatusDetail "Clicking Play EverQuest on the server select screen." -ProgressValue 98 -ProgressLabel "Clicking Play EverQuest"
        [EqAutoLogin.Native]::ClickWindowRelative($window.Handle, $ServerSelectPlayButtonXRatio, $ServerSelectPlayButtonYRatio, $ClickMoveDelayMilliseconds, $ClickHoldDelayMilliseconds)
        Write-AutoLoginEvent -Stage "enter-world-complete" -Message "Play EverQuest was pressed." -Tone "success" -StatusState "success" -StatusLabel "Entering world" -StatusDetail "Play EverQuest was pressed on the server select screen." -ProgressValue 100 -ProgressLabel "Entering world"
        exit 0
      } catch {
        Write-AutoLoginEvent -Stage "enter-world-timeout" -Message $_.Exception.Message -Tone "warning" -StatusState "warning" -StatusLabel "Server select" -StatusDetail "The login succeeded, but Play EverQuest could not be pressed automatically." -ProgressValue 100 -ProgressLabel "Server select ready"
      }
    }

    Write-AutoLoginEvent -Stage "complete" -Message "EverQuest advanced past the login form." -Tone "success" -StatusState "success" -StatusLabel "Login advanced" -StatusDetail "EverQuest advanced past the login form." -ProgressValue 100 -ProgressLabel "Auto login complete"
    exit 0
  }

  if ($loginOutcome -eq "login-error" -or $loginOutcome -eq "main-menu") {
    Write-AutoLoginEvent -Stage "login-error" -Message "The game client did not accept the login." -Tone "warning" -StatusState "warning" -StatusLabel "Login rejected" -StatusDetail "The game client did not accept the login. Check the saved username and password." -ProgressValue 92 -ProgressLabel "Login rejected"
    exit 3
  }

  Write-AutoLoginEvent -Stage "confirm-timeout" -Message "The client did not advance past the login form." -Tone "warning" -StatusState "warning" -StatusLabel "Login not confirmed" -StatusDetail "The login sequence was sent, but the client still appears to be on the login form." -ProgressValue 92 -ProgressLabel "Login not confirmed"
  exit 2
} catch {
  $message = $_.Exception.Message
  Write-AutoLoginEvent -Stage "error" -Message $message -Tone "error" -StatusState "error" -StatusLabel "Launch failed" -StatusDetail $message
  [Console]::Error.WriteLine($message)
  exit 1
} finally {
  $password = $null
}
