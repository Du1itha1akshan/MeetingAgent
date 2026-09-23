// Meeting Agent — Azure Functions hosting for a fully unattended pipeline.
//
// Deploy with scripts/deploy.ps1 (wraps `az deployment group create` and then
// publishes the compiled code). Secrets are passed in as @secure() params and
// land in Key Vault, never in plaintext app settings or source control.

@description('Base name used to derive all resource names, e.g. "meetingagent".')
@minLength(3)
@maxLength(15)
param baseName string

@description('Azure region for all resources.')
param location string = resourceGroup().location

@description('Entra ID tenant ID the app registration lives in.')
param azureTenantId string

@description('Entra ID application (client) ID from scripts/provision-entra-app.ps1.')
param azureClientId string

@secure()
@description('Entra ID application client secret.')
param azureClientSecret string

@secure()
@description('Random shared secret Graph echoes back in clientState on every notification.')
param graphClientState string

@secure()
@description('Anthropic API key used for meeting summarization.')
param anthropicApiKey string

param claudeModel string = 'claude-sonnet-4-6'

@description('Comma-separated UPNs/user IDs whose calendars are monitored.')
param monitoredUsers string

param githubOwner string
param githubRepo string
param githubBranch string = 'main'
param githubBasePath string = 'meetings'
param createIssuesForActionItems bool = true

@description('GitHub App ID (see docs/SETUP.md for creating the App).')
param githubAppId string

@secure()
@description('GitHub App private key, PEM format.')
param githubAppPrivateKey string

@description('GitHub App installation ID for the target repo.')
param githubAppInstallationId string

param pollLookbackMinutes int = 20

// ---- Storage: Functions runtime + Table/Queue state store ----
resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: '${baseName}stor'
  location: location
  sku: { name: 'Standard_LRS' }
  kind: 'StorageV2'
  properties: {
    minimumTlsVersion: 'TLS1_2'
    allowBlobPublicAccess: false
  }
}

// ---- Observability ----
resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: '${baseName}-logs'
  location: location
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
  }
}

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: '${baseName}-ai'
  location: location
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logAnalytics.id
  }
}

// ---- Secrets ----
resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: '${baseName}-kv'
  location: location
  properties: {
    sku: { family: 'A', name: 'standard' }
    tenantId: subscription().tenantId
    enableRbacAuthorization: true
  }
}

resource secretClientSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'azure-client-secret'
  properties: { value: azureClientSecret }
}

resource secretClientState 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'graph-client-state'
  properties: { value: graphClientState }
}

resource secretAnthropicKey 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'anthropic-api-key'
  properties: { value: anthropicApiKey }
}

resource secretGithubPrivateKey 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'github-app-private-key'
  properties: { value: githubAppPrivateKey }
}

// ---- Compute: Linux Consumption plan + Function App ----
resource hostingPlan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: '${baseName}-plan'
  location: location
  sku: { name: 'Y1', tier: 'Dynamic' }
  kind: 'functionapp'
  properties: { reserved: true }
}

var storageConnectionString = 'DefaultEndpointsProtocol=https;AccountName=${storage.name};AccountKey=${storage.listKeys().keys[0].value};EndpointSuffix=${environment().suffixes.storage}'

resource functionApp 'Microsoft.Web/sites@2023-12-01' = {
  name: '${baseName}-func'
  location: location
  kind: 'functionapp,linux'
  identity: { type: 'SystemAssigned' }
  properties: {
    serverFarmId: hostingPlan.id
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: 'Node|20'
      appSettings: [
        { name: 'AzureWebJobsStorage', value: storageConnectionString }
        { name: 'FUNCTIONS_WORKER_RUNTIME', value: 'node' }
        { name: 'FUNCTIONS_EXTENSION_VERSION', value: '~4' }
        { name: 'WEBSITE_NODE_DEFAULT_VERSION', value: '~20' }
        { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: appInsights.properties.ConnectionString }
        { name: 'KEY_VAULT_URI', value: keyVault.properties.vaultUri }
        { name: 'AZURE_TENANT_ID', value: azureTenantId }
        { name: 'AZURE_CLIENT_ID', value: azureClientId }
        { name: 'MONITORED_USERS', value: monitoredUsers }
        { name: 'NOTIFICATION_URL', value: 'https://${baseName}-func.azurewebsites.net/api/graph/notifications' }
        { name: 'CLAUDE_MODEL', value: claudeModel }
        { name: 'GITHUB_OWNER', value: githubOwner }
        { name: 'GITHUB_REPO', value: githubRepo }
        { name: 'GITHUB_BRANCH', value: githubBranch }
        { name: 'GITHUB_BASE_PATH', value: githubBasePath }
        { name: 'CREATE_ISSUES_FOR_ACTION_ITEMS', value: string(createIssuesForActionItems) }
        { name: 'GITHUB_APP_ID', value: githubAppId }
        { name: 'GITHUB_APP_INSTALLATION_ID', value: githubAppInstallationId }
        { name: 'POLL_LOOKBACK_MINUTES', value: string(pollLookbackMinutes) }
      ]
    }
  }
}

// ---- RBAC: let the Function App's managed identity read the 4 app secrets ----
var keyVaultSecretsUserRoleId = '4633458b-17de-408a-b874-0445c86b69e6'

resource kvRoleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: keyVault
  name: guid(keyVault.id, functionApp.id, keyVaultSecretsUserRoleId)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', keyVaultSecretsUserRoleId)
    principalId: functionApp.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

output functionAppName string = functionApp.name
output notificationUrl string = 'https://${baseName}-func.azurewebsites.net/api/graph/notifications'
output keyVaultName string = keyVault.name
