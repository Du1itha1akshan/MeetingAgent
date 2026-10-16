<#
.SYNOPSIS
  Provisions the Azure infra (infra/main.bicep) and publishes the compiled
  Function App code, in one command.

.DESCRIPTION
  Run this after:
    1. scripts/provision-entra-app.ps1   (Entra ID app + secret)
    2. scripts/setup-teams-policy.ps1    (tenant transcript policy)
    3. Creating a GitHub App and noting its App ID, private key (.pem), and
       installation ID for the target repo — see docs/SETUP.md, "GitHub App
       setup" (this one step still has to be done by hand once, in the
       GitHub UI; there's no API for creating an App itself).

.EXAMPLE
  ./scripts/deploy.ps1 `
    -ResourceGroup "meeting-agent-rg" `
    -BaseName "meetingagent" `
    -AzureTenantId "<tenant-id>" `
    -AzureClientId "<app-id>" `
    -AzureClientSecret "<client-secret>" `
    -GraphClientState "<graph-client-state>" `
    -AnthropicApiKey "<anthropic-api-key>" `
    -GithubOwner "your-org" -GithubRepo "meeting-notes" `
    -GithubAppId "123456" -GithubAppInstallationId "987654" `
    -GithubAppPrivateKeyPath "./github-app-key.pem" `
    -MonitoredUsers "alice@contoso.com" `
    -AssistantUsername "assistant@contoso.com" -GreetingEnabled $true

  The last four parameters are optional. Each deployment sets these app settings
  explicitly (overriding infra/main.parameters.json); anything left out is off/empty:
    -AssistantUsername           ASSISTANT_USERNAME (passed here so it never has to be committed)
    -GreetingEnabled             GREETING_ENABLED
    -StartTranscriptionOnYes     START_TRANSCRIPTION_ON_YES
    -CreateIssuesForActionItems  CREATE_ISSUES_FOR_ACTION_ITEMS

  -CreateKeyVaultRoleAssignment $false: use when redeploying an environment whose
  Function App identity already has "Key Vault Secrets User" on the vault from an
  assignment made outside this template (otherwise the deployment fails with
  RoleAssignmentExists). Defaults to $true for new environments.
