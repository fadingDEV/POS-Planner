param(
    [string]$ModulesJsonPath = "public/data/modules.json",
    [string]$TowersJsonPath = "public/data/towers.json",
    [string]$GameDataJsPath = "public/data/game-data.js",
    [string]$ModuleIconDirectory = "public/images/modules",
    [string]$DataSource = "tranquility",
    [int]$IconSize = 64,
    [int]$RequestDelayMs = 120,
    [int]$MaxCandidatesPerModule = 6,
    [string]$MissingDescriptionText = "No description available."
)

$ErrorActionPreference = "Stop"
$ApiRoot = "https://esi.evetech.net/latest"
$CachePath = Join-Path (Split-Path -Path $MyInvocation.MyCommand.Path -Parent) "data/esi-description-cache.json"
$RepoRoot = Split-Path -Path (Split-Path -Path $MyInvocation.MyCommand.Path -Parent) -Parent
$ModuleIconOutputPath = if ([System.IO.Path]::IsPathRooted($ModuleIconDirectory)) { $ModuleIconDirectory } else { Join-Path $RepoRoot $ModuleIconDirectory }
$ModuleIconWebPath = "./" + (($ModuleIconDirectory -replace "\\", "/") -replace "^[./]+", "")
$cache = @{}
$ModuleIconFallbackNames = @{
  "Blood Medium Laser Beam Battery" = "Blood Small Beam Laser Battery"
  "Citadel Torpedo Battery" = "Guristas Torpedo Battery"
  "Dread Guristas Citadel Torpedo Battery" = "Dread Guristas Torpedo Battery"
  "Guristas Citadel Torpedo Battery" = "Guristas Torpedo Battery"
  "Hyasyoda Laboratory" = "Research Laboratory"
}

if (-not (Test-Path $ModuleIconOutputPath)) {
  New-Item -ItemType Directory -Path $ModuleIconOutputPath -Force | Out-Null
}

if (Test-Path $CachePath) {
  try {
    $loadedCache = Get-Content $CachePath -Raw | ConvertFrom-Json -ErrorAction Stop
    if ($loadedCache) {
      if ($loadedCache.PSObject.Properties) {
        foreach ($entry in $loadedCache.PSObject.Properties) {
          $cache[$entry.Name] = $entry.Value
        }
      } elseif ($loadedCache -is [System.Collections.IDictionary]) {
        foreach ($key in $loadedCache.Keys) {
          $cache[$key] = $loadedCache[$key]
        }
      }
    }
  } catch {
    $cache = @{}
  }
}

function Get-CacheKey {
  param([string]$Name)
  $safeName = [string]($Name -as [string])
  if (-not $safeName) {
    $safeName = ""
  }
  return ([regex]::Replace($safeName.Trim().ToLowerInvariant(), "[^a-z0-9]+", " "))
}

function Get-ModuleIconFallbackName {
  param([string]$Name)
  if ([string]::IsNullOrWhiteSpace($Name)) {
    return ""
  }
  if ($ModuleIconFallbackNames.ContainsKey($Name)) {
    return [string]$ModuleIconFallbackNames[$Name]
  }
  return ""
}

function Decode-Description {
  param([string]$Text)
  if ([string]::IsNullOrWhiteSpace($Text)) {
    return ""
  }

  $text = [regex]::Replace($Text, "(?i)<\\s*br\\s*/?>", "`n")
  $text = [regex]::Replace($text, "(?i)<\\s*/\\s*p\\s*>", "`n")
  $text = [regex]::Replace($text, "(?i)<[^>]+>", "")
  $text = $text -replace "&nbsp;", " "
  return [System.Net.WebUtility]::HtmlDecode($text).Trim()
}

function Normalize-Name {
  param([string]$Name)
  $safeName = [string]($Name -as [string])
  if (-not $safeName) {
    $safeName = ""
  }
  return ([regex]::Replace($safeName.ToLowerInvariant().Trim(), "[^a-z0-9]+", " ") -replace "\s+", " ").Trim()
}

