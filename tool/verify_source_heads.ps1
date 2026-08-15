param(
  [string]$RepositoryRoot = (Split-Path -Parent $PSScriptRoot),
  [string]$FlutterSource = "",
  [string]$ServerSource = ""
)

$ErrorActionPreference = "Stop"
if (-not $FlutterSource) { $FlutterSource = $RepositoryRoot }
if (-not $ServerSource) { $ServerSource = $RepositoryRoot }

function Read-GitHead([string]$SourcePath) {
  $head = (& git -C $SourcePath rev-parse HEAD 2>$null).Trim()
  if (-not $head) {
    throw "Unable to resolve git HEAD for $SourcePath"
  }
  return $head
}

$gitHead = Read-GitHead $RepositoryRoot
$flutterHead = Read-GitHead $FlutterSource
$serverHead = Read-GitHead $ServerSource

Write-Output "git HEAD=$gitHead"
Write-Output "Flutter source HEAD=$flutterHead"
Write-Output "Server source HEAD=$serverHead"

if ($gitHead -ne $flutterHead -or $gitHead -ne $serverHead) {
  throw "SOURCE_HEAD_MISMATCH: product acceptance is prohibited"
}

Write-Output "TESTABLE_SOURCE_COMMIT=$gitHead"
