$ErrorActionPreference = 'Stop'

$output = & npx --no-install supabase status --output json 2>$null
$raw = $output -join [Environment]::NewLine
$jsonMatch = [regex]::Match($raw, '(?s)\{.*\}')
if (-not $jsonMatch.Success) {
  exit 1
}

$status = ConvertFrom-Json $jsonMatch.Value
if ([string]::IsNullOrWhiteSpace($status.PUBLISHABLE_KEY)) {
  exit 1
}

[Console]::Out.Write($status.PUBLISHABLE_KEY)
