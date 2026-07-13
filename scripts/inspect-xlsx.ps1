param(
  [Parameter(Mandatory = $true)]
  [string[]]$Path,

  [int]$RowLimit = 4,
  [int]$ColLimit = 60
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem

function Get-IntValue {
  param(
    [object]$Value,
    [int]$Fallback = 0
  )

  $current = $Value
  for ($i = 0; $i -lt 12 -and $current -is [array]; $i++) {
    if ($current.Count -eq 0) { return $Fallback }
    $current = $current[0]
  }

  $parsed = 0
  if ([int]::TryParse([string]$current, [ref]$parsed)) {
    return $parsed
  }
  return $Fallback
}

function Read-ZipEntryText {
  param(
    [System.IO.Compression.ZipArchive]$Zip,
    [string]$Name
  )

  $entry = $Zip.GetEntry($Name)
  if (-not $entry) { return $null }

  $stream = $entry.Open()
  try {
    $reader = [System.IO.StreamReader]::new($stream, [System.Text.Encoding]::UTF8)
    try {
      return $reader.ReadToEnd()
    } finally {
      $reader.Dispose()
    }
  } finally {
    $stream.Dispose()
  }
}

function Get-ColIndex {
  param([string]$CellRef)

  $letters = ([regex]::Match($CellRef, '^[A-Z]+')).Value
  $value = 0
  foreach ($ch in $letters.ToCharArray()) {
    $value = ($value * 26) + ([int][char]$ch - [int][char]'A' + 1)
  }
  return $value
}

function Get-ColName {
  param([int]$Index)

  $name = ''
  $i = $Index
  while ($i -gt 0) {
    $mod = [int](($i - 1) % 26)
    $name = ([string][char]([int][char]'A' + $mod)) + $name
    $i = [int][math]::Floor(($i - 1) / 26)
  }
  return $name
}

function Get-FirstSheet {
  param([System.IO.Compression.ZipArchive]$Zip)

  [xml]$workbook = Read-ZipEntryText -Zip $Zip -Name 'xl/workbook.xml'
  [xml]$relsXml = Read-ZipEntryText -Zip $Zip -Name 'xl/_rels/workbook.xml.rels'

  $relMap = @{}
  foreach ($rel in @($relsXml.Relationships.Relationship)) {
    $relMap[[string]$rel.Id] = [string]$rel.Target
  }

  $sheet = @($workbook.workbook.sheets.sheet)[0]
  $rid = $sheet.'r:id'
  if (-not $rid) {
    $rid = $sheet.GetAttribute('id', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships')
  }

  $target = $relMap[[string]$rid]
  $entryName = if ($target.StartsWith('/')) { $target.TrimStart('/') } else { 'xl/' + $target.TrimStart('./') }

  return [pscustomobject]@{
    Name = [string]$sheet.name
    Entry = $entryName
  }
}

function Read-Rows {
  param(
    [System.IO.Compression.ZipArchive]$Zip,
    [string]$EntryName,
    [int]$MaxRow,
    [int]$MaxCol
  )

  $entry = $Zip.GetEntry($EntryName)
  if (-not $entry) { return @() }

  $stream = $entry.Open()
  $settings = [System.Xml.XmlReaderSettings]::new()
  $settings.IgnoreWhitespace = $true
  $reader = [System.Xml.XmlReader]::Create($stream, $settings)
  $rows = [System.Collections.Generic.List[object]]::new()

  try {
    while ($reader.Read()) {
      if ($reader.NodeType -ne [System.Xml.XmlNodeType]::Element -or $reader.LocalName -ne 'row') { continue }

      $rowNumber = Get-IntValue -Value $reader.GetAttribute('r')
      if ($rowNumber -gt $MaxRow) { break }

      $cells = [System.Collections.Generic.List[object]]::new()
      $rowReader = $reader.ReadSubtree()
      try {
        while ($rowReader.Read()) {
          if ($rowReader.NodeType -ne [System.Xml.XmlNodeType]::Element -or $rowReader.LocalName -ne 'c') { continue }

          $cellRef = [string]$rowReader.GetAttribute('r')
          $cellType = [string]$rowReader.GetAttribute('t')
          $col = Get-ColIndex -CellRef $cellRef
          if ($col -gt $MaxCol) { continue }

          $raw = ''
          $cellReader = $rowReader.ReadSubtree()
          try {
            while ($cellReader.Read()) {
              if ($cellReader.NodeType -eq [System.Xml.XmlNodeType]::Element -and ($cellReader.LocalName -eq 'v' -or $cellReader.LocalName -eq 't')) {
                $raw = $cellReader.ReadElementContentAsString()
                break
              }
            }
          } finally {
            $cellReader.Dispose()
          }

          $cells.Add([pscustomobject]@{
            Ref = $cellRef
            Col = $col
            Type = $cellType
            Raw = $raw
          }) | Out-Null
        }
      } finally {
        $rowReader.Dispose()
      }

      $rows.Add([pscustomobject]@{
        Row = $rowNumber
        Cells = $cells.ToArray()
      }) | Out-Null
    }
  } finally {
    $reader.Dispose()
    $stream.Dispose()
  }

  return ,$rows.ToArray()
}

function Read-SharedStrings {
  param(
    [System.IO.Compression.ZipArchive]$Zip,
    [int[]]$Needed
  )

  $map = @{}
  if (-not $Needed -or $Needed.Count -eq 0) { return $map }

  $need = @{}
  foreach ($index in ($Needed | Sort-Object -Unique)) {
    $need[[int]$index] = $true
  }

  $entry = $Zip.GetEntry('xl/sharedStrings.xml')
  if (-not $entry) { return $map }

  $stream = $entry.Open()
  $settings = [System.Xml.XmlReaderSettings]::new()
  $settings.IgnoreWhitespace = $true
  $reader = [System.Xml.XmlReader]::Create($stream, $settings)
  $sharedIndex = -1

  try {
    while ($reader.Read()) {
      if ($reader.NodeType -ne [System.Xml.XmlNodeType]::Element -or $reader.LocalName -ne 'si') { continue }

      $sharedIndex++
      if ($need.ContainsKey($sharedIndex)) {
        [xml]$xml = $reader.ReadOuterXml()
        $map[[string]$sharedIndex] = $xml.si.InnerText
        if ($map.Count -ge $need.Count) { break }
      } else {
        $reader.Skip()
      }
    }
  } finally {
    $reader.Dispose()
    $stream.Dispose()
  }

  return $map
}

foreach ($xlsxPath in $Path) {
  $zip = [System.IO.Compression.ZipFile]::OpenRead($xlsxPath)
  try {
    $sheet = Get-FirstSheet -Zip $zip
    $previewRows = Read-Rows -Zip $zip -EntryName $sheet.Entry -MaxRow $RowLimit -MaxCol $ColLimit

    $needed = [System.Collections.Generic.List[int]]::new()
    foreach ($row in $previewRows) {
      foreach ($cell in $row.Cells) {
        if ($cell.Type -eq 's' -and $cell.Raw -ne '') {
          $needed.Add((Get-IntValue -Value $cell.Raw)) | Out-Null
        }
      }
    }
    $shared = Read-SharedStrings -Zip $zip -Needed $needed.ToArray()

    Write-Output "=== $(Split-Path $xlsxPath -Leaf) / $($sheet.Name) ==="
    foreach ($row in $previewRows) {
      Write-Output "-- row $($row.Row) --"
      foreach ($cell in $row.Cells) {
        $value = $cell.Raw
        if ($cell.Type -eq 's' -and $shared.ContainsKey([string]$cell.Raw)) {
          $value = $shared[[string]$cell.Raw]
        }
        $columnName = Get-ColName -Index $cell.Col
        Write-Output "$columnName`t$value"
      }
    }
  } finally {
    $zip.Dispose()
  }
}
