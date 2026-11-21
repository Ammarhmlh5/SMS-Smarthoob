param(
  [string]$Migration = "supabase/migrations/20261110145500_add_default_gateway_connection.sql"
)

$ErrorActionPreference = "Stop"

$projectRef = $env:SUPABASE_PROJECT_REF
$accessToken = $env:SUPABASE_ACCESS_TOKEN

if (-not $projectRef) {
  throw "SUPABASE_PROJECT_REF is not configured."
}
if (-not $accessToken) {
  throw "SUPABASE_ACCESS_TOKEN is not configured."
}

$resolvedMigration = Join-Path (Resolve-Path ".").Path $Migration
if (-not (Test-Path -LiteralPath $resolvedMigration)) {
  throw "Migration file was not found: $Migration"
}

$query = [System.IO.File]::ReadAllText($resolvedMigration)
$uri = "https://api.supabase.com/v1/projects/$projectRef/database/query"
$response = Invoke-RestMethod -Uri $uri -Method Post -Headers @{
  Authorization = "Bearer $accessToken"
  "Content-Type" = "application/json"
} -Body (@{ query = $query } | ConvertTo-Json -Depth 3)

Write-Output "Migration applied successfully: $Migration"
