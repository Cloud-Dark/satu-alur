import { createHttpCloud } from './http-cloud.js'
import { createMockWorkBuddyCloud } from './mock/mock-cloud.js'

let _cloud = null
let _isMock = false

// Mock hanya untuk dev tanpa backend (localStorage satualur_use_mock=1) atau VITE_USE_MOCK=true
function shouldUseMock() {
  if (import.meta.env.VITE_USE_MOCK === 'true') return true
  if (!import.meta.env.DEV) return false
  try { return localStorage.getItem('satualur_use_mock') === '1' } catch { return false }
}

export function getCloud() {
  if (_cloud) return _cloud
  if (shouldUseMock()) {
    _cloud = createMockWorkBuddyCloud()
    _isMock = true
    return _cloud
  }
  _cloud = createHttpCloud()
  _isMock = false
  return _cloud
}

export function isCloudReady() {
  return true
}

export function isUsingMockCloud() {
  // Lazy-init supaya status akurat
  if (!_cloud) getCloud()
  return _isMock
}
