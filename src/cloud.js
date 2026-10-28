import { createWorkBuddyCloud } from '@tencent-ai/workbuddy-cloud-sdk'
import { createMockWorkBuddyCloud } from './mock/mock-cloud.js'
import { publicConfig, isCloudConfigured } from './cloud.config.js'

let _cloud = null
let _isMock = false

export function getCloud() {
  if (_cloud) return _cloud
  if (!isCloudConfigured()) {
    // Fallback ke mock cloud untuk prototype mode
    _cloud = createMockWorkBuddyCloud()
    _isMock = true
    return _cloud
  }
  _cloud = createWorkBuddyCloud({
    endpoint: publicConfig.endpoint,
    oauthRelayBaseUrl: publicConfig.oauthRelayBaseUrl,
    publishableKey: publicConfig.publishableKey,
  })
  _isMock = false
  return _cloud
}

export function isCloudReady() {
  return isCloudConfigured()
}

export function isUsingMockCloud() {
  // Lazy-init supaya status akurat
  if (!_cloud) getCloud()
  return _isMock
}
