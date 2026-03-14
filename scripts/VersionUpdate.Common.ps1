Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Show-VersionUpdateDialog {
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

function Get-PackageJsonPath {
  $packageJsonPath = Join-Path (Split-Path -Parent $PSScriptRoot) "package.json"
  if (-not (Test-Path -LiteralPath $packageJsonPath)) {
    throw "Could not find package.json at '$packageJsonPath'."
  }

  return $packageJsonPath
}

function Invoke-VersionUpdate {
  param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("Minor", "Version", "Major")]
    [string]$UpdateKind
  )

  try {
    $packageJsonPath = Get-PackageJsonPath
    $rawJson = Get-Content -LiteralPath $packageJsonPath -Raw
    $versionMatch = [regex]::Match($rawJson, '"version"\s*:\s*"(?<version>\d+)\.(?<minor>\d+)\.(?<patch>\d+)"')

    if (-not $versionMatch.Success) {
      throw "Could not find a semantic version in package.json."
    }

    $major = [int]$versionMatch.Groups["version"].Value
    $minor = [int]$versionMatch.Groups["minor"].Value
    $patch = [int]$versionMatch.Groups["patch"].Value

    switch ($UpdateKind) {
      "Minor" {
        $patch += 1
      }
      "Version" {
        $minor += 1
        $patch = 0
      }
      "Major" {
        $major += 1
        $minor = 0
        $patch = 0
      }
    }

    $newVersion = "$major.$minor.$patch"
    $updatedJson = [regex]::Replace(
      $rawJson,
      '"version"\s*:\s*"\d+\.\d+\.\d+"',
      ('"version": "{0}"' -f $newVersion),
      1
    )

    $utf8NoBom = [System.Text.UTF8Encoding]::new($false)
    [System.IO.File]::WriteAllText($packageJsonPath, $updatedJson, $utf8NoBom)

    Show-VersionUpdateDialog `
      -Title "Version Update Successful" `
      -Message "package.json was updated to version $newVersion." `
      -Icon "Information"
  } catch {
    Show-VersionUpdateDialog `
      -Title "Version Update Failed" `
      -Message $_.Exception.Message `
      -Icon "Error"
    exit 1
  }
}
