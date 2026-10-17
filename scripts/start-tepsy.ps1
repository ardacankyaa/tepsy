param(
    [int]$Port = 3000,
    [switch]$NoBrowser,
    [switch]$CheckOnly
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js 24+ is required. Run SETUP.bat first.' }
$runtimeJson = & node (Join-Path $PSScriptRoot 'runtime-config.cjs')
if ($LASTEXITCODE -ne 0) { throw 'Invalid TEPSY runtime configuration.' }
$runtimeConfig = $runtimeJson | ConvertFrom-Json
if (-not $PSBoundParameters.ContainsKey('Port')) { $Port = $runtimeConfig.port }
$baseUrl = "http://127.0.0.1:$Port"
$statusUrl = "$baseUrl/api/auth/status"
$stateDir = Join-Path $projectRoot '.tepsy'
$pidPath = Join-Path $stateDir 'production.pid'
$buildPath = Join-Path $projectRoot '.next/BUILD_ID'

function Test-TepsyReady {
    try {
        $response = Invoke-WebRequest -Uri $statusUrl -UseBasicParsing -TimeoutSec 2 -Proxy $null
        if ($response.StatusCode -ne 200) { return $false }
        $status = $response.Content | ConvertFrom-Json
        return $status.service -in @('tepsy', 'restopos-pro')
    } catch {
        return $false
    }
}

function Get-OwnedServerProcess {
    if (Test-Path -LiteralPath $pidPath) {
        $savedId = 0
        if ([int]::TryParse((Get-Content -LiteralPath $pidPath -Raw).Trim(), [ref]$savedId)) {
            $candidate = Get-Process -Id $savedId -ErrorAction SilentlyContinue
            if ($candidate -and $candidate.ProcessName -eq 'node') {
                $startUtc = $candidate.StartTime.ToUniversalTime()
                $markerUtc = (Get-Item -LiteralPath $pidPath).LastWriteTimeUtc
                if ($markerUtc -ge $startUtc -and $markerUtc -le $startUtc.AddMinutes(5)) { return $candidate }
            }
        }
    }

    try {
        $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($conn -and $conn.OwningProcess) {
            $candidate = Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue
            if ($candidate -and $candidate.ProcessName -eq 'node') {
                $cim = Get-CimInstance Win32_Process -Filter "ProcessId = $($candidate.Id)" -ErrorAction SilentlyContinue
                $expectedScript = [regex]::Escape((Join-Path $projectRoot 'server.js'))
                if ($cim -and $cim.CommandLine -match ('(?i)(?:^|[\s"])' + $expectedScript + '(?:"|\s|$)')) {
                    New-Item -ItemType Directory -Path $stateDir -Force | Out-Null
                    Set-Content -LiteralPath $pidPath -Value $candidate.Id -Force
                    return $candidate
                }
            }
        }
    } catch { }

    return $null
}

function Test-BuildFresh {
    if (-not (Test-Path -LiteralPath $buildPath)) { return $false }
    $buildTime = (Get-Item -LiteralPath $buildPath).LastWriteTimeUtc
    $sources = @('src', 'public', 'server.js', 'package.json', 'next.config.mjs', 'next.config.js', 'prisma/schema.prisma', 'package-lock.json', 'tailwind.config.js', 'postcss.config.js', 'jsconfig.json')
    foreach ($source in $sources) {
        $sourcePath = Join-Path $projectRoot $source
        if (-not (Test-Path -LiteralPath $sourcePath)) { continue }
        $files = if (Test-Path -LiteralPath $sourcePath -PathType Container) {
            Get-ChildItem -LiteralPath $sourcePath -Recurse -File
        } else {
            @(Get-Item -LiteralPath $sourcePath)
        }
        foreach ($file in $files) {
            if ($file.LastWriteTimeUtc -gt $buildTime) { return $false }
        }
    }
    return $true
}

$databasePath = $runtimeConfig.databasePath
$upgradeRequired = $false
if (Test-Path -LiteralPath $databasePath) {
    if (-not (Get-Command py -ErrorAction SilentlyContinue)) { throw 'Python 3 (py) is required to verify the TEPSY database upgrade.' }
    & py (Join-Path $PSScriptRoot 'migrate-tepsy.py') --database $databasePath --check
    if ($LASTEXITCODE -eq 2) { $upgradeRequired = $true }
    elseif ($LASTEXITCODE -ne 0) { throw 'Database verification failed. Run SETUP.bat or inspect the error above.' }
}

$ready = Test-TepsyReady
$fresh = Test-BuildFresh
$ownedProcess = Get-OwnedServerProcess
$buildIsNewerThanServer = $ready -and $ownedProcess -and (Test-Path -LiteralPath $buildPath) -and
    ((Get-Item -LiteralPath $buildPath).LastWriteTimeUtc -gt $ownedProcess.StartTime.ToUniversalTime())

if ($ready -and $fresh -and -not $buildIsNewerThanServer -and -not $upgradeRequired) {
    if (-not $ownedProcess) {
        Write-Error "A service answers at $baseUrl, but its process cannot be verified as this TEPSY instance."
        exit 1
    }
    Write-Host "TEPSY already running: $baseUrl"
    if (-not $NoBrowser -and -not $CheckOnly) { Start-Process $baseUrl }
    exit 0
}

if (($ready -and (-not $fresh -or $buildIsNewerThanServer -or $upgradeRequired)) -or (-not $ready -and $ownedProcess)) {
    if (-not $ownedProcess) {
        Write-Error "TEPSY source changed, but the server process cannot be verified. Stop the old server manually before starting this version."
        exit 1
    }
    if ($CheckOnly) {
        Write-Host 'UPDATE_REQUIRED: source or production build is newer than the running server.'
        exit 0
    }
    Write-Host 'Stopping the previous TEPSY process...'
    Stop-Process -Id $ownedProcess.Id
    try { $ownedProcess.WaitForExit(10000) | Out-Null } catch { }
}

if ($CheckOnly) {
    Write-Host 'START_REQUIRED: no ready TEPSY server is running.'
    exit 0
}

try {
    $occupied = Test-NetConnection -ComputerName 127.0.0.1 -Port $Port -InformationLevel Quiet -WarningAction SilentlyContinue
} catch {
    $occupied = $false
}
if ($occupied) {
    Write-Error "Port $Port is occupied by a different service. Close it or choose another port."
    exit 1
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Error 'Node.js is not installed or is not on PATH. Run SETUP.bat first.'
    exit 1
}
if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'node_modules'))) {
    Write-Error 'Dependencies are missing. Run SETUP.bat first.'
    exit 1
}
if ($upgradeRequired) {
    & py (Join-Path $PSScriptRoot 'migrate-tepsy.py') --database $databasePath
    if ($LASTEXITCODE -ne 0) { throw 'TEPSY database upgrade failed. The server was not started.' }
    & npx.cmd prisma generate --no-hints
    if ($LASTEXITCODE -ne 0) { throw 'Prisma client generation failed.' }
}
if (-not $fresh) {
    Write-Host 'Preparing the production build...'
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

New-Item -ItemType Directory -Path $stateDir -Force | Out-Null
$stdoutPath = Join-Path $stateDir 'startup.log'
$stderrPath = Join-Path $stateDir 'startup-error.log'
$oldPort = $env:PORT
try {
    $env:PORT = [string]$Port
    $serverArguments = @(('"' + (Join-Path $projectRoot 'server.js') + '"'), '--production')
    $process = Start-Process -FilePath (Get-Command node).Source -ArgumentList $serverArguments -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath -PassThru
} finally {
    $env:PORT = $oldPort
}

for ($attempt = 0; $attempt -lt 60; $attempt++) {
    if (Test-TepsyReady) {
        Set-Content -LiteralPath $pidPath -Value $process.Id
        Write-Host "TEPSY ready: $baseUrl (PID $($process.Id))"
        if (-not $NoBrowser) { Start-Process $baseUrl }
        exit 0
    }
    if ($process.HasExited) { break }
    Start-Sleep -Seconds 1
}

Write-Error "TEPSY did not start. See $stderrPath and $stdoutPath."
exit 1
