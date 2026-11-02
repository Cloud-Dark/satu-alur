/**
 * MCP migration helpers.
 *
 * The engine itself lives in the Worker (`worker/mcp.js`) so a migration keeps
 * running when the browser closes. This module re-exports the client calls and
 * adds the pieces the UI needs: the phase plan and a validation report.
 */

import {
  createMigration, getMigration, listMigrations, rollbackMigration,
  runMigrationPhase,
} from './connector.js'
import { MIGRATION_PHASES } from './rules.js'

export { createMigration, getMigration, listMigrations, rollbackMigration, runMigrationPhase, MIGRATION_PHASES }

/** Run every pending phase in order. Returns the final migration row. */
export async function runFullMigration(id, options = {}) {
  let migration = await getMigration(id)
  if (!migration) throw new Error('Migrasi tidak ditemukan.')

  let guard = 0
  while (guard++ < 10) {
    const index = migration.phases.findIndex((p) => p.status === 'pending')
    if (index < 0) break
    migration = await runMigrationPhase(id, { ...options, phaseIndex: index })
    if (migration.status === 'rolled_back') break
  }
  return migration
}

/** A single phase, without touching the others. */
export async function dryRunMigration(id, phaseIndex = 0) {
  return runMigrationPhase(id, { phaseIndex, dryRun: true })
}

/** Aggregate a migration row into the numbers the report screen shows. */
export function generateValidationReport(migration) {
  if (!migration) return null

  const phases = migration.phases || []
  const sum = (key) => phases.reduce((total, p) => total + (Number(p[key]) || 0), 0)
  const processed = sum('recordsProcessed')
  const inserted = sum('recordsInserted')
  const updated = sum('recordsUpdated')
  const failed = sum('recordsFailed')

  return {
    id: migration.id,
    name: migration.name,
    status: migration.status,
    strategy: migration.strategy,
    summary: {
      processed,
      inserted,
      updated,
      failed,
      successRate: processed > 0 ? Math.round(((processed - failed) / processed) * 100) : 0,
    },
    phases: phases.map((p) => ({
      name: p.name,
      status: p.status,
      recordsProcessed: Number(p.recordsProcessed) || 0,
      recordsInserted: Number(p.recordsInserted) || 0,
      recordsUpdated: Number(p.recordsUpdated) || 0,
      recordsFailed: Number(p.recordsFailed) || 0,
      errorCount: (p.errors || []).length,
      durationSeconds: p.startedAt && p.endedAt
        ? Math.max(0, Math.round((new Date(p.endedAt) - new Date(p.startedAt)) / 1000))
        : 0,
    })),
    errors: phases.flatMap((p) => (p.errors || []).map((e) => ({ phase: p.name, ...e }))),
  }
}
