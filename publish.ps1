<#
.SYNOPSIS
  Publish all CarlosGtrz Pi extension workspaces to npm.

.EXAMPLE
  ./publish.ps1

.EXAMPLE
  ./publish.ps1 -Otp 123456

.EXAMPLE
  ./publish.ps1 -DryRun

.EXAMPLE
  ./publish.ps1 -Package ansi-tools
#>
[CmdletBinding()]
param(
  [ValidateSet("all", "ansi-tools", "codex-aliases", "run-timer", "terminal-bell")]
  [string]$Package = "all",

  [string]$Otp,

  [switch]$DryRun,

  [switch]$SkipLoginCheck
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$workspaces = [ordered]@{
  "ansi-tools"     = "@carlosgtrz/pi-ansi-tools"
  "codex-aliases" = "@carlosgtrz/pi-codex-aliases"
  "run-timer"     = "@carlosgtrz/pi-run-timer"
  "terminal-bell" = "@carlosgtrz/pi-terminal-bell"
}

function Invoke-Step {
  param(
    [Parameter(Mandatory = $true)] [string]$Title,
    [Parameter(Mandatory = $true)] [string]$FilePath,
    [Parameter(Mandatory = $true)] [string[]]$Arguments
  )

  Write-Host "`n==> $Title" -ForegroundColor Cyan
  Write-Host "> $FilePath $($Arguments -join ' ')" -ForegroundColor DarkGray

  & $FilePath @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed with exit code ${LASTEXITCODE}: $FilePath $($Arguments -join ' ')"
  }
}

if (-not $SkipLoginCheck) {
  Invoke-Step "Checking npm login" "npm" @("whoami")
}

Invoke-Step "TypeScript check" "npm" @("run", "check")

$selectedWorkspaces = if ($Package -eq "all") {
  $workspaces.GetEnumerator()
} else {
  @([pscustomobject]@{ Key = $Package; Value = $workspaces[$Package] })
}

foreach ($entry in $selectedWorkspaces) {
  $workspaceName = $entry.Value
  $args = @("publish", "--access", "public", "-w", $workspaceName)

  if ($DryRun) {
    $args += "--dry-run"
  }

  if ($Otp) {
    $args += "--otp=$Otp"
  }

  Invoke-Step "Publishing $workspaceName" "npm" $args
}

Write-Host "`nDone." -ForegroundColor Green
