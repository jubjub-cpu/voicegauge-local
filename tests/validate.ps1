param([string]$NodePath = "")

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$failures = New-Object System.Collections.Generic.List[string]
$required = @(
  "index.html", "assets/styles.css", "assets/app.js", "assets/audio-engine.mjs",
  "data/fixtures.json", "data/audio/clear-brief.wav", "data/audio/clipped-brief.wav",
  "data/audio/noisy-brief.wav", "data/audio/pause-heavy.wav", "tools/generate-fixtures.mjs",
  "tests/audio-engine.test.mjs", "tests/browser-smoke.mjs", "tests/validate.ps1",
  "tools/static-server.mjs", "tools/static-server.ps1", "README.md", "docs/ARCHITECTURE.md",
  "docs/CASE_STUDY.md", "docs/RELEASE_NOTES.md", "docs/VALIDATION.md",
  "docs/screenshots/voicegauge-local-desktop.png", "docs/screenshots/voicegauge-local-mobile.png",
  "package.json", "LICENSE", ".gitignore", ".env.example", ".nojekyll"
)
foreach ($file in $required) { if (-not (Test-Path -LiteralPath (Join-Path $root $file))) { $failures.Add("Missing required file: $file") } }

try {
  $manifest = Get-Content -Raw -LiteralPath (Join-Path $root "data/fixtures.json") | ConvertFrom-Json
  if ($manifest.fixtures.Count -ne 4) { $failures.Add("Exactly four generated fixtures are required.") }
  if (($manifest.fixtures.expectedFinding | Sort-Object -Unique).Count -ne 4) { $failures.Add("Fixture outcomes must cover ready, clipping, noise, and silence.") }
  if ($manifest.notice -notmatch "no human speech") { $failures.Add("Generated-audio disclosure missing.") }
} catch { $failures.Add("Fixture manifest is invalid JSON.") }

foreach ($name in @("clear-brief.wav", "clipped-brief.wav", "noisy-brief.wav", "pause-heavy.wav")) {
  $path = Join-Path $root "data/audio/$name"
  if (Test-Path -LiteralPath $path) {
    $bytes = [IO.File]::ReadAllBytes($path)
    if ($bytes.Length -lt 100000) { $failures.Add("Audio fixture is unexpectedly small: $name") }
    if ([Text.Encoding]::ASCII.GetString($bytes, 0, 4) -ne "RIFF" -or [Text.Encoding]::ASCII.GetString($bytes, 8, 4) -ne "WAVE") { $failures.Add("Audio fixture is not RIFF/WAVE: $name") }
  }
}

$html = Get-Content -Raw -LiteralPath (Join-Path $root "index.html")
foreach ($hook in @('<meta name="viewport"', 'class="skip-link"', 'id="workspace"', 'aria-live=', 'type="module"')) { if ($html -notmatch [Regex]::Escape($hook)) { $failures.Add("index.html missing $hook") } }

$files = Get-ChildItem -LiteralPath $root -Recurse -File | Where-Object { $_.FullName -notmatch "\\.git\\" -and $_.FullName -ne $MyInvocation.MyCommand.Path -and $_.Extension -in @(".html", ".css", ".js", ".mjs", ".json", ".md", ".txt", ".example") }
$text = ($files | ForEach-Object { Get-Content -Raw -LiteralPath $_.FullName }) -join "`n"
foreach ($pattern in @("(?i)gmail\.com", "sk-[A-Za-z0-9]{20,}", "gh[opsu]_[A-Za-z0-9]{20,}", "BEGIN (RSA|OPENSSH) PRIVATE KEY")) { if ($text -match $pattern) { $failures.Add("Potential private information or secret found: $pattern") } }
foreach ($phrase in @("synthetic", "Web Audio", "No upload", "transcription", "human", "biometric")) { if ($text -notmatch [Regex]::Escape($phrase)) { $failures.Add("Disclosure phrase missing: $phrase") } }

if (-not $NodePath) { $node = Get-Command node -ErrorAction SilentlyContinue; if ($node) { $NodePath = $node.Source } }
if (-not $NodePath -or -not (Test-Path -LiteralPath $NodePath)) { $failures.Add("Node.js not found; pass -NodePath.") } else { & $NodePath (Join-Path $root "tests/audio-engine.test.mjs"); if ($LASTEXITCODE -ne 0) { $failures.Add("Audio engine tests failed.") } }

if ($failures.Count) { Write-Host "VOICEGAUGE VALIDATION FAILED"; foreach ($failure in $failures) { Write-Host "- $failure" }; exit 1 }
Write-Host "VOICEGAUGE VALIDATION PASSED"
Write-Host "Checked files, generated audio headers, fixture coverage, disclosures, privacy patterns, accessibility hooks, and PCM analysis logic."
