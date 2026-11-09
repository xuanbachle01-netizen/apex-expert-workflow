# Starts the n8n of this folder with the settings the tool Code nodes need, as its own instance:
#   port      from N8N_BASE_URL in .env (default 5692); the task runner broker uses the next port
#   data      N8N_USER_FOLDER in .env (default ~\.n8n-apex-expert-workflow): its own database,
#             owner account, credentials and workflows, apart from every other n8n on this machine
# Usage: powershell -ExecutionPolicy Bypass -File scripts\start-n8n.ps1
$root = Split-Path -Parent $PSScriptRoot
$vars = @{}
$envFile = Join-Path $root '.env'
if (Test-Path $envFile) {
  foreach ($line in Get-Content $envFile) {
    if ($line -match '^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$') { $vars[$Matches[1]] = $Matches[2].Trim('"', "'") }
  }
}
$port = 5692
if ($vars['N8N_BASE_URL'] -match ':(\d+)') { $port = [int]$Matches[1] }
$folder = $vars['N8N_USER_FOLDER']
if (-not $folder) { $folder = Join-Path $HOME '.n8n-apex-expert-workflow' }

$env:N8N_PORT = "$port"
$env:N8N_RUNNERS_BROKER_PORT = "$($port + 1)"
$env:N8N_USER_FOLDER = $folder
$env:NODE_FUNCTION_ALLOW_BUILTIN = 'fs,path,child_process'
$env:N8N_RUNNERS_TASK_TIMEOUT = '300'
Write-Host "n8n on http://localhost:$port (task broker $($port + 1)), data in $folder\.n8n"
Set-Location $root
n8n start
