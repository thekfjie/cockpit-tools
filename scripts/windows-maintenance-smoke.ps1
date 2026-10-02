$ErrorActionPreference = 'Stop'
$installDir = Join-Path $env:RUNNER_TEMP 'cockpit-maintenance-smoke'
$dataDir = Join-Path $env:RUNNER_TEMP 'cockpit-maintenance-smoke-data'
$evidence = [ordered]@{ success = $false; pages = @(); debugError = $null; startupLog = @(); processes = @() }
$app = $null
try {
    $installer = Get-ChildItem target/release/bundle/nsis/*.exe | Select-Object -First 1
    if (-not $installer) { throw 'NSIS installer is missing' }
    $install = Start-Process -FilePath $installer.FullName -ArgumentList '/S', "/D=$installDir" -WindowStyle Hidden -Wait -PassThru
    $evidence.installerExitCode = $install.ExitCode
    if ($install.ExitCode -ne 0) { throw "Installer failed: $($install.ExitCode)" }
    $executable = Get-ChildItem -LiteralPath $installDir -Filter 'cockpit*tools.exe' | Select-Object -First 1
    if (-not $executable) { throw 'Installed application is missing' }
    $evidence.executable = $executable.Name
    $evidence.version = $executable.VersionInfo.ProductVersion
    $env:COCKPIT_TOOLS_DATA_DIR = $dataDir
    $env:WEBVIEW2_USER_DATA_FOLDER = Join-Path $env:RUNNER_TEMP 'cockpit-maintenance-smoke-webview'
    $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--remote-debugging-address=127.0.0.1 --remote-debugging-port=49231 --disable-gpu'
    $app = Start-Process -FilePath $executable.FullName -WorkingDirectory $installDir -WindowStyle Hidden -PassThru -RedirectStandardOutput smoke-stdout.log -RedirectStandardError smoke-stderr.log
    $evidence.pid = $app.Id
    $targets = @()
    for ($attempt = 0; $attempt -lt 45; $attempt++) {
        Start-Sleep -Seconds 1
        $app.Refresh()
        if ($app.HasExited) { throw "Installed app exited: $($app.ExitCode)" }
        try {
            $targets = @(Invoke-RestMethod 'http://127.0.0.1:49231/json/list' -TimeoutSec 2 -NoProxy)
            $evidence.debugError = $null
        } catch {
            $evidence.debugError = $_.Exception.Message
            continue
        }
        if ($targets | Where-Object { $_.url -match '^(tauri://localhost|https?://tauri.localhost)(/|$)' }) { break }
    }
    $evidence.pages = @($targets | Select-Object type, url)
    if ($targets | Where-Object { $_.url -match '(localhost|127\.0\.0\.1):1420' }) { throw 'Release app opened the development server' }
    if (-not ($targets | Where-Object { $_.url -match '^(tauri://localhost|https?://tauri.localhost)(/|$)' })) { throw 'Embedded frontend did not open' }
    $evidence.success = $true
} catch {
    $evidence.error = $_.Exception.Message
    throw
} finally {
    $logDir = Join-Path $dataDir 'logs'
    if (Test-Path -LiteralPath $logDir) {
        $evidence.startupLog = @(Get-ChildItem -LiteralPath $logDir -Filter 'app.log*' | ForEach-Object { Get-Content -LiteralPath $_.FullName -Tail 80 })
    }
    $evidence.processes = @(Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^(cockpit.*tools|msedgewebview2)\.exe$' } | Select-Object Name, ProcessId, ParentProcessId, CommandLine)
    $evidence | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath frontend-smoke.json -Encoding utf8
    if ($app) {
        $app.Refresh()
        if (-not $app.HasExited) { Stop-Process -Id $app.Id -Force }
    }
}
