Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Show-RebuildDialog {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Title,

    [Parameter(Mandatory = $true)]
    [string]$Message,

    [Parameter(Mandatory = $true)]
    [ValidateSet("Information", "Error")]
    [string]$Icon
  )

  Add-Type -AssemblyName System.Windows.Forms
  $messageBoxIcon = [System.Windows.Forms.MessageBoxIcon]::$Icon
  [System.Windows.Forms.MessageBox]::Show(
    $Message,
    $Title,
    [System.Windows.Forms.MessageBoxButtons]::OK,
    $messageBoxIcon
  ) | Out-Null
}

function Get-RepoRoot {
  $repoRoot = Split-Path -Parent $PSScriptRoot
  if (-not (Test-Path -LiteralPath (Join-Path $repoRoot "package.json"))) {
    throw "Could not find the repo root from '$PSScriptRoot'."
  }

  return $repoRoot
}

function Get-NpmCommandPath {
  $npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
  if (-not $npmCommand) {
    throw "Could not find npm.cmd on PATH."
  }

  return $npmCommand.Source
}

function Invoke-Rebuild {
  param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("Patcher", "FileListBuilder", "All")]
    [string]$BuildTarget
  )

  try {
    $repoRoot = Get-RepoRoot
    $npmCommandPath = Get-NpmCommandPath
    Push-Location $repoRoot

    $commands = switch ($BuildTarget) {
      "Patcher" {
        @(
          @{
            Label = "patcher"
            OutputPath = Join-Path $repoRoot "dist\electron"
            Script = "dist:win"
          }
        )
      }
      "FileListBuilder" {
        @(
          @{
            Label = "file list builder"
            OutputPath = Join-Path $repoRoot "dist\filelistbuilder-electron"
            Script = "dist:filelistbuilder:win"
          }
        )
      }
      "All" {
        @(
          @{
            Label = "patcher"
            OutputPath = Join-Path $repoRoot "dist\electron"
            Script = "dist:win"
          },
          @{
            Label = "file list builder"
            OutputPath = Join-Path $repoRoot "dist\filelistbuilder-electron"
            Script = "dist:filelistbuilder:win"
          }
        )
      }
    }

    foreach ($command in $commands) {
      if (Test-Path -LiteralPath $command.OutputPath) {
        Remove-Item -LiteralPath $command.OutputPath -Recurse -Force
      }

      Write-Host ("Running npm run {0}..." -f $command.Script)
      & $npmCommandPath run $command.Script
      if ($LASTEXITCODE -ne 0) {
        throw ("npm run {0} failed with exit code {1}." -f $command.Script, $LASTEXITCODE)
      }
    }

    $successMessage = switch ($BuildTarget) {
      "Patcher" { "Fresh patcher rebuild completed successfully." }
      "FileListBuilder" { "Fresh file list builder rebuild completed successfully." }
      "All" { "Fresh rebuild of patcher and file list builder completed successfully." }
    }

    Show-RebuildDialog -Title "Rebuild Successful" -Message $successMessage -Icon "Information"
  } catch {
    Show-RebuildDialog -Title "Rebuild Failed" -Message $_.Exception.Message -Icon "Error"
    exit 1
  } finally {
    Pop-Location
  }
}
