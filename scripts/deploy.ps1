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
    -MonitoredUsers "alice@contoso.com"
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
  [Parameter(Mandatory = $true)] [string]$GithubAppPrivateKeyPath
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot

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

  Write-Host "`nDeploying infra/main.bicep..." -ForegroundColor Cyan
  $deployResult = az deployment group create `
    --resource-group $ResourceGroup `
    --template-file "infra/main.bicep" `
    --parameters "infra/main.parameters.json" `
    --parameters baseName=$BaseName `
                 azureTenantId=$AzureTenantId `
                 azureClientId=$AzureClientId `
                 azureClientSecret=$AzureClientSecret `
                 graphClientState=$GraphClientState `
                 anthropicApiKey=$AnthropicApiKey `
                 monitoredUsers=$MonitoredUsers `
                 githubOwner=$GithubOwner `
                 githubRepo=$GithubRepo `
                 githubBranch=$GithubBranch `
                 githubAppId=$GithubAppId `
                 githubAppInstallationId=$GithubAppInstallationId `
                 githubAppPrivateKey=$githubAppPrivateKey `
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
  Pop-Location
}
