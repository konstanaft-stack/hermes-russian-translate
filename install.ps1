# Explicit dependency installation only. Does not start a model or update plugin code.
[CmdletBinding()]
param(
    [switch]$Gpu,
    [switch]$Cpu,
    [switch]$Check,
    [switch]$DryRun,
    [ValidateRange(1, 8)][int]$Threads = 0,
    [string]$HermesHome = '',
    [string]$Python = ''
)
$ErrorActionPreference = 'Stop'
$setupScript = Join-Path $PSScriptRoot 'scripts/setup.py'
$setupArgs = @($setupScript)
if ($Gpu -and $Cpu) { throw 'Choose -Cpu or -Gpu, not both.' }
if ($Check -and $DryRun) { throw 'Choose -Check or -DryRun, not both.' }
if ($Gpu) { $setupArgs += '--gpu' }
if ($Cpu) { $setupArgs += '--cpu' }
if ($Check) { $setupArgs += '--check' }
if ($DryRun) { $setupArgs += '--dry-run' }
if ($Threads -gt 0) { $setupArgs += @('--threads', [string]$Threads) }
if ($HermesHome) { $setupArgs += @('--home', $HermesHome) }

# Prefer an explicitly selected interpreter, then Hermes' selected environment.
if ($HermesHome) { $runtimeHome = $HermesHome }
elseif ($env:HERMES_HOME) { $runtimeHome = $env:HERMES_HOME }
elseif ($env:LOCALAPPDATA) { $runtimeHome = Join-Path $env:LOCALAPPDATA 'hermes' }
else { $runtimeHome = Join-Path $env:USERPROFILE '.hermes' }
$runtimeHome = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($runtimeHome)
$pythonCandidates = @()
if ($Python) { $pythonCandidates += ,@($Python) }
else {
    $hermesPython = Join-Path $runtimeHome 'hermes-agent/.venv/Scripts/python.exe'
    if (Test-Path -LiteralPath $hermesPython -PathType Leaf) { $pythonCandidates += ,@($hermesPython) }
    $selected = @()
    $installs = Join-Path $runtimeHome 'installs'
    if (Test-Path -LiteralPath $installs -PathType Container) {
        foreach ($install in Get-ChildItem -LiteralPath $installs -Directory) {
            $factsPath = Join-Path $install.FullName 'facts.json'
            if (-not (Test-Path -LiteralPath $factsPath -PathType Leaf)) { continue }
            try {
                $facts = Get-Content -LiteralPath $factsPath -Raw -Encoding UTF8 | ConvertFrom-Json
                $environment = [string]$facts.packages.venv.environment
                if (-not $environment) { continue }
                $selectedPython = [IO.Path]::GetFullPath((Join-Path $environment 'Scripts/python.exe'))
                $allowedRoot = [IO.Path]::GetFullPath($installs).TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar
                if ($selectedPython.StartsWith($allowedRoot, [StringComparison]::OrdinalIgnoreCase) -and
                    (Test-Path -LiteralPath $selectedPython -PathType Leaf)) {
                    $selected += $selectedPython
                }
            }
            catch { continue }
        }
    }
    # Facts identify the selected environment. Never guess among historical venvs.
    $selected = @($selected | Select-Object -Unique)
    if ($selected.Count -eq 1) { $pythonCandidates += ,@($selected[0]) }
    if (Get-Command py -ErrorAction SilentlyContinue) { $pythonCandidates += ,@('py', '-3') }
    if (Get-Command python -ErrorAction SilentlyContinue) { $pythonCandidates += ,@('python') }
}
foreach ($candidate in $pythonCandidates) {
    $executable = $candidate[0]
    $prefix = @()
    if ($candidate.Count -gt 1) { $prefix = $candidate[1..($candidate.Count - 1)] }
    try {
        $probe = & $executable @prefix -c 'import sys; sys.exit(1) if sys.version_info < (3,10) else print(731903)' 2>$null
        if ($LASTEXITCODE -ne 0 -or [string]$probe -notmatch '^731903$') { continue }
    }
    catch { continue }
    & $executable @prefix @setupArgs
    exit $LASTEXITCODE
}
throw 'Python 3.10+ was not found. Run install.ps1 -Python "path/to/python.exe" with Hermes Python, or install Python from python.org.'
