import { getCloud } from '../cloud.js'

let _models = null

export async function loadModels() {
  const cloud = getCloud()
  const { data, error } = await cloud.llm.models.list()
  if (error) throw new Error(`Gagal memuat model: ${error.message}`)
  _models = (data || []).filter((m) => m.disabled !== true)
  if (_models.length === 0) throw new Error('Tidak ada model AI yang tersedia saat ini.')
  return _models
}

export function getModels() {
  return _models || []
}

export function pickDefaultModel() {
  return _models?.[0] ?? null
}