function New-JsonStringArray {
  param(
    [Parameter(Mandatory = $true)]
    [string[]]$Values
  )

  if (-not $Values -or $Values.Count -eq 0) {
    return "[]"
  }

  $parts = New-Object System.Collections.Generic.List[string]
  foreach ($value in $Values) {
    $safeValue = [string]($value -as [string])
    if ([string]::IsNullOrWhiteSpace($safeValue)) {
      continue
    }
    $escaped = $safeValue.Replace('\', '\\').Replace('"', '\"').Replace("`r", "").Replace("`n", "")
    $parts.Add("`"$escaped`"")
  }

  return "[" + ($parts -join ",") + "]"
}

function Search-EsiTypeIds {
  param([string]$Name)

  $searchUrl = "$ApiRoot/universe/ids/?datasource=$DataSource"
  $values = @([string]$Name) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
  if (-not $values -or $values.Count -eq 0) {
    return @()
  }

  $payload = New-JsonStringArray -Values $values

  try {
    $result = Invoke-RestMethod -Method Post -Uri $searchUrl -Body $payload -ContentType "application/json" -TimeoutSec 20 -ErrorAction Stop
    if ($result -and $result.inventory_types) {
      return @($result.inventory_types | ForEach-Object { [int]$_.id } | Where-Object { $_ -ne 0 })
    }
  } catch {
    return @()
  }
  return @()
}

function Find-TypeDetails {
  param([int]$TypeId)
  $typeUrl = "$ApiRoot/universe/types/$TypeId/?datasource=$DataSource"
  try {
    return Invoke-RestMethod -Method Get -Uri $typeUrl -TimeoutSec 20 -ErrorAction Stop
  } catch {
    return $null
  }
}

function Get-TypeIconUrl {
  param([int]$TypeId)
  if ($TypeId -le 0) {
    return ""
  }

  $iconFilePath = Join-Path $ModuleIconOutputPath "$TypeId.png"
  if (-not (Test-Path $iconFilePath)) {
    $iconSourceUrl = "https://images.evetech.net/types/$TypeId/icon?size=$IconSize"
    try {
      Invoke-WebRequest -Uri $iconSourceUrl -OutFile $iconFilePath -UseBasicParsing -TimeoutSec 20 -ErrorAction Stop | Out-Null
      Start-Sleep -Milliseconds $RequestDelayMs
    } catch {
      if (Test-Path $iconFilePath) {
        Remove-Item -Path $iconFilePath -Force -ErrorAction SilentlyContinue
      }
      return ""
    }
  }

  return "$ModuleIconWebPath/$TypeId.png"
}

function Read-EsiModuleInfo {
  param([string]$Name)
  if ([string]::IsNullOrWhiteSpace($Name)) {
    return [pscustomobject]@{
      description = ""
      typeId = 0
      iconUrl = ""
    }
  }

  $cacheKey = Get-CacheKey $Name
  $fallbackName = Get-ModuleIconFallbackName -Name $Name
  $cachedDescription = ""
  $cachedTypeId = 0
  if ($cache.ContainsKey($cacheKey)) {
    $cached = $cache[$cacheKey]
    if ($cached -is [string]) {
      $cachedDescription = [string]$cached
    } elseif ($cached -and $cached.PSObject.Properties) {
      $cachedDescription = [string]$cached.description
      if ($cached.PSObject.Properties.Name -contains "typeId") {
        $cachedTypeId = [int]$cached.typeId
      }
      if ($cachedTypeId -gt 0) {
        return [pscustomobject]@{
          description = $cachedDescription
          typeId = $cachedTypeId
          iconUrl = Get-TypeIconUrl -TypeId $cachedTypeId
        }
      }
    }
  }

  $typeIds = Search-EsiTypeIds -Name $Name
  if (!$typeIds -or $typeIds.Count -eq 0) {
    if (-not [string]::IsNullOrWhiteSpace($fallbackName)) {
      $fallbackInfo = Read-EsiModuleInfo -Name $fallbackName
      if ($fallbackInfo.typeId -gt 0) {
        return [pscustomobject]@{
          description = $cachedDescription
          typeId = [int]$fallbackInfo.typeId
          iconUrl = [string]$fallbackInfo.iconUrl
        }
      }
    }

    return [pscustomobject]@{
      description = $cachedDescription
      typeId = 0
      iconUrl = ""
    }
  }

  $target = Normalize-Name $Name
  $bestMatch = $null
  $bestTypeId = 0
  $fallbackText = ""
  $fallbackTypeId = 0
  $limit = [Math]::Min($MaxCandidatesPerModule, $typeIds.Count)

  for ($i = 0; $i -lt $limit; $i += 1) {
    $details = Find-TypeDetails -TypeId $typeIds[$i]
    if (-not $details) {
      continue
    }

    if (-not $fallbackText -and -not [string]::IsNullOrWhiteSpace($details.description)) {
      $fallbackText = Decode-Description $details.description
      $fallbackTypeId = [int]$details.type_id
    }

    if (Normalize-Name $details.name -eq $target) {
      $bestMatch = Decode-Description $details.description
      $bestTypeId = [int]$details.type_id
      break
    }
  }

  if (-not $bestMatch -and -not [string]::IsNullOrWhiteSpace($fallbackText)) {
    $bestMatch = $fallbackText
    $bestTypeId = $fallbackTypeId
  }

  if (-not $bestMatch) {
    $bestMatch = $cachedDescription
  }

  if ($bestTypeId -le 0 -and -not [string]::IsNullOrWhiteSpace($fallbackName)) {
    $fallbackInfo = Read-EsiModuleInfo -Name $fallbackName
    if ($fallbackInfo.typeId -gt 0) {
      $bestTypeId = [int]$fallbackInfo.typeId
    }
  }

  if ($bestMatch -or $bestTypeId -gt 0) {
    $cache[$cacheKey] = [ordered]@{
      description = $bestMatch
      typeId = $bestTypeId
    }
  }

  Start-Sleep -Milliseconds $RequestDelayMs
  return [pscustomobject]@{
    description = $bestMatch
    typeId = $bestTypeId
    iconUrl = Get-TypeIconUrl -TypeId $bestTypeId
  }
}

function Load-Json($Path) {
  $raw = Get-Content -Path $Path -Raw
  return $raw | ConvertFrom-Json
}

$modules = Load-Json $ModulesJsonPath
$towers = Load-Json $TowersJsonPath

if (-not $modules -or $modules.Count -eq 0) {
  throw "No modules found in $ModulesJsonPath"
}

Write-Host "Updating ESI descriptions for $($modules.Count) modules..."

$updated = [System.Collections.Generic.List[object]]::new()
$index = 0

foreach ($module in $modules) {
  $index += 1
  $entry = [ordered]@{}
  $module.PSObject.Properties | ForEach-Object {
    $entry[$_.Name] = $_.Value
  }

  $name = [string]$entry.name
  $moduleInfo = Read-EsiModuleInfo -Name $name
  $description = [string]$moduleInfo.description
  if ([string]::IsNullOrWhiteSpace($description)) {
    $description = $MissingDescriptionText
  }
  $entry.description = $description
  if ($moduleInfo.typeId -gt 0) {
    $entry.typeId = [int]$moduleInfo.typeId
    $entry.iconUrl = [string]$moduleInfo.iconUrl
  }
  if ($null -ne $entry.code) {
    $entry.code = [string]$entry.code
  }

  $updated.Add([pscustomobject]$entry)

  Write-Progress -Activity "Updating ESI descriptions" -Status "[$index / $($modules.Count)] $name" -PercentComplete (($index / $modules.Count) * 100)
}

$cacheDir = Split-Path -Path $CachePath -Parent
if (-not (Test-Path $cacheDir)) {
  New-Item -ItemType Directory -Path $cacheDir | Out-Null
}
Set-Content -Path $CachePath -Value ($cache | ConvertTo-Json -Depth 10) -Encoding UTF8

Set-Content -Path $ModulesJsonPath -Value ($updated | ConvertTo-Json -Depth 10) -Encoding UTF8

$gameData = @"
window.__POS_TOWER_DATA__ = $($towers | ConvertTo-Json -Depth 10);
window.__POS_MODULE_DATA__ = $($updated | ConvertTo-Json -Depth 10);
"@

Set-Content -Path $GameDataJsPath -Value $gameData -Encoding UTF8
Write-Progress -Activity "Updating ESI descriptions" -Completed -Status "done"
Write-Host "Done. Wrote:"
Write-Host " - $ModulesJsonPath"
Write-Host " - $GameDataJsPath"
Write-Host " - $CachePath"
