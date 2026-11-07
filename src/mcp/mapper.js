/**
 * MCP field mapper (UI side).
 *
 * The schema, the transforms and the validation rules all live in rules.js so
 * the Worker and the browser can never disagree. This module only adds what the
 * mapping screen needs: suggestions, a validation report shaped for the UI, and
 * a preview of transformed rows.
 */

import {
  ENTITIES, IMPORTABLE_ENTITIES, TRANSFORMS, applyTransforms, columnType,
  schemaFor, validateMapping as validateMappingRules,
} from './rules.js'
import { t } from '../i18n/index.js'

/* ----------------------------------------------------------------- Schema */

/** Shape the mapping screen renders: { requests: { label, columns: [...] } }. */
export const SATU_ALUR_SCHEMA = Object.fromEntries(
  IMPORTABLE_ENTITIES.map((key) => [key, schemaFor(key)]),
)

export { TRANSFORMS, applyTransforms }

/* -------------------------------------------------------------- Suggestions */

/** Aliases seen in Indonesian ERPs and spreadsheet exports. */
const ALIASES = {
  customer_name: ['nama', 'nama_pelanggan', 'pelanggan', 'client_name', 'contact_name', 'customer'],
  service_type: ['jenis_layanan', 'layanan', 'jasa', 'service', 'product_name', 'item_name', 'kategori_layanan'],
  phone: ['telepon', 'telp', 'no_hp', 'nohp', 'handphone', 'hp', 'mobile', 'phone_number', 'wa'],
  location: ['alamat', 'address', 'lokasi', 'street', 'kota', 'city'],
  description: ['deskripsi', 'keterangan', 'catatan', 'notes', 'detail', 'remark'],
  requested_at: ['tanggal', 'tanggal_pesanan', 'order_date', 'created_at', 'tgl', 'date'],
  price: ['harga', 'harga_jual', 'lst_price', 'unit_price', 'amount', 'tarif'],
  cost: ['biaya', 'harga_pokok', 'standard_price', 'cost_price', 'modal'],
  name: ['nama', 'full_name', 'employee_name', 'nama_item', 'nama_layanan'],
  status: ['status', 'state', 'kondisi'],
  category: ['kategori', 'category', 'kateg_id', 'grup'],
  attach_rate: ['serapan', 'attach', 'attach_rate', 'probabilitas'],
  monthly_loss: ['kerugian', 'kerugian_bulanan', 'loss', 'monthly_loss', 'biaya_hilang'],
  saved: ['dihemat', 'terselamatkan', 'saved', 'perbaikan'],
  stream: ['aliran', 'stream', 'jenis_pemborosan'],
  title: ['judul', 'title', 'nama_temuan', 'temuan'],
  skills: ['keahlian', 'skills', 'skill', 'kompetensi'],
  zone: ['zona', 'zone', 'wilayah', 'area'],
  address: ['alamat', 'address', 'lokasi'],
  notes: ['catatan', 'notes', 'keterangan'],
  amount: ['jumlah', 'nominal', 'total', 'amount', 'nilai'],
}

/**
 * Suggest a source column for every target column of `entity`.
 * Direct name match wins, then a known alias, then a fuzzy match.
 */
export function suggestMapping(sourceColumns, entity) {
  const spec = ENTITIES[entity]
  if (!spec) return []
  const columns = Array.isArray(sourceColumns) ? sourceColumns : []

  return spec.columns.map((target) => {
    const targetLower = target.toLowerCase()

    let hit = columns.find((c) => String(c.name).toLowerCase() === targetLower)

    if (!hit) {
      const aliasList = ALIASES[target] || []
      hit = columns.find((c) => aliasList.includes(String(c.name).toLowerCase()))
    }

    if (!hit) {
      hit = columns.find((c) => {
        const sourceName = String(c.name).toLowerCase()
        return sourceName.includes(targetLower) || targetLower.includes(sourceName)
          || levenshtein(sourceName, targetLower) <= 2
      })
    }

    const type = columnType(entity, target)
    return {
      target,
      targetType: type,
      targetRequired: spec.required.includes(target),
      targetValues: spec.enums?.[target] || null,
      source: hit ? hit.name : null,
      sourceType: hit ? hit.type : null,
      confidence: !hit ? 'low' : String(hit.name).toLowerCase() === targetLower ? 'high' : 'medium',
      suggestedTransform: guessTransform(hit, type),
    }
  })
}

function guessTransform(sourceColumn, targetType) {
  if (!sourceColumn) return null
  const sourceType = sourceColumn.type
  if (targetType === 'number' && sourceType === 'string') return 'number'
  if (targetType === 'datetime' && sourceType === 'string') return 'date:ISO8601'
  if (targetType === 'json' && sourceType !== 'string') return 'json'
  if (targetType === 'string' && sourceType === 'string') return 'trim'
  if (sourceColumn.name && /phone|telepon|hp|wa/i.test(sourceColumn.name) && targetType === 'string') return 'phone_id'
  return null
}

function levenshtein(a, b) {
  const matrix = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)))
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      matrix[i][j] = a[i - 1] === b[j - 1]
        ? matrix[i - 1][j - 1]
        : Math.min(matrix[i - 1][j - 1] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j] + 1)
    }
  }
  return matrix[a.length][b.length]
}

/* -------------------------------------------------------------- Validation */

/**
 * Validate a mapping and return an array of { message, code } for the UI.
 * An empty array means the mapping is complete.
 */
export function validateMapping(mapping, entity) {
  try {
    validateMappingRules({ ...mapping, entity })
    return []
  } catch (err) {
    return [{ message: err.message, code: 'VALIDATION' }]
  }
}

/* ----------------------------------------------------------------- Preview */

/**
 * Show how the first rows will look after transformation, with per-row errors.
 * Never writes anything — this is what the "Pratinjau" step displays.
 */
export function previewTransform(sourceRows, mapping, entity, limit = 10) {
  const spec = ENTITIES[entity]
  if (!spec) return []

  return (sourceRows || []).slice(0, limit).map((row, index) => {
    const out = { _rowIndex: index + 1, _valid: true, _errors: [] }
    for (const field of mapping.fields || []) {
      let raw
      if (field.constant !== null && field.constant !== undefined) raw = field.constant
      else if (field.source) raw = row[field.source]
      else raw = null

      const chain = field.transform
        ? (Array.isArray(field.transform) ? field.transform : [field.transform])
        : []
      const value = chain.length ? applyTransforms(raw, chain, field.mapping) : raw

      if (field.target) out[field.target] = value

      if (spec.required.includes(field.target)
        && (value === null || value === undefined || String(value).trim() === '')) {
        out._valid = false
        out._errors.push(t('erp.preview.required', { field: field.target }))
      }
      if (value !== null && value !== undefined && value !== '' && spec.enums?.[field.target]) {
        const allowed = spec.enums[field.target]
        if (!allowed.includes(String(value).trim().toLowerCase())) {
          out._valid = false
          out._errors.push(t('erp.preview.unknown', { field: field.target, value: String(value).slice(0, 30) }))
        }
      }
    }
    return out
  })
}
