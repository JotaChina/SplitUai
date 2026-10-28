$ErrorActionPreference = 'Continue'

$output = & npx --no-install supabase status --output json 2>&1 | ForEach-Object { $_.ToString() }
$statusExitCode = $LASTEXITCODE
$raw = $output -join [Environment]::NewLine
$jsonMatch = [regex]::Match($raw, '(?s)\{.*\}')
if ($statusExitCode -ne 0 -or -not $jsonMatch.Success) {
  exit 1
}

$status = ConvertFrom-Json $jsonMatch.Value
if ([string]::IsNullOrWhiteSpace($status.PUBLISHABLE_KEY)) {
  exit 1
}

[Console]::Out.Write($status.PUBLISHABLE_KEY)