#>
param(
  [Parameter(Mandatory = $true)] [string]$ResourceGroup,
  [Parameter(Mandatory = $true)] [string]$BaseName,
  [string]$Location = "eastus",

  [Parameter(Mandatory = $true)] [string]$AzureTenantId,
  [Parameter(Mandatory = $true)] [string]$AzureClientId,
  [Parameter(Mandatory = $true)] [string]$AzureClientSecret,
  [Parameter(Mandatory = $true)] [string]$GraphClientState,
  [Parameter(Mandatory = $true)] [string]$AnthropicApiKey,

  [Parameter(Mandatory = $true)] [string]$MonitoredUsers,

  [Parameter(Mandatory = $true)] [string]$GithubOwner,
  [Parameter(Mandatory = $true)] [string]$GithubRepo,
  [string]$GithubBranch = "main",
  [Parameter(Mandatory = $true)] [string]$GithubAppId,
  [Parameter(Mandatory = $true)] [string]$GithubAppInstallationId,
  [Parameter(Mandatory = $true)] [string]$GithubAppPrivateKeyPath,

  [string]$AssistantUsername = "",
  [bool]$GreetingEnabled = $false,
  [bool]$StartTranscriptionOnYes = $false,
  [bool]$CreateIssuesForActionItems = $false,

  # $false when the Function App's identity already has "Key Vault Secrets User" on the
  # vault from an assignment made outside this template (see infra/main.bicep).
  [bool]$CreateKeyVaultRoleAssignment = $true
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot

# The secrets are plain-text parameters. A SecureString (e.g. `Read-Host -AsSecureString`)
# arrives here as the literal text "System.Security.SecureString", which would be written
# into Key Vault and break the app, so stop before anything is deployed.
foreach ($name in 'AzureClientSecret', 'GraphClientState', 'AnthropicApiKey') {
  if ((Get-Variable $name -ValueOnly) -eq 'System.Security.SecureString') {
    throw "-$name received a SecureString, which arrives as the text 'System.Security.SecureString'. " +
      "Pass the secret as plain text, e.g. (az keyvault secret show --vault-name <vault> --name <secret> --query value -o tsv)."
  }
}

# $ErrorActionPreference only catches terminating PowerShell errors, not the
# exit code of native executables (npm, az, func) - without this check a
# failed build or deployment would silently fall through to the "Deployed"
# banner at the bottom.
function Assert-LastExitCode($step) {
  if ($LASTEXITCODE -ne 0) {
    throw "$step failed with exit code $LASTEXITCODE"
  }
}

Write-Host "Building the Functions app..." -ForegroundColor Cyan
$secretParamsFile = $null
Push-Location $repoRoot
try {
  npm install
  Assert-LastExitCode "npm install"
  npm run build
  Assert-LastExitCode "npm run build"

  $existingGroup = az group show --name $ResourceGroup -o json 2>$null | ConvertFrom-Json
  if ($existingGroup) {
    if ($existingGroup.location -ne $Location) {
      Write-Host "`nResource group '$ResourceGroup' already exists in '$($existingGroup.location)'; using that instead of -Location '$Location'." -ForegroundColor Yellow
      $Location = $existingGroup.location
    }
  } else {
    Write-Host "`nCreating resource group '$ResourceGroup' in '$Location'..." -ForegroundColor Cyan
    az group create --name $ResourceGroup --location $Location | Out-Null
    Assert-LastExitCode "az group create"
  }

  $githubAppPrivateKey = Get-Content -Raw -Path $GithubAppPrivateKeyPath
  if ($githubAppPrivateKey -notmatch '-----BEGIN [A-Z ]*PRIVATE KEY-----' -or
      $githubAppPrivateKey -notmatch '-----END [A-Z ]*PRIVATE KEY-----') {
    throw "$GithubAppPrivateKeyPath doesn't look like a PEM private key (no BEGIN/END PRIVATE KEY lines)."
  }

  # The secrets reach az in a temporary parameters file, not on the command line. On
  # Windows az is az.cmd, and an argument is cut off at its first line break: passed
  # as an argument, the GitHub key was stored as just "-----BEGIN PRIVATE KEY-----".
  # The file is written to the user's own temp folder and deleted in the finally block.
  $secretParamsFile = Join-Path ([IO.Path]::GetTempPath()) ("meetingagent-secrets-" + [guid]::NewGuid().ToString("N") + ".json")
  $secretParams = @{
    '$schema'      = "https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#"
    contentVersion = "1.0.0.0"
    parameters     = @{
      azureClientSecret   = @{ value = $AzureClientSecret }
      graphClientState    = @{ value = $GraphClientState }
      anthropicApiKey     = @{ value = $AnthropicApiKey }
      githubAppPrivateKey = @{ value = $githubAppPrivateKey }
    }
  }
  # UTF-8 without a byte-order mark (Windows PowerShell's -Encoding UTF8 would add one).
  [IO.File]::WriteAllText($secretParamsFile, ($secretParams | ConvertTo-Json -Depth 5), (New-Object Text.UTF8Encoding $false))

  Write-Host "`nDeploying infra/main.bicep..." -ForegroundColor Cyan
  $deployResult = az deployment group create `
    --resource-group $ResourceGroup `
    --template-file "infra/main.bicep" `
    --parameters "infra/main.parameters.json" `
    --parameters "@$secretParamsFile" `
    --parameters baseName=$BaseName `
                 azureTenantId=$AzureTenantId `
                 azureClientId=$AzureClientId `
                 monitoredUsers=$MonitoredUsers `
                 githubOwner=$GithubOwner `
                 githubRepo=$GithubRepo `
                 githubBranch=$GithubBranch `
                 githubAppId=$GithubAppId `
                 githubAppInstallationId=$GithubAppInstallationId `
                 assistantUsername=$AssistantUsername `
                 greetingEnabled=$($GreetingEnabled.ToString().ToLower()) `
                 startTranscriptionOnYes=$($StartTranscriptionOnYes.ToString().ToLower()) `
                 createIssuesForActionItems=$($CreateIssuesForActionItems.ToString().ToLower()) `
                 createKeyVaultRoleAssignment=$($CreateKeyVaultRoleAssignment.ToString().ToLower()) `
    -o json | ConvertFrom-Json
  Assert-LastExitCode "az deployment group create"

  $functionAppName = $deployResult.properties.outputs.functionAppName.value
  $notificationUrl = $deployResult.properties.outputs.notificationUrl.value

  # `func azure functionapp publish` reads local.settings.json just to detect
  # the project's worker runtime/language (it isn't uploaded - we don't pass
  # -i/--publish-local-settings, so this never leaks into Azure app settings,
  # which are set directly by the bicep deployment above).
  if (-not (Test-Path "local.settings.json")) {
    Write-Host "`nNo local.settings.json found; writing a minimal one so func can detect the runtime..." -ForegroundColor Yellow
    @{
      IsEncrypted = $false
      Values      = @{
        AzureWebJobsStorage       = "UseDevelopmentStorage=true"
        FUNCTIONS_WORKER_RUNTIME  = "node"
      }
    } | ConvertTo-Json | Set-Content -Path "local.settings.json" -Encoding utf8
  }

  Write-Host "`nPublishing code to $functionAppName..." -ForegroundColor Cyan
  func azure functionapp publish $functionAppName
  Assert-LastExitCode "func azure functionapp publish"

  Write-Host "`n===== Deployed =====" -ForegroundColor Green
  Write-Host "Function App: $functionAppName"
  Write-Host "Webhook URL:  $notificationUrl"
  Write-Host "`nThe pollTimer function runs every 5 minutes and will create the Graph"
  Write-Host "subscription on its first run - no separate 'start' step needed."
} finally {
  if ($secretParamsFile -and (Test-Path $secretParamsFile)) { Remove-Item $secretParamsFile -Force }
  Pop-Location
}
