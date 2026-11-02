// Tier rules and the /api/mcp/* gate. The gate lives in one place
// (requireOwner in worker/mcp.js), so a single rejection test covers every
// route that needs it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import './helpers/setup.mjs'

import {
  PLANS, FEATURES, normalizePlan, planLabel, planRank, requiredPlan,
  canUse, planLockMessage, planForScale,
} from '../src/business/plan-access.js'
import { handleConnectorList, handleMigrationList } from '../worker/mcp.js'

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status }
}

function deps(plan) {
  return {
    authenticate: async () => ({ user: { id: 'user-1', email: 'a@b.c', plan } }),
    readJson: async () => ({}),
    ok: (data) => ({ data, error: null }),
    HttpError,
    canUse,
    planLockMessage,
    DEMO_EMAILS: new Set(),
    sha256Hex: async () => 'x',
    randomHex: () => 'x',
  }
}

/* ------------------------------------------------------------ Tier rules */

test('only the three known tiers are accepted, anything else is sole', () => {
  assert.deepEqual(PLANS, ['sole', 'ukm', 'enterprise'])
  assert.equal(normalizePlan('enterprise'), 'enterprise')
  assert.equal(normalizePlan('  ENTERPRISE '), 'enterprise')
  assert.equal(normalizePlan('ukm'), 'ukm')
  assert.equal(normalizePlan(''), 'sole')
  assert.equal(normalizePlan(null), 'sole')
  assert.equal(normalizePlan(undefined), 'sole')
  assert.equal(normalizePlan('platinum'), 'sole')
})

test('ranks are ordered sole < ukm < enterprise', () => {
  assert.ok(planRank('sole') < planRank('ukm'))
  assert.ok(planRank('ukm') < planRank('enterprise'))
  assert.equal(planRank('nonsense'), planRank('sole'))
})

test('ERP integration requires enterprise and nothing else is gated', () => {
  assert.equal(requiredPlan('erpIntegration'), 'enterprise')
  assert.equal(canUse('sole', 'erpIntegration'), false)
  assert.equal(canUse('ukm', 'erpIntegration'), false)
  assert.equal(canUse('enterprise', 'erpIntegration'), true)

  // Unknown features stay open: closing a feature must be a deliberate edit.
  assert.equal(canUse('sole', 'doesNotExist'), true)
  assert.equal(requiredPlan('doesNotExist'), 'sole')
})

test('the lock message names the tier in Indonesian', () => {
  const msg = planLockMessage('erpIntegration')
  assert.match(msg, /Enterprise/)
  assert.match(msg, /tersedia pada paket/)
  assert.equal(planLockMessage('doesNotExist'), '')
})

test('labels and demo scales map onto tiers', () => {
  assert.equal(planLabel('enterprise'), 'Enterprise')
  assert.equal(planLabel('ukm'), 'UKM')
  assert.equal(planLabel('sole'), 'Sole Trader')
  assert.equal(planForScale('enterprise'), 'enterprise')
  assert.equal(planForScale('ukm'), 'ukm')
  assert.equal(planForScale(undefined), 'sole')
})

test('every gated feature declares a label, a tier and a summary', () => {
  for (const [key, spec] of Object.entries(FEATURES)) {
    assert.ok(spec.label, `${key} needs a label`)
    assert.ok(PLANS.includes(spec.minPlan), `${key} minPlan must be a known tier`)
    assert.ok(spec.summary, `${key} needs a summary`)
  }
})

/* ----------------------------------------------------------------- Gate */

test('non-enterprise tiers are refused before touching the database', async () => {
  const env = {} // no DB: reaching the database would throw a different error
  for (const plan of ['sole', 'ukm']) {
    await assert.rejects(
      handleConnectorList(new Request('https://x/api/mcp/connectors'), env, deps(plan)),
      (err) => {
        assert.equal(err.status, 403)
        assert.match(err.message, /Enterprise/)
        return true
      },
      `${plan} must be refused`,
    )
  }
})

test('the gate covers migration routes too, not just connectors', async () => {
  await assert.rejects(
    handleMigrationList(new Request('https://x/api/mcp/migrations'), {}, deps('ukm')),
    (err) => err.status === 403,
  )
})

test('a missing plan is treated as sole, not as unlimited', async () => {
  await assert.rejects(
    handleConnectorList(new Request('https://x/api/mcp/connectors'), {}, deps(undefined)),
    (err) => err.status === 403,
  )
})
