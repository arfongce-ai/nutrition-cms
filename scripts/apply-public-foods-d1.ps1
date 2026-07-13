param(
  [string]$DatabaseName = "nutrition-cms-db",
  [switch]$SkipOfficialProducts,
  [switch]$SkipPublicFoods
)

$ErrorActionPreference = "Stop"

if (-not $env:CLOUDFLARE_API_TOKEN) {
  throw "CLOUDFLARE_API_TOKEN 환경변수가 필요합니다. Cloudflare API 토큰을 설정한 뒤 다시 실행하세요."
}

function Invoke-D1File {
  param(
    [Parameter(Mandatory = $true)]
    [string]$FilePath,
    [Parameter(Mandatory = $true)]
    [string]$Label
  )

  if (-not (Test-Path -LiteralPath $FilePath)) {
    throw "파일을 찾을 수 없습니다: $FilePath"
  }

  Write-Host "D1 적용 중: $Label"
  $temporaryPath = Join-Path $env:TEMP ("nutrition-d1-" + [guid]::NewGuid().ToString("N") + ".sql")
  $reader = [System.IO.StreamReader]::new((Resolve-Path -LiteralPath $FilePath).Path, [System.Text.Encoding]::UTF8)
  $writer = [System.IO.StreamWriter]::new($temporaryPath, $false, [System.Text.UTF8Encoding]::new($false))
  try {
    while (($line = $reader.ReadLine()) -ne $null) {
      $trimmed = $line.Trim().ToUpperInvariant()
      if ($trimmed -ne "BEGIN TRANSACTION;" -and $trimmed -ne "COMMIT;") {
        $writer.WriteLine($line)
      }
    }
  }
  finally {
    $reader.Dispose()
    $writer.Dispose()
  }

  npx.cmd --yes wrangler d1 execute $DatabaseName --remote --file $temporaryPath
  $d1ExitCode = $LASTEXITCODE
  Remove-Item -LiteralPath $temporaryPath -Force -ErrorAction SilentlyContinue
  $global:LASTEXITCODE = $d1ExitCode
  if ($LASTEXITCODE -ne 0) {
    throw "D1 적용 실패: $Label"
  }
}

Invoke-D1File -FilePath "schema/official-menu-db.d1.sql" -Label "schema"

if (-not $SkipOfficialProducts) {
  if (-not (Test-Path -LiteralPath "data/imported/d1-official-products-seed.sql")) {
    npm.cmd run db:export:d1
    if ($LASTEXITCODE -ne 0) {
      throw "공식 메뉴 seed 생성 실패"
    }
  }
  Invoke-D1File -FilePath "data/imported/d1-official-products-seed.sql" -Label "official menu/products"
}

if (-not $SkipPublicFoods) {
  if (-not (Test-Path -LiteralPath "data/imported/public-foods-d1/manifest.json")) {
    npm.cmd run db:import:public-foods
    if ($LASTEXITCODE -ne 0) {
      throw "공공 식품 DB seed 생성 실패"
    }
  }

  $chunks = Get-ChildItem -LiteralPath "data/imported/public-foods-d1" -Filter "public-foods-seed-*.sql" | Sort-Object Name
  if (-not $chunks.Count) {
    throw "공공 식품 DB seed 파일을 찾을 수 없습니다."
  }

  $index = 0
  foreach ($chunk in $chunks) {
    $index += 1
    Invoke-D1File -FilePath $chunk.FullName -Label "public foods $index/$($chunks.Count)"
  }
}

Write-Host "D1 적용 완료"
