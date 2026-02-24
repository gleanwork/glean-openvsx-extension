#
# MDM install script for Windows.
# Installs the Glean MCP extension into Cursor and deploys the config file.
#
# Usage: install-windows.ps1 -GleanMcpUrl <url> [-ServerName <name>]
#
# This script is intended to be run by MDM (Intune, SCCM, etc.) with admin privileges.

param(
    [Parameter(Mandatory=$true)]
    [string]$GleanMcpUrl,

    [Parameter(Mandatory=$false)]
    [string]$ServerName = "glean"
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$VsixPath = Join-Path $ScriptDir "glean-mcp.vsix"
$ConfigDir = Join-Path $env:ProgramData "Glean"
$ConfigPath = Join-Path $ConfigDir "mcp-config.json"

# Deploy config file
if (-not (Test-Path $ConfigDir)) {
    New-Item -ItemType Directory -Path $ConfigDir -Force | Out-Null
}

$config = @{
    serverName = $ServerName
    url = $GleanMcpUrl
} | ConvertTo-Json -Depth 2

Set-Content -Path $ConfigPath -Value $config -Encoding UTF8
Write-Host "Config written to $ConfigPath"

# Install extension if Cursor CLI is available and .vsix exists
if (-not (Test-Path $VsixPath)) {
    Write-Warning "$VsixPath not found. Skipping extension install."
    exit 0
}

$cursorCmd = Get-Command cursor -ErrorAction SilentlyContinue
if ($cursorCmd) {
    & cursor --install-extension $VsixPath
    Write-Host "Extension installed successfully."
} else {
    Write-Warning "'cursor' CLI not found. Skipping extension install."
    Write-Host "The extension can be installed manually: cursor --install-extension $VsixPath"
}
