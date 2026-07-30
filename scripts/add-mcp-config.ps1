param(
    [string]$ConfigPath,
    [string]$ApiKey
)

# Add MCP vision-skills config to an existing opencode.json
$json = Get-Content $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json

if ($json.mcp -eq $null) {
    $json | Add-Member -Name "mcp" -Value @{} -MemberType NoteProperty
}

$json.mcp | Add-Member -Name "vision-skills" -Value @{
    type = "local"
    command = @("npx", "vision-skills-mcp")
    enabled = $true
    env = @{ GEMINI_API_KEYS = $ApiKey }
} -Force

$json | ConvertTo-Json -Depth 10 | Set-Content $ConfigPath -Encoding UTF8
Write-Host "+ MCP vision-skills config added to $ConfigPath"
