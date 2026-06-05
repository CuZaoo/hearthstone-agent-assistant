param(
  [string]$Images,
  [string]$CardIds,
  [string]$UrlTemplate,
  [string]$Merge,
  [switch]$CropRenderArt,

  [Parameter(Mandatory = $true)]
  [string]$Out
)

Add-Type -AssemblyName System.Drawing

function Get-Luma([System.Drawing.Color]$Color) {
  return 0.2126 * $Color.R + 0.7152 * $Color.G + 0.0722 * $Color.B
}

function Get-DHash([System.Drawing.Bitmap]$Source) {
  $resized = $null
  $graphics = $null
  try {
    $resized = [System.Drawing.Bitmap]::new(9, 8)
    $graphics = [System.Drawing.Graphics]::FromImage($resized)
    $graphics.DrawImage($Source, 0, 0, 9, 8)

    $bits = New-Object System.Collections.Generic.List[int]
    for ($y = 0; $y -lt 8; $y += 1) {
      for ($x = 0; $x -lt 8; $x += 1) {
        $left = Get-Luma ($resized.GetPixel($x, $y))
        $right = Get-Luma ($resized.GetPixel(($x + 1), $y))
        $bits.Add([int]($left -gt $right))
      }
    }

    $hash = ''
    for ($index = 0; $index -lt $bits.Count; $index += 4) {
      $nibble = 0
      for ($offset = 0; $offset -lt 4; $offset += 1) {
        $nibble = $nibble * 2 + $bits[$index + $offset]
      }
      $hash += $nibble.ToString('x')
    }
    return $hash
  } finally {
    if ($graphics) { $graphics.Dispose() }
    if ($resized) { $resized.Dispose() }
  }
}

function Get-RenderArtCrop([System.Drawing.Bitmap]$Source) {
  $x = [Math]::Round($Source.Width * 0.14)
  $y = [Math]::Round($Source.Height * 0.145)
  $width = [Math]::Round($Source.Width * 0.72)
  $height = [Math]::Round($Source.Height * 0.34)
  $rect = [System.Drawing.Rectangle]::new($x, $y, $width, $height)
  return $Source.Clone($rect, $Source.PixelFormat)
}

function Read-Features([string]$Path) {
  if (!$Path -or !(Test-Path -LiteralPath $Path)) {
    return [ordered]@{}
  }
  $raw = Get-Content -LiteralPath $Path -Raw -Encoding UTF8
  $json = $raw | ConvertFrom-Json
  $source = if ($json.features) { $json.features } else { $json }
  $features = [ordered]@{}
  foreach ($property in $source.PSObject.Properties) {
    $features[$property.Name] = [string]$property.Value
  }
  return $features
}

function Add-LocalImageFeatures($Features, [string]$DirectoryPath) {
  $directory = (Resolve-Path -LiteralPath $DirectoryPath).Path
  $extensions = @('.png', '.jpg', '.jpeg', '.webp')
  Get-ChildItem -LiteralPath $directory -File |
    Where-Object { $extensions -contains $_.Extension.ToLowerInvariant() } |
    Sort-Object Name |
    ForEach-Object {
      $source = $null
      try {
        $source = [System.Drawing.Bitmap]::new($_.FullName)
        $cardId = [System.IO.Path]::GetFileNameWithoutExtension($_.Name)
        $Features[$cardId] = Get-DHash $source
      } catch {
        Write-Warning "Skip unreadable image: $($_.FullName)"
      } finally {
        if ($source) { $source.Dispose() }
      }
    }
}

function Add-RemoteImageFeatures(
  $Features,
  [string]$CardIdPath,
  [string]$Template,
  [bool]$CropRenderArt
) {
  $ids = Get-Content -LiteralPath $CardIdPath -Raw -Encoding UTF8 | ConvertFrom-Json
  $client = [System.Net.WebClient]::new()
  if ($env:HTTPS_PROXY) {
    $client.Proxy = [System.Net.WebProxy]::new($env:HTTPS_PROXY)
  } elseif ($env:HTTP_PROXY) {
    $client.Proxy = [System.Net.WebProxy]::new($env:HTTP_PROXY)
  }

  $index = 0
  foreach ($cardId in $ids) {
    $index += 1
    if ($Features.Contains($cardId)) {
      continue
    }
    $url = $Template.Replace('{cardId}', [uri]::EscapeDataString($cardId))
    $stream = $null
    $source = $null
    $hashSource = $null
    try {
      $bytes = $client.DownloadData($url)
      $stream = [System.IO.MemoryStream]::new($bytes)
      $source = [System.Drawing.Bitmap]::new($stream)
      if ($CropRenderArt) {
        $hashSource = Get-RenderArtCrop $source
      } else {
        $hashSource = $source
      }
      $Features[$cardId] = Get-DHash $hashSource
      if ($index % 100 -eq 0) {
        Write-Output "Processed $index / $($ids.Count)"
      }
    } catch {
      Write-Warning "Download or decode failed: $cardId $url"
    } finally {
      if ($hashSource -and ![object]::ReferenceEquals($hashSource, $source)) { $hashSource.Dispose() }
      if ($source) { $source.Dispose() }
      if ($stream) { $stream.Dispose() }
    }
  }
  $client.Dispose()
}

if (!$Images -and (!$CardIds -or !$UrlTemplate) -and !$Merge) {
  throw "Provide -Images, or both -CardIds and -UrlTemplate, or -Merge."
}

$features = Read-Features $Merge
if ($Images) {
  Add-LocalImageFeatures $features $Images
}
if ($CardIds -and $UrlTemplate) {
  Add-RemoteImageFeatures $features $CardIds $UrlTemplate $CropRenderArt
}

$payload = [ordered]@{ features = $features }
$json = $payload | ConvertTo-Json -Depth 3
[System.IO.File]::WriteAllText(
  $Out,
  "$json`n",
  [System.Text.UTF8Encoding]::new($false)
)
Write-Output "Generated $($features.Count) image features: $Out"
