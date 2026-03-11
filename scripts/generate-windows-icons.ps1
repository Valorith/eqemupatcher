param(
  [string]$SourcePath = "src/electron/assets/icons/icon.png",
  [string]$PngOutputPath = "src/electron/assets/icons/icon-app.png",
  [string]$IcoOutputPath = "src/electron/assets/icons/icon-app.ico",
  [int[]]$IconSizes = @(16, 24, 32, 48, 64, 128, 256),
  [double]$Scale = 0.82
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Drawing

function New-ResizedBitmap {
  param(
    [System.Drawing.Image]$Image,
    [int]$Size
  )

  $bitmap = [System.Drawing.Bitmap]::new($Size, $Size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $graphics.Clear([System.Drawing.Color]::Transparent)

  $margin = [Math]::Round($Size * ((1 - $Scale) / 2))
  $drawSize = $Size - ($margin * 2)
  $graphics.DrawImage($Image, $margin, $margin, $drawSize, $drawSize)
  $graphics.Dispose()

  return $bitmap
}

function Save-IconFromPngs {
  param(
    [byte[][]]$PngImages,
    [int[]]$Sizes,
    [string]$OutputPath
  )

  $fileStream = [System.IO.File]::Open($OutputPath, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write)
  $writer = [System.IO.BinaryWriter]::new($fileStream)

  try {
    $writer.Write([UInt16]0)
    $writer.Write([UInt16]1)
    $writer.Write([UInt16]$PngImages.Length)

    $offset = 6 + (16 * $PngImages.Length)

    for ($i = 0; $i -lt $PngImages.Length; $i++) {
      $size = $Sizes[$i]
      $png = $PngImages[$i]

      $writer.Write([byte]($(if ($size -ge 256) { 0 } else { $size })))
      $writer.Write([byte]($(if ($size -ge 256) { 0 } else { $size })))
      $writer.Write([byte]0)
      $writer.Write([byte]0)
      $writer.Write([UInt16]1)
      $writer.Write([UInt16]32)
      $writer.Write([UInt32]$png.Length)
      $writer.Write([UInt32]$offset)

      $offset += $png.Length
    }

    for ($i = 0; $i -lt $PngImages.Length; $i++) {
      $writer.Write($PngImages[$i])
    }
  } finally {
    $writer.Dispose()
    $fileStream.Dispose()
  }
}

$resolvedSource = (Resolve-Path $SourcePath).Path
$resolvedPngOutput = Join-Path (Get-Location) $PngOutputPath
$resolvedIcoOutput = Join-Path (Get-Location) $IcoOutputPath

$source = [System.Drawing.Image]::FromFile($resolvedSource)

try {
  $baseBitmap = New-ResizedBitmap -Image $source -Size 256
  try {
    $baseBitmap.Save($resolvedPngOutput, [System.Drawing.Imaging.ImageFormat]::Png)
  } finally {
    $baseBitmap.Dispose()
  }

  $paddedImage = [System.Drawing.Image]::FromFile($resolvedPngOutput)
  try {
    $pngImages = [System.Collections.Generic.List[byte[]]]::new()

    foreach ($size in $IconSizes) {
      $resized = New-ResizedBitmap -Image $paddedImage -Size $size
      try {
        $memoryStream = [System.IO.MemoryStream]::new()
        try {
          $resized.Save($memoryStream, [System.Drawing.Imaging.ImageFormat]::Png)
          $pngImages.Add($memoryStream.ToArray())
        } finally {
          $memoryStream.Dispose()
        }
      } finally {
        $resized.Dispose()
      }
    }

    Save-IconFromPngs -PngImages $pngImages.ToArray() -Sizes $IconSizes -OutputPath $resolvedIcoOutput
  } finally {
    $paddedImage.Dispose()
  }
} finally {
  $source.Dispose()
}
