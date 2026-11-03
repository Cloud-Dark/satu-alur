/**
 * Keahlian petugas: rules for the per-business skill list (pure; no I/O).
 * A skill has a stable `key` (stored in workers.skills) and an editable `name`.
 * Renaming changes only the name, so petugas keep their skills.
 */
import { SKILL_LABELS } from './workers.js'

export const DEFAULT_SKILLS = Object.entries(SKILL_LABELS).map(([key, name]) => ({ key, name }))
export const NAME_MIN = 2
export const NAME_MAX = 40

export const cleanName = (name) => String(name ?? '').replace(/\s+/g, ' ').trim()
const fold = (s) => cleanName(s).toLocaleLowerCase('id-ID')

/** Returns an Indonesian error message, or null when the name can be saved. */
export function nameProblem(name, skills = [], { exceptId = null } = {}) {
  const n = cleanName(name)
  if (n.length < NAME_MIN) return `Nama keahlian minimal ${NAME_MIN} huruf.`
  if (n.length > NAME_MAX) return `Nama keahlian maksimal ${NAME_MAX} huruf.`
  if (skills.some((s) => s.id !== exceptId && fold(s.name) === fold(n))) return `Keahlian "${n}" sudah ada.`
  return null
}

/** A url-safe key from the name, unique among the existing keys. */
export function keyFor(name, skills = []) {
  const base = cleanName(name).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'keahlian'
  const taken = new Set(skills.map((s) => s.key))
  if (!taken.has(base)) return base
  for (let i = 2; ; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`
}

/** key → display name; unknown keys fall back to the built-in labels, then the key itself. */
export function labelMap(skills = []) {
  const map = { ...SKILL_LABELS }
  for (const s of skills) map[s.key] = s.name
  return map
}

export const sortSkills = (skills = []) => [...skills].sort((a, b) => a.name.localeCompare(b.name, 'id'))

/** Petugas that list this skill. */
export const workersUsing = (key, workers = []) => (workers || []).filter((w) => (w.skills || []).includes(key))

/** The workers.skills array without `key` (used when a skill is deleted). */
export const withoutSkill = (skills, key) => (skills || []).filter((k) => k !== key)
