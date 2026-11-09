// Meeting Agent — Azure Static Web App for the meeting details page, and the storage
// it reads meetings from.
//
// Free plan, no custom domain and no linked repository: the site's content is
// deployed by hand with the Static Web Apps CLI, not by GitHub Actions.
// Deploy with scripts/deploy-staticwebapp.ps1.
//
// The Logic App saves each meeting as <meeting_id>.json in the "meetings" container of
// the existing storage account, signing in with its managed identity. That identity
// needs "Storage Blob Data Contributor" on the container, which only an Owner (or User
// Access Administrator) can grant, so it isn't part of this template; the deploy script
// checks for it. The site's API reads the files with a read-only shared access signature
// (app setting MEETINGS_READ_SAS), because on the Free plan the API can't use a managed
// identity.
//
// Action item statuses are saved by the API in a separate "meeting-status" container,
// with a read/write SAS for that container only (MEETING_STATUS_SAS). A SAS can't be
// limited to particular files, so keeping statuses apart means that key can't change or
// remove the meetings themselves. Anyone with a meeting's link can change its statuses.
//
// Redeploy before sasExpiry to renew both SAS tokens.

@description('Name of the static web app.')
param name string = 'meetingagent-web'

@description('Region for the app\'s API and staging environments; the pages themselves are served globally. Static Web Apps isn\'t offered in Australia, and East Asia is the closest region that is.')
param location string = 'eastasia'

@description('Existing storage account that holds the saved meetings.')
param storageAccountName string = 'meetingagentstor'

@secure()
@description('Value of the Key Vault secret meeting-link-secret. The API checks each link\'s hash with it.')
param meetingLinkSecret string

@description('When the API\'s shared access signatures stop working.')
param sasExpiry string = dateTimeAdd(utcNow('u'), 'P1Y', 'yyyy-MM-ddTHH:mm:ssZ')

var containerName = 'meetings'
var statusContainerName = 'meeting-status'

resource staticWebApp 'Microsoft.Web/staticSites@2024-11-01' = {
  name: name
  location: location
  sku: {
    name: 'Free'
    tier: 'Free'
  }
  // No repositoryUrl or branch, so Azure doesn't add a GitHub Actions workflow;
  // deployments use the app's deployment token instead.
  properties: {}
}

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' existing = {
  name: storageAccountName

  resource blobService 'blobServices' existing = {
    name: 'default'
  }
}

resource meetingsContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: storage::blobService
  name: containerName
  properties: {
    publicAccess: 'None'
  }
}

resource statusContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: storage::blobService
  name: statusContainerName
  properties: {
    publicAccess: 'None'
  }
}

resource appSettings 'Microsoft.Web/staticSites/config@2024-11-01' = {
  parent: staticWebApp
  name: 'appsettings'
  properties: {
    MEETING_LINK_SECRET: meetingLinkSecret
    MEETINGS_CONTAINER_URL: '${storage.properties.primaryEndpoints.blob}${containerName}'
    MEETINGS_READ_SAS: storage.listServiceSas('2023-05-01', {
      canonicalizedResource: '/blob/${storageAccountName}/${containerName}'
      signedResource: 'c'
      signedPermission: 'r'
      signedProtocol: 'https'
      signedExpiry: sasExpiry
    }).serviceSasToken
    MEETING_STATUS_CONTAINER_URL: '${storage.properties.primaryEndpoints.blob}${statusContainerName}'
    // Read and write (create or overwrite) files in meeting-status only.
    MEETING_STATUS_SAS: storage.listServiceSas('2023-05-01', {
      canonicalizedResource: '/blob/${storageAccountName}/${statusContainerName}'
      signedResource: 'c'
      signedPermission: 'rw'
      signedProtocol: 'https'
      signedExpiry: sasExpiry
    }).serviceSasToken
  }
  // Applied after the containers exist, so the API never gets a SAS for a missing container.
  dependsOn: [
    meetingsContainer
    statusContainer
  ]
}

@description('Auto-generated address of the site, e.g. orange-pond-0a04b7203.2.azurestaticapps.net.')
output defaultHostname string = staticWebApp.properties.defaultHostname

@description('Scope for the Logic App identity\'s Storage Blob Data Contributor role.')
output meetingsContainerId string = meetingsContainer.id

output statusContainerName string = statusContainer.name

output sasExpiry string = sasExpiry
