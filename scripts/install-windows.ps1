$ErrorActionPreference = 'Stop'
$projectDirectory = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location -LiteralPath $projectDirectory

function Invoke-RequiredCommand {
  param([string]$Description, [string]$Executable, [string[]]$Arguments)
  Write-Host $Description -ForegroundColor Cyan
  & $Executable @Arguments
  if ($LASTEXITCODE -ne 0) { throw "$Description başarısız oldu (çıkış kodu: $LASTEXITCODE)." }
}

try {
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw 'Node.js 24 veya üzeri gerekli: https://nodejs.org'
  }
  $nodeVersion = & node --version
  if ($LASTEXITCODE -ne 0 -or $nodeVersion -notmatch '^v(?<major>\d+)\.' -or [int]$Matches.major -lt 24) {
    throw 'Node.js 24 veya üzeri gerekli: https://nodejs.org'
  }
  if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
    throw 'npm bulunamadı. Node.js kurulumunu kontrol edin.'
  }
  if (-not (Get-Command py -ErrorAction SilentlyContinue)) { throw 'Yedekleme ve güvenli yükseltme için Python 3 başlatıcısı (py) gerekli.' }
  $runtimeJson = & node (Join-Path $PSScriptRoot 'runtime-config.cjs')
  if ($LASTEXITCODE -ne 0) { throw 'TEPSY çalışma ayarları geçersiz.' }
  $runtimeConfig = $runtimeJson | ConvertFrom-Json

  $running = $null
  try {
    $running = Invoke-RestMethod -Uri "http://127.0.0.1:$($runtimeConfig.port)/api/auth/status" -TimeoutSec 2 -ErrorAction Stop
  } catch { }
  if ($running -and $running.service -in @('tepsy', 'restopos-pro')) {
    throw 'TEPSY çalışırken kurulum yapmayın. Önce çalışan sunucuyu kapatın.'
  }

  $database = $runtimeConfig.databasePath
  $defaultDatabase = [IO.Path]::GetFullPath((Join-Path $projectDirectory 'prisma/dev.db'))
  $customDatabase = $database -ne $defaultDatabase
  $databaseExists = Test-Path -LiteralPath $database
  if ($customDatabase -and -not $databaseExists) { throw 'Özel veritabanı önce şemaya göre oluşturulmalıdır. Varsayılan kurulum için TEPSY_DATABASE_URL ayarını kaldırın.' }
  if ($databaseExists) {
    if (-not (Get-Command py -ErrorAction SilentlyContinue)) {
      throw 'Mevcut restoran verisini yedeklemek için Python başlatıcısı (py) gerekli.'
    }
    Invoke-RequiredCommand 'Mevcut veritabanının doğrulanmış yedeği alınıyor...' 'py' @('scripts/sqlite-backup.py', '--source', $database)
    Invoke-RequiredCommand 'Sipariş geçmişi güvenli şekilde güncelleniyor...' 'py' @('scripts/migrate-tepsy.py', '--database', $database)
  }

  Invoke-RequiredCommand 'Bağımlılıklar kilit dosyasından kuruluyor...' 'npm.cmd' @('ci', '--no-fund')
  Invoke-RequiredCommand 'Prisma istemcisi hazırlanıyor...' 'npx.cmd' @('prisma', 'generate', '--no-hints')
  if (-not $databaseExists) {
    Invoke-RequiredCommand 'Yeni SQLite dosyası güvenle hazırlanıyor...' 'py' @('scripts/initialize-sqlite.py', '--database', $database)
    Invoke-RequiredCommand 'Yeni veritabanı şeması oluşturuluyor...' 'npx.cmd' @('prisma', 'db', 'push')
  }
  Invoke-RequiredCommand 'Üretim derlemesi hazırlanıyor...' 'npm.cmd' @('run', 'build')

  Write-Host 'Kurulum tamamlandı. START.bat ile başlatın; yeni restoranda /setup ekranını kullanın.' -ForegroundColor Green
} catch {
  Write-Error $_
  exit 1
}
