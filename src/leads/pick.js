// Pure helpers for the Permintaan map picker (no DOM; shared with tests).

/** Short location text for the request: street address plus the area searched. */
export function pickLocation(lead, areaLabel) {
  const area = String(areaLabel || '').replace(/,\s*Indonesia.*$/i, '').replace(/\s*\(contoh\)\s*$/i, '').trim()
  const addr = String(lead?.address || '').trim()
  const text = addr && area && !addr.toLowerCase().includes(area.toLowerCase()) ? `${addr}, ${area}` : (addr || area)
  return text.slice(0, 120)
}

/** Values the wizard fills from a picked business. */
export function pickedFields(lead, areaLabel) {
  const phone = String(lead?.phone || '').trim()
  return {
    customer_name: String(lead?.name || '').trim().slice(0, 120),
    location: pickLocation(lead, areaLabel),
    phone: /^[+()\d\s.-]{6,32}$/.test(phone) ? phone : '',
    lat: Number.isFinite(Number(lead?.lat)) ? Number(lead.lat) : null,
    lng: Number.isFinite(Number(lead?.lon)) ? Number(lead.lon) : null,
  }
}
