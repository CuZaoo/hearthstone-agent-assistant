param(
  [string]$OutDir = ".\build"
)

Add-Type -AssemblyName System.Drawing

$resolvedOut = Resolve-Path -LiteralPath (New-Item -ItemType Directory -Force -Path $OutDir).FullName
$sizes = @(16, 24, 32, 48, 64, 128, 256)
$pngImages = @()

function New-IconPng {
  param([int]$Size)

  $bitmap = New-Object System.Drawing.Bitmap $Size, $Size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $graphics.Clear([System.Drawing.Color]::Transparent)

  $scale = $Size / 256.0
  $graphics.ScaleTransform($scale, $scale)

  $shadowBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(120, 0, 0, 0))
  $goldBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    (New-Object System.Drawing.Rectangle 44, 30, 168, 176),
    [System.Drawing.Color]::FromArgb(255, 239, 202, 112),
    [System.Drawing.Color]::FromArgb(255, 138, 96, 31),
    45
  )
  $innerBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    (New-Object System.Drawing.Rectangle 68, 54, 120, 128),
    [System.Drawing.Color]::FromArgb(255, 36, 28, 18),
    [System.Drawing.Color]::FromArgb(255, 13, 11, 9),
    90
  )
  $arcaneBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    (New-Object System.Drawing.Rectangle 88, 76, 80, 88),
    [System.Drawing.Color]::FromArgb(255, 88, 219, 244),
    [System.Drawing.Color]::FromArgb(255, 22, 99, 142),
    90
  )
  $goldPen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(255, 249, 222, 148)), 9
  $darkPen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(180, 40, 25, 10)), 7
  $arcanePen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(230, 146, 236, 255)), 7
  $sparkPen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(235, 247, 214, 134)), 8

  $shield = New-Object System.Drawing.Drawing2D.GraphicsPath
  $shield.AddPolygon(@(
    (New-Object System.Drawing.PointF 128, 18),
    (New-Object System.Drawing.PointF 218, 70),
    (New-Object System.Drawing.PointF 194, 184),
    (New-Object System.Drawing.PointF 128, 236),
    (New-Object System.Drawing.PointF 62, 184),
    (New-Object System.Drawing.PointF 38, 70)
  ))

  $shadowMatrix = New-Object System.Drawing.Drawing2D.Matrix
  $shadowMatrix.Translate(0, 10)
  $shadowPath = $shield.Clone()
  $shadowPath.Transform($shadowMatrix)
  $graphics.FillPath($shadowBrush, $shadowPath)
  $graphics.FillPath($goldBrush, $shield)
  $graphics.DrawPath($darkPen, $shield)
  $graphics.DrawPath($goldPen, $shield)

  $inner = New-Object System.Drawing.Drawing2D.GraphicsPath
  $inner.AddPolygon(@(
    (New-Object System.Drawing.PointF 128, 52),
    (New-Object System.Drawing.PointF 184, 84),
    (New-Object System.Drawing.PointF 168, 162),
    (New-Object System.Drawing.PointF 128, 196),
    (New-Object System.Drawing.PointF 88, 162),
    (New-Object System.Drawing.PointF 72, 84)
  ))
  $graphics.FillPath($innerBrush, $inner)

  $graphics.FillEllipse($arcaneBrush, 82, 74, 92, 92)
  $graphics.DrawEllipse($arcanePen, 82, 74, 92, 92)
  $graphics.DrawLine($sparkPen, 128, 58, 128, 184)
  $graphics.DrawLine($sparkPen, 86, 121, 170, 121)
  $graphics.DrawLine($sparkPen, 99, 92, 157, 150)
  $graphics.DrawLine($sparkPen, 157, 92, 99, 150)

  $smallGold = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(230, 255, 220, 125))
  $graphics.FillEllipse($smallGold, 112, 106, 32, 32)

  foreach ($object in @($smallGold, $sparkPen, $arcanePen, $darkPen, $goldPen, $arcaneBrush, $innerBrush, $goldBrush, $shadowBrush, $shadowPath, $shadowMatrix, $inner, $shield, $graphics)) {
    $object.Dispose()
  }

  $stream = New-Object System.IO.MemoryStream
  $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
  $bitmap.Dispose()
  return ,$stream.ToArray()
}

foreach ($size in $sizes) {
  $bytes = New-IconPng -Size $size
  $pngImages += [pscustomobject]@{ Size = $size; Bytes = $bytes }
  [System.IO.File]::WriteAllBytes((Join-Path $resolvedOut "icon-$size.png"), $bytes)
  if ($size -eq 256) {
    [System.IO.File]::WriteAllBytes((Join-Path $resolvedOut "icon.png"), $bytes)
  }
}

$icoPath = Join-Path $resolvedOut "icon.ico"
$writer = New-Object System.IO.BinaryWriter([System.IO.File]::Open($icoPath, [System.IO.FileMode]::Create))
$writer.Write([uint16]0)
$writer.Write([uint16]1)
$writer.Write([uint16]$pngImages.Count)

$offset = 6 + ($pngImages.Count * 16)
foreach ($image in $pngImages) {
  $sizeByte = if ($image.Size -eq 256) { 0 } else { $image.Size }
  $writer.Write([byte]$sizeByte)
  $writer.Write([byte]$sizeByte)
  $writer.Write([byte]0)
  $writer.Write([byte]0)
  $writer.Write([uint16]1)
  $writer.Write([uint16]32)
  $writer.Write([uint32]$image.Bytes.Length)
  $writer.Write([uint32]$offset)
  $offset += $image.Bytes.Length
}

foreach ($image in $pngImages) {
  $writer.Write($image.Bytes)
}

$writer.Dispose()
Write-Host "Generated $icoPath"
