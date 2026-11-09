<#
.SYNOPSIS
  Creates the meeting details Static Web App and the storage container it reads
  meetings from, from infra/staticwebapp.bicep.

.DESCRIPTION
  Deploys, in Incremental mode so nothing else in the resource group is changed or
  removed:
    - the Static Web App (Free plan)
    - the "meetings" container in the existing storage account
    - the app settings the site's API needs: the link secret and a read-only SAS

  Then checks that the Logic App's managed identity can write to the container.
  Granting that role needs Owner or User Access Administrator, so if it's missing the
  script prints the command for someone with that access to run.

  The read-only SAS expires after a year; run this again before then to renew it.
  Running it again also re-applies the template, so settings changed in the portal
  since (such as the hosting plan) go back to what the template says.

  The app has no content until it's deployed with the Static Web Apps CLI using the
  app's deployment token.

.EXAMPLE
  ./scripts/deploy-staticwebapp.ps1
#>
param(
  [string]$ResourceGroup = "dev-jrc-meeting-agent-rg-aue",
  [string]$Name = "meetingagent-web",
  [string]$Location = "eastasia",
  [string]$KeyVaultName = "meetingagent-kv",
  [string]$LogicAppName = "meetingagent-logic-app"
)

$ErrorActionPreference = "Stop"
$template = Join-Path (Split-Path -Parent $PSScriptRoot) "infra/staticwebapp.bicep"

# The API checks each link's hash with the same secret the Logic App hashes with.
$meetingLinkSecret = az keyvault secret show --vault-name $KeyVaultName --name meeting-link-secret --query value -o tsv
if ($LASTEXITCODE -ne 0 -or -not $meetingLinkSecret) {
  throw "Couldn't read secret meeting-link-secret from Key Vault '$KeyVaultName'."
}

# The secret reaches az in a temporary parameters file rather than on the command line,
# written to the user's temp folder and deleted in the finally block.
$paramsFile = Join-Path ([IO.Path]::GetTempPath()) ("meetingagent-web-" + [guid]::NewGuid().ToString("N") + ".json")
try {
  $params = @{
    '$schema'      = "https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#"
    contentVersion = "1.0.0.0"
    parameters     = @{ meetingLinkSecret = @{ value = $meetingLinkSecret } }
  }
  # UTF-8 without a byte-order mark (Windows PowerShell's -Encoding UTF8 would add one).
  [IO.File]::WriteAllText($paramsFile, ($params | ConvertTo-Json -Depth 5), (New-Object Text.UTF8Encoding $false))

  Write-Host "Deploying Static Web App '$Name' to '$ResourceGroup' ($Location)..." -ForegroundColor Cyan
  $result = az deployment group create `
    --resource-group $ResourceGroup `
    --mode Incremental `
    --template-file $template `
    --parameters "@$paramsFile" `
    --parameters name=$Name location=$Location `
    --query properties.outputs -o json
  # $ErrorActionPreference only catches terminating PowerShell errors, not az's exit code.
  if ($LASTEXITCODE -ne 0) {
    throw "az deployment group create failed with exit code $LASTEXITCODE"
  }
} finally {
  if (Test-Path $paramsFile) { Remove-Item $paramsFile -Force }
}

$outputs = $result | Out-String | ConvertFrom-Json
$hostname = $outputs.defaultHostname.value
$containerId = $outputs.meetingsContainerId.value

# The Logic App saves meetings with its managed identity, which needs this role on the
# container (or above it, which --include-inherited also finds).
$role = "Storage Blob Data Contributor"
$principalId = az resource show --resource-group $ResourceGroup --name $LogicAppName --resource-type Microsoft.Logic/workflows --query identity.principalId -o tsv
if ($LASTEXITCODE -ne 0 -or -not $principalId) {
  throw "Couldn't read the managed identity of Logic App '$LogicAppName'."
}
$granted = az role assignment list --scope $containerId --include-inherited --query "[?principalId=='$principalId' && roleDefinitionName=='$role'] | length(@)" -o tsv
if ($LASTEXITCODE -ne 0) {
  throw "az role assignment list failed with exit code $LASTEXITCODE"
}

Write-Host "`n===== Deployed =====" -ForegroundColor Green
Write-Host "Static Web App: $Name"
Write-Host "URL:            https://$hostname"
Write-Host "SAS expiry:     $($outputs.sasExpiry.value)  (run this script again before then)"
Write-Host "`nSet the Logic App parameter view_details_base_url to: https://$hostname/meeting/"
Write-Host "Deployment token (for the Static Web Apps CLI): Azure portal > $Name > Overview > Manage deployment token"

if ([int]$granted -gt 0) {
  Write-Host "`nThe Logic App's managed identity can write to the meetings container." -ForegroundColor Green
} else {
  Write-Host "`nThe Logic App can't save meetings yet: its managed identity needs '$role' on the container." -ForegroundColor Yellow
  Write-Host "Ask someone with Owner or User Access Administrator on '$ResourceGroup' to run:"
  Write-Host "  az role assignment create --assignee-object-id $principalId --assignee-principal-type ServicePrincipal --role `"$role`" --scope $containerId"
}
