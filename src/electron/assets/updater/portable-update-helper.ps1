param(
  [Parameter(Mandatory = $true)]
  [int]$ParentPid,

  [Parameter(Mandatory = $true)]
  [string]$TargetExe,

  [Parameter(Mandatory = $true)]
  [string]$StagedExe,

  [Parameter(Mandatory = $true)]
  [string]$BackupExe,

  [Parameter(Mandatory = $true)]
  [string]$ResultPath,

  [Parameter(Mandatory = $true)]
  [string]$LogPath,

  [string]$RelaunchArgsJsonBase64 = ""
)

$ErrorActionPreference = "Stop"

function Ensure-ParentDirectory {
  param([string]$Path)

  $parent = Split-Path -Parent $Path
  if ($parent -and -not (Test-Path -LiteralPath $parent)) {
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
  }
}

function Write-Log {
  param([string]$Message)

  Ensure-ParentDirectory -Path $LogPath
  Add-Content -LiteralPath $LogPath -Value ("[{0}] {1}" -f ([DateTime]::UtcNow.ToString("o")), $Message)
}

function Write-Result {
  param(
    [string]$Status,
    [string]$Message
  )

  Ensure-ParentDirectory -Path $ResultPath
  $payload = @{
    status = $Status
    message = $Message
    targetExe = $TargetExe
    stagedExe = $StagedExe
    writtenAt = [DateTime]::UtcNow.ToString("o")
  } | ConvertTo-Json -Depth 5

  Set-Content -LiteralPath $ResultPath -Value $payload -Encoding UTF8
}

function Wait-ForParentExit {
  param(
    [int]$ProcessId,
    [int]$Attempts = 120,
    [int]$DelayMilliseconds = 500
  )

  for ($attempt = 0; $attempt -lt $Attempts; $attempt++) {
    $process = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
    if (-not $process) {
      return
    }

    Start-Sleep -Milliseconds $DelayMilliseconds
  }

  throw "Timed out waiting for launcher process $ProcessId to exit."
}

function Move-PathWithRetry {
  param(
    [string]$Source,
    [string]$Destination,
    [int]$Attempts = 120,
    [int]$DelayMilliseconds = 500
  )

  Ensure-ParentDirectory -Path $Destination

  for ($attempt = 0; $attempt -lt $Attempts; $attempt++) {
    try {
      if (Test-Path -LiteralPath $Destination) {
        Remove-Item -LiteralPath $Destination -Force
      }

      Move-Item -LiteralPath $Source -Destination $Destination -Force
      return
    } catch {
      if ($attempt -ge ($Attempts - 1)) {
        throw
      }
      Start-Sleep -Milliseconds $DelayMilliseconds
    }
  }
}

function Remove-PathIfPresent {
  param([string]$Path)

  if (Test-Path -LiteralPath $Path) {
    Remove-Item -LiteralPath $Path -Force -Recurse
  }
}

