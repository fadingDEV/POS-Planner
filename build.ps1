param(
  [int]$RequestDelayMs = 120,
  [int]$MaxCandidatesPerModule = 6,
  [string]$MissingDescriptionText = "No description available."
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$scriptPath = Join-Path $root "scripts\Update-PosEsiDescriptions.ps1"
$modulesPath = Join-Path $root "public\data\modules.json"
$towersPath = Join-Path $root "public\data\towers.json"
$gameDataPath = Join-Path $root "public\data\game-data.js"

& $scriptPath `
  -ModulesJsonPath $modulesPath `
  -TowersJsonPath $towersPath `
  -GameDataJsPath $gameDataPath `
  -RequestDelayMs $RequestDelayMs `
  -MaxCandidatesPerModule $MaxCandidatesPerModule `
  -MissingDescriptionText $MissingDescriptionText
