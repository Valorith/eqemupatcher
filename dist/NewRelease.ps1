param(
  [string]$Version = "",
  [string]$AssetPath = "",
  [string]$Repository = "Valorith/eqemupatcher",
  [string]$AdditionalNotes = $null,
  [switch]$Draft,
  [switch]$Prerelease,
  [switch]$NoAdditionalNotesPrompt,
  [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Get-RepoRoot {
  return (Split-Path -Parent $PSScriptRoot)
}

function Get-PackageVersion {
  $packageJsonPath = Join-Path (Get-RepoRoot) "package.json"
  if (-not (Test-Path -LiteralPath $packageJsonPath)) {
    throw "Could not find package.json at '$packageJsonPath'."
  }

  $packageJson = Get-Content -LiteralPath $packageJsonPath -Raw | ConvertFrom-Json
  $packageVersion = [string]$packageJson.version
  if ($packageVersion -notmatch '^\d+\.\d+\.\d+$') {
    throw "package.json version '$packageVersion' is not a valid semantic version."
  }

  return $packageVersion
}

function Resolve-ReleaseVersion {
  param([string]$RequestedVersion)

  $defaultVersion = Get-PackageVersion
  $resolvedVersion = $RequestedVersion

  if ([string]::IsNullOrWhiteSpace($resolvedVersion)) {
    $inputVersion = Read-Host "Release version [$defaultVersion]"
    $resolvedVersion = [string]::IsNullOrWhiteSpace($inputVersion) ? $defaultVersion : $inputVersion.Trim()
  }

  $resolvedVersion = $resolvedVersion.Trim() -replace '^[vV]', ''
  if ($resolvedVersion -notmatch '^\d+\.\d+\.\d+$') {
    throw "Version '$resolvedVersion' is not valid. Use format 0.0.0."
  }

  return $resolvedVersion
}

function Resolve-ReleaseAssetPath {
  param([string]$RequestedAssetPath)

  $resolvedAssetPath = $RequestedAssetPath
  if ([string]::IsNullOrWhiteSpace($resolvedAssetPath)) {
    $resolvedAssetPath = Join-Path (Get-RepoRoot) "dist\electron\x64\CWPatcher.exe"
  }

  if (-not (Test-Path -LiteralPath $resolvedAssetPath)) {
    throw "Could not find release binary at '$resolvedAssetPath'. Build the x64 patcher first."
  }

  return (Resolve-Path -LiteralPath $resolvedAssetPath).Path
}

function Read-AdditionalReleaseNotes {
  param(
    [AllowNull()]
    [string]$ProvidedNotes,
    [bool]$ProvidedNotesWasBound,
    [bool]$SkipPrompt
  )

  if ($ProvidedNotesWasBound) {
    return $ProvidedNotes
  }

  if ($SkipPrompt) {
    return ""
  }

  $answer = Read-Host "Add notes to prepend to GitHub's generated release notes? [y/N]"
  if ($answer -notmatch '^(y|yes)$') {
    return ""
  }

  Write-Host "Enter additional notes. Finish with a single '.' on its own line."
  $lines = @()
  while ($true) {
    $line = Read-Host "> "
    if ($line -eq ".") {
      break
    }

    $lines += $line
  }

  return (($lines -join [Environment]::NewLine).Trim())
}

function Assert-GitHubCliReady {
  if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
    throw "GitHub CLI ('gh') was not found on PATH."
  }

  & gh auth status --hostname github.com *> $null
  if ($LASTEXITCODE -ne 0) {
    throw "GitHub CLI is not authenticated. Run 'gh auth login' first."
  }
}

function Assert-ReleaseDoesNotExist {
  param(
    [string]$Repo,
    [string]$Tag
  )

  & gh release view $Tag --repo $Repo *> $null
  if ($LASTEXITCODE -eq 0) {
    throw "Release '$Tag' already exists in $Repo."
  }
}

try {
  $releaseVersion = Resolve-ReleaseVersion -RequestedVersion $Version
  $releaseTag = "V$releaseVersion"
  $releaseAssetPath = Resolve-ReleaseAssetPath -RequestedAssetPath $AssetPath
  $notes = Read-AdditionalReleaseNotes `
    -ProvidedNotes $AdditionalNotes `
    -ProvidedNotesWasBound $PSBoundParameters.ContainsKey("AdditionalNotes") `
    -SkipPrompt $NoAdditionalNotesPrompt
  $assetArgument = "{0}#CWPatcher.exe" -f $releaseAssetPath

  $arguments = @(
    "release",
    "create",
    $releaseTag,
    $assetArgument,
    "--repo",
    $Repository,
    "--generate-notes"
  )

  if (-not [string]::IsNullOrWhiteSpace($notes)) {
    $arguments += @("--notes", $notes)
  }

  if ($Draft) {
    $arguments += "--draft"
  }

  if ($Prerelease) {
    $arguments += "--prerelease"
  }

  Write-Host "Release tag: $releaseTag"
  Write-Host "Repository:  $Repository"
  Write-Host "Asset:       $releaseAssetPath"

  if ($DryRun) {
    Write-Host "Dry run only. Command that would be executed:"
    Write-Host ("gh " + (($arguments | ForEach-Object { if ($_ -match '\s') { '"{0}"' -f ($_ -replace '"', '\"') } else { $_ } }) -join " "))
    exit 0
  }

  Assert-GitHubCliReady
  Assert-ReleaseDoesNotExist -Repo $Repository -Tag $releaseTag

  & gh @arguments
  if ($LASTEXITCODE -ne 0) {
    throw "GitHub release creation failed with exit code $LASTEXITCODE."
  }

  Write-Host "Release $releaseTag created successfully."
} catch {
  Write-Error $_.Exception.Message
  exit 1
}
