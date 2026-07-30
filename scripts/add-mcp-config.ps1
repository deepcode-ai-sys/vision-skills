param(
    [string]$ConfigPath,
    [string]$ApiKey
)

# Add MCP vision-skills config to opencode.json
$json = Get-Content $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json

if ($null -eq $json.mcp) {
    $json | Add-Member -Name "mcp" -Value @{} -MemberType NoteProperty
}

# Create the vision-skills MCP entry
$visionSkill = [PSCustomObject]@{
    type = "local"
    command = @("npx", "vision-skills-mcp")
    enabled = $true
    env = @{ GEMINI_API_KEYS = $ApiKey }
}

# Add it to the mcp section (handles both empty and existing mcp objects)
$mcp = $json.mcp
$mcp | Add-Member -Name "vision-skills" -Value $visionSkill -MemberType NoteProperty -Force

$json | ConvertTo-Json -Depth 10 | Set-Content $ConfigPath -Encoding UTF8
Write-Host "+ MCP vision-skills added to $ConfigPath"
