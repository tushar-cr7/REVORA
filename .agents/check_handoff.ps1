$ErrorActionPreference = 'Stop'

$jsonPath = Join-Path $PSScriptRoot "..\.revora\git-handoff.json"
if (Test-Path $jsonPath) {
    $content = Get-Content $jsonPath -Raw
    if (-not [string]::IsNullOrWhiteSpace($content)) {
        try {
            $data = $content | ConvertFrom-Json
            if ($data.status -eq 'ready') {
                # Mark as notified immediately to avoid infinite loops
                $data.status = 'notified'
                $data | ConvertTo-Json | Set-Content $jsonPath

                # Get git diff and status from repo root
                Set-Location (Join-Path $PSScriptRoot "..")
                $diff = & git diff --stat 2>&1 | Out-String
                $status = & git status --short 2>&1 | Out-String
                
                # Format the message exactly as requested
                $msg = "Claude completed a major REVORA milestone:`n`n$($data.summary)`n`nI found these changes:`n$status`n`nDo you want me to review, commit, and push this to GitHub?"
                
                # Inject ephemeral message to prompt the agent
                $out = @{
                    injectSteps = @(
                        @{ ephemeralMessage = "The handoff file .revora/git-handoff.json indicates Claude completed a milestone. YOU MUST ASK THE USER EXACTLY:`n`n$msg`n`nWait for their YES/NO response before doing any git operations." }
                    )
                }
                
                # Convert to JSON with camelCase keys and Output
                # Note: PowerShell ConvertTo-Json preserves case of keys as defined in the hashtable
                $out | ConvertTo-Json -Depth 10 -Compress | Write-Output
                exit 0
            }
        } catch {
            # Ignore parsing errors and just output {}
        }
    }
}

Write-Output "{}"
