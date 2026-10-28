/**
 * CONTOH Konfigurasi WorkBuddy Cloud Service
 *
 * 1. Salin file ini menjadi cloud.config.js
 * 2. Isi dengan nilai dari aktivasi WorkBuddy Cloud Service Anda
 * 3. File cloud.config.js sudah di .gitignore (tidak akan di-commit)
 */
export const publicConfig = {
  resourceId: 'your-resource-id-here',
  endpoint: 'https://your-app.workbuddy.link',
  oauthRelayBaseUrl: 'https://oauth.workbuddy.link',
  publishableKey: 'your-publishable-key-here',
}

export const isCloudConfigured = () =>
  Boolean(publicConfig.endpoint && publicConfig.publishableKey)
