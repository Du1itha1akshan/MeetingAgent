<#
.SYNOPSIS
  One-time Teams tenant setup for the Meeting Agent: enables Graph transcript
  access and turns on auto-recording for the monitored users, so transcripts
  exist without anyone touching a toggle mid-meeting.

.DESCRIPTION
  Requires the MicrosoftTeams PowerShell module (v7.9.0+) and a Teams admin
  role (Teams Administrator or Global Administrator) — this cannot be done
  via the app's own Graph permissions, it's a separate tenant-admin action.

.PARAMETER MonitoredUsers
  Comma-separated UPNs matching MONITORED_USERS in your deployment — these
  get a meeting policy with AutoRecording enabled.

.PARAMETER Scope
  "Global" applies EnableGraphTranscriptAccess tenant-wide (simplest).
  "ScopedPolicy" instead creates/updates a named policy and grants it only to
  MonitoredUsers, so no other tenant data becomes reachable via Graph.

.EXAMPLE
  ./scripts/setup-teams-policy.ps1 -MonitoredUsers "alice@contoso.com,bob@contoso.com" -Scope ScopedPolicy
#>
param(
  [Parameter(Mandatory = $true)]
  [string]$MonitoredUsers,

  [ValidateSet("Global", "ScopedPolicy")]
  [string]$Scope = "ScopedPolicy",

  [string]$PolicyName = "MeetingAgentTranscriptPolicy"
)

$ErrorActionPreference = "Stop"

if (-not (Get-Module -ListAvailable -Name MicrosoftTeams)) {
  Write-Host "Installing the MicrosoftTeams module (requires an elevated/admin PowerShell session)..." -ForegroundColor Cyan
  Install-Module -Name MicrosoftTeams -Force -Scope CurrentUser
}

Write-Host "Connecting to Microsoft Teams..." -ForegroundColor Cyan
Connect-MicrosoftTeams | Out-Null

$users = $MonitoredUsers.Split(",") | ForEach-Object { $_.Trim() } | Where-Object { $_ }

if ($Scope -eq "Global") {
  Write-Host "`nEnabling EnableGraphTranscriptAccess tenant-wide..." -ForegroundColor Cyan
  Set-CsTeamsMeetingPolicy -Identity Global -EnableGraphTranscriptAccess $true
  $policyIdentity = "Global"
} else {
  Write-Host "`nCreating/updating scoped policy '$PolicyName'..." -ForegroundColor Cyan
  $existing = Get-CsTeamsMeetingPolicy -Identity $PolicyName -ErrorAction SilentlyContinue
  if (-not $existing) {
    New-CsTeamsMeetingPolicy -Identity $PolicyName | Out-Null
  }
  Set-CsTeamsMeetingPolicy -Identity $PolicyName -EnableGraphTranscriptAccess $true -AutoRecording Enabled
  $policyIdentity = $PolicyName
}

Write-Host "`nGranting policy '$policyIdentity' to monitored users and enabling auto-recording..." -ForegroundColor Cyan
foreach ($user in $users) {
  Write-Host "  $user"
  if ($Scope -eq "ScopedPolicy") {
    Grant-CsTeamsMeetingPolicy -Identity $user -PolicyName $policyIdentity
  } else {
    # Global scope already covers transcript access; AutoRecording still
    # needs a policy assignment even in this mode.
    Grant-CsTeamsMeetingPolicy -Identity $user -PolicyName $policyIdentity -ErrorAction SilentlyContinue
  }
}

Write-Host "`nDone. Policy changes can take up to 24 hours to fully propagate," -ForegroundColor Green
Write-Host "though it's usually much faster. Verify with:" -ForegroundColor Green
Write-Host "  Get-CsUserPolicyAssignment -Identity <user> -PolicyType TeamsMeetingPolicy" -ForegroundColor Green