function Format-WindowsArgument {
  param([string]$Value)

  if ($null -eq $Value) {
    return '""'
  }

  if ($Value -eq "") {
    return '""'
  }

  if ($Value -notmatch '[\s"]') {
    return $Value
  }

  $builder = New-Object System.Text.StringBuilder
  [void]$builder.Append('"')
  $backslashCount = 0

  foreach ($character in $Value.ToCharArray()) {
    if ($character -eq '\') {
      $backslashCount += 1
      continue
    }

    if ($character -eq '"') {
      [void]$builder.Append(('\' * (($backslashCount * 2) + 1)))
      [void]$builder.Append('"')
      $backslashCount = 0
      continue
    }

    if ($backslashCount -gt 0) {
      [void]$builder.Append(('\' * $backslashCount))
      $backslashCount = 0
    }

    [void]$builder.Append($character)
  }

  if ($backslashCount -gt 0) {
    [void]$builder.Append(('\' * ($backslashCount * 2)))
  }

  [void]$builder.Append('"')
  return $builder.ToString()
}

function Join-WindowsArguments {
  param([string[]]$ArgumentList = @())

  if (-not $ArgumentList -or $ArgumentList.Count -eq 0) {
    return ""
  }

  return (($ArgumentList | ForEach-Object { Format-WindowsArgument -Value $_ }) -join " ")
}

function Start-LauncherViaProcessApi {
  param(
    [string]$ExecutablePath,
    [string[]]$ArgumentList = @(),
    [string]$WorkingDirectory,
    [bool]$UseShellExecute
  )

  $startInfo = New-Object System.Diagnostics.ProcessStartInfo
  $startInfo.FileName = $ExecutablePath
  $startInfo.WorkingDirectory = $WorkingDirectory
  $startInfo.UseShellExecute = $UseShellExecute
  $startInfo.Arguments = Join-WindowsArguments -ArgumentList $ArgumentList

  return [System.Diagnostics.Process]::Start($startInfo)
}

function Invoke-LauncherStartStrategy {
  param(
    [string]$StrategyName,
    [string]$ExecutablePath,
    [string[]]$ArgumentList = @(),
    [string]$WorkingDirectory
  )

  switch ($StrategyName) {
    "start-process" {
      if ($ArgumentList.Count -gt 0) {
        $quotedArguments = Join-WindowsArguments -ArgumentList $ArgumentList
        return Start-Process -FilePath $ExecutablePath -ArgumentList $quotedArguments -WorkingDirectory $WorkingDirectory -PassThru
      }

      return Start-Process -FilePath $ExecutablePath -WorkingDirectory $WorkingDirectory -PassThru
    }
    "process-api" {
      return Start-LauncherViaProcessApi -ExecutablePath $ExecutablePath -ArgumentList $ArgumentList -WorkingDirectory $WorkingDirectory -UseShellExecute:$false
    }
    "shell-execute" {
      return Start-LauncherViaProcessApi -ExecutablePath $ExecutablePath -ArgumentList $ArgumentList -WorkingDirectory $WorkingDirectory -UseShellExecute:$true
    }
    default {
      throw "Unknown launcher start strategy: $StrategyName"
    }
  }
}

function Start-LauncherWithRetry {
  param(
    [string]$ExecutablePath,
    [string[]]$ArgumentList = @(),
    [int]$Attempts = 20,
    [int]$DelayMilliseconds = 750,
    [int]$StabilityDelayMilliseconds = 1500
  )

  $workingDirectory = Split-Path -Parent $ExecutablePath
  $lastError = $null
  $strategies = @("start-process", "process-api", "shell-execute")

  for ($attempt = 1; $attempt -le $Attempts; $attempt++) {
    foreach ($strategy in $strategies) {
      try {
        $process = Invoke-LauncherStartStrategy -StrategyName $strategy -ExecutablePath $ExecutablePath -ArgumentList $ArgumentList -WorkingDirectory $workingDirectory
        if (-not $process) {
          throw "Launcher process did not return a process handle."
        }

        Start-Sleep -Milliseconds $StabilityDelayMilliseconds
        if ($process.HasExited) {
          throw "Launcher process exited immediately with code $($process.ExitCode)."
        }

        Write-Log "Launcher relaunch succeeded on attempt $attempt via $strategy (pid=$($process.Id))."
        return
      } catch {
        $lastError = "${strategy}: $($_.Exception.Message)"
        Write-Log "Launcher relaunch attempt $attempt via $strategy failed: $($_.Exception.Message)"
      }
    }

    if ($attempt -lt $Attempts) {
      Start-Sleep -Milliseconds $DelayMilliseconds
    }
  }

  throw "Unable to relaunch the updated launcher after $Attempts attempts. Last error: $lastError"
}

try {
  Write-Log "Portable updater helper started."
  Wait-ForParentExit -ProcessId $ParentPid
  Write-Log "Launcher process exited."

  if (-not (Test-Path -LiteralPath $TargetExe)) {
    throw "Target launcher executable was not found: $TargetExe"
  }

  if (-not (Test-Path -LiteralPath $StagedExe)) {
    throw "Staged launcher executable was not found: $StagedExe"
  }

  Remove-PathIfPresent -Path $BackupExe
  Write-Log "Moving current launcher to backup."
  Move-PathWithRetry -Source $TargetExe -Destination $BackupExe

  Write-Log "Moving staged launcher into place."
  Move-PathWithRetry -Source $StagedExe -Destination $TargetExe

  $relaunchArgs = @()
  if ($RelaunchArgsJsonBase64) {
    $json = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($RelaunchArgsJsonBase64))
    $parsed = ConvertFrom-Json -InputObject $json
    if ($parsed -is [System.Array]) {
      $relaunchArgs = @($parsed)
    } elseif ($parsed) {
      $relaunchArgs = @($parsed)
    }
  }

  Write-Log "Relaunching updated launcher."
  Start-LauncherWithRetry -ExecutablePath $TargetExe -ArgumentList $relaunchArgs

  Remove-PathIfPresent -Path $BackupExe
  $stagedDirectory = Split-Path -Parent $StagedExe
  if ($stagedDirectory -and (Test-Path -LiteralPath $stagedDirectory)) {
    Remove-PathIfPresent -Path $stagedDirectory
  }

  Write-Result -Status "success" -Message "Launcher update applied successfully."
  Write-Log "Portable updater helper completed successfully."
} catch {
  $message = $_.Exception.Message
  Write-Log "Portable updater helper failed: $message"

  try {
    if ((Test-Path -LiteralPath $BackupExe) -and -not (Test-Path -LiteralPath $TargetExe)) {
      Write-Log "Restoring launcher backup."
      Move-PathWithRetry -Source $BackupExe -Destination $TargetExe
    }
  } catch {
    Write-Log ("Backup restore failed: {0}" -f $_.Exception.Message)
  }

  Write-Result -Status "error" -Message $message
  exit 1
}
