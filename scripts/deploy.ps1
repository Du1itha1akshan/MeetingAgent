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
    -AzureClientSecret (Read-Host -AsSecureString "Client secret") `
    -GraphClientState (Read-Host -AsSecureString "Graph clientState") `
    -AnthropicApiKey (Read-Host -AsSecureString "Anthropic API key") `
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
  [Parameter(Mandatory = $true)] [securestring]$AzureClientSecret,
  [Parameter(Mandatory = $true)] [securestring]$GraphClientState,
  [Parameter(Mandatory = $true)] [securestring]$AnthropicApiKey,

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

function ConvertFrom-SecureStringPlain($secure) {
  [Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  )
}

Write-Host "Building the Functions app..." -ForegroundColor Cyan
Push-Location $repoRoot
try {
  npm install
  npm run build

  Write-Host "`nEnsuring resource group '$ResourceGroup' exists..." -ForegroundColor Cyan
  az group create --name $ResourceGroup --location $Location | Out-Null

  $githubAppPrivateKey = Get-Content -Raw -Path $GithubAppPrivateKeyPath

  Write-Host "`nDeploying infra/main.bicep..." -ForegroundColor Cyan
  $deployResult = az deployment group create `
    --resource-group $ResourceGroup `
    --template-file "infra/main.bicep" `
    --parameters "infra/main.parameters.json" `
    --parameters baseName=$BaseName `
                 azureTenantId=$AzureTenantId `
                 azureClientId=$AzureClientId `
                 azureClientSecret=(ConvertFrom-SecureStringPlain $AzureClientSecret) `
                 graphClientState=(ConvertFrom-SecureStringPlain $GraphClientState) `
                 anthropicApiKey=(ConvertFrom-SecureStringPlain $AnthropicApiKey) `
                 monitoredUsers=$MonitoredUsers `
                 githubOwner=$GithubOwner `
                 githubRepo=$GithubRepo `
                 githubBranch=$GithubBranch `
                 githubAppId=$GithubAppId `
                 githubAppInstallationId=$GithubAppInstallationId `
                 githubAppPrivateKey=$githubAppPrivateKey `
    -o json | ConvertFrom-Json

  $functionAppName = $deployResult.properties.outputs.functionAppName.value
  $notificationUrl = $deployResult.properties.outputs.notificationUrl.value

  Write-Host "`nPublishing code to $functionAppName..." -ForegroundColor Cyan
  func azure functionapp publish $functionAppName

  Write-Host "`n===== Deployed =====" -ForegroundColor Green
  Write-Host "Function App: $functionAppName"
  Write-Host "Webhook URL:  $notificationUrl"
  Write-Host "`nThe pollTimer function runs every 5 minutes and will create the Graph"
  Write-Host "subscription on its first run — no separate 'start' step needed."
} finally {
  Pop-Location
}
