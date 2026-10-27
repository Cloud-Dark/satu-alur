// Domain validation rules — cerminan backend (RLS + constraints).
// AI menghasilkan usulan; aturan domain memvalidasi sebelum disetujui.

export const OfferRules = {
  minPrice: 10000, // IDR
  maxPrice: 1000000000,
  requiredFields: ['scope', 'price', 'terms'],
}

export function validateOffer(offerJson) {
  const errors = []
  if (!offerJson) {
    errors.push('Proposal AI kosong.')
    return { valid: false, errors }
  }
  const price = Number(offerJson.price)
  if (Number.isNaN(price) || price < OfferRules.minPrice || price > OfferRules.maxPrice) {
    errors.push(`Harga harus antara Rp${OfferRules.minPrice.toLocaleString('id-ID')} dan Rp${OfferRules.maxPrice.toLocaleString('id-ID')}.`)
  }
  if (!offerJson.scope || String(offerJson.scope).trim().length < 10) {
    errors.push('Ruang lingkup pekerjaan terlalu singkat (min 10 karakter).')
  }
  if (!offerJson.terms || String(offerJson.terms).trim().length < 10) {
    errors.push('Ketentuan/Syarat terlalu singkat (min 10 karakter).')
  }
  return { valid: errors.length === 0, errors }
}

export function canTransition(currentStatus, nextStatus, map) {
  const allowed = map[currentStatus] || []
  return allowed.includes(nextStatus)
}

export const OfferTransitions = {
  draft: ['pending_approval'],
  pending_approval: ['approved', 'rejected'],
  approved: ['draft'],
  rejected: ['draft'],
}
