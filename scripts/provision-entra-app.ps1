<#
.SYNOPSIS
  One-time Entra ID setup for the Meeting Agent: creates the app registration,
  adds the three required Graph application permissions, and (if you're a
  Global Admin / Privileged Role Admin) grants admin consent — all in one
  command instead of clicking through the Azure Portal.

.DESCRIPTION
  Requires Azure CLI (az) logged in as a user who can create app
  registrations. Admin consent additionally requires Global Administrator or
  Privileged Role Administrator — if the caller doesn't have that role, the
  script still creates everything else and prints the one remaining manual
  step (an admin clicking "Grant admin consent" for this app, once).

.PARAMETER DisplayName
  Name for the app registration as it appears in Entra ID.

.PARAMETER KeyVaultName
  If provided, writes the generated client secret and clientState directly
  into this Key Vault instead of just printing them to the console.

.EXAMPLE
  ./scripts/provision-entra-app.ps1 -DisplayName "Meeting Agent" -KeyVaultName "meetingagent-kv"
#>
param(
  [string]$DisplayName = "Meeting Agent",
  [string]$KeyVaultName
)

$ErrorActionPreference = "Stop"
$GRAPH_APP_ID = "00000003-0000-0000-c000-000000000000"
$RequiredPermissions = @("Calendars.Read", "OnlineMeetings.Read.All", "OnlineMeetingTranscript.Read.All")

Write-Host "Checking Azure CLI session..." -ForegroundColor Cyan
$account = az account show 2>$null | ConvertFrom-Json
if (-not $account) {
  Write-Host "Not logged in. Run 'az login' first." -ForegroundColor Red
  exit 1
}
Write-Host "Logged in as $($account.user.name) (tenant $($account.tenantId))"

Write-Host "`nResolving Microsoft Graph application permission IDs..." -ForegroundColor Cyan
$graphSpId = az ad sp show --id $GRAPH_APP_ID --query id -o tsv
$permissionIds = @{}
foreach ($perm in $RequiredPermissions) {
  $id = az ad sp show --id $GRAPH_APP_ID --query "appRoles[?value=='$perm'].id | [0]" -o tsv
  if (-not $id) { throw "Could not resolve Graph app role for permission '$perm' — has it been renamed?" }
  $permissionIds[$perm] = $id
  Write-Host "  $perm -> $id"
}

Write-Host "`nCreating app registration '$DisplayName'..." -ForegroundColor Cyan
$existingAppId = az ad app list --display-name $DisplayName --query "[0].appId" -o tsv
if ($existingAppId) {
  Write-Host "  App '$DisplayName' already exists (appId $existingAppId) — reusing it."
  $appId = $existingAppId
} else {
  $appId = az ad app create --display-name $DisplayName --sign-in-audience AzureADMyOrg --query appId -o tsv
  Write-Host "  Created app, appId $appId"
}

Write-Host "`nGranting API permissions..." -ForegroundColor Cyan
$apiPermissionArgs = ($permissionIds.Values | ForEach-Object { "$_=Role" }) -join " "
az ad app permission add --id $appId --api $GRAPH_APP_ID --api-permissions $apiPermissionArgs | Out-Null
Write-Host "  Added: $($RequiredPermissions -join ', ')"

Write-Host "`nEnsuring a service principal exists for the app..." -ForegroundColor Cyan
$spExists = az ad sp show --id $appId 2>$null
if (-not $spExists) {
  az ad sp create --id $appId | Out-Null
  Write-Host "  Service principal created."
} else {
  Write-Host "  Service principal already exists."
}

Write-Host "`nAttempting admin consent (requires Global Admin / Privileged Role Admin)..." -ForegroundColor Cyan
$consentFailed = $false
try {
  az ad app permission admin-consent --id $appId 2>$null
  Write-Host "  Admin consent granted." -ForegroundColor Green
} catch {
  $consentFailed = $true
}
if ($consentFailed) {
  Write-Host "  Could not grant consent automatically (you likely aren't a Global Admin from this session)." -ForegroundColor Yellow
  Write-Host "  Ask a Global Admin to run this one command, or click 'Grant admin consent' for '$DisplayName' in:" -ForegroundColor Yellow
  Write-Host "    Entra ID > App registrations > $DisplayName > API permissions" -ForegroundColor Yellow
  Write-Host "  Command they can run instead: az ad app permission admin-consent --id $appId" -ForegroundColor Yellow
}

Write-Host "`nCreating a client secret..." -ForegroundColor Cyan
$secretJson = az ad app credential reset --id $appId --append --display-name "meeting-agent-$(Get-Date -Format yyyyMMdd)" --years 2 -o json | ConvertFrom-Json
$clientSecret = $secretJson.password
Write-Host "  Secret created, expires in 2 years — put a reminder on the calendar to rotate it." -ForegroundColor Yellow

$clientState = -join ((48..57) + (97..122) | Get-Random -Count 40 | ForEach-Object { [char]$_ })

Write-Host "`n===== Results =====" -ForegroundColor Green
Write-Host "AZURE_TENANT_ID   = $($account.tenantId)"
Write-Host "AZURE_CLIENT_ID   = $appId"
Write-Host "AZURE_CLIENT_SECRET = $clientSecret"
Write-Host "GRAPH_CLIENT_STATE  = $clientState"

if ($KeyVaultName) {
  Write-Host "`nWriting secrets to Key Vault '$KeyVaultName'..." -ForegroundColor Cyan
  az keyvault secret set --vault-name $KeyVaultName --name "azure-client-secret" --value $clientSecret | Out-Null
  az keyvault secret set --vault-name $KeyVaultName --name "graph-client-state" --value $clientState | Out-Null
  Write-Host "  Done. AZURE_TENANT_ID and AZURE_CLIENT_ID still need to be passed as plain deploy parameters (see scripts/deploy.ps1)."
} else {
  Write-Host "`nNo -KeyVaultName given — copy the values above into local.settings.json for local testing," -ForegroundColor Yellow
  Write-Host "or re-run with -KeyVaultName once the Key Vault from infra/main.bicep exists." -ForegroundColor Yellow
}

if ($consentFailed) {
  Write-Host "`nREMINDER: admin consent is still pending — nothing will work until that's granted." -ForegroundColor Red
}
