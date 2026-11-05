// Pure helpers for the Permintaan map picker (no DOM; shared with tests).

/** Short location text for the request: street address plus the area searched. */
export function pickLocation(lead, areaLabel) {
  const area = String(areaLabel || '').replace(/,\s*Indonesia.*$/i, '').replace(/\s*\(contoh\)\s*$/i, '').trim()
  const addr = String(lead?.address || '').trim()
  const text = addr && area && !addr.toLowerCase().includes(area.toLowerCase()) ? `${addr}, ${area}` : (addr || area)
  return text.slice(0, 120)
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Contacts other than phone and e-mail, as short labelled strings:
 * ["hotelbumi.id", "WA +62812…", "IG @hotelbumi", "FB facebook.com/x", "HP 0813…"].
 */
export function otherContacts(lead) {
  const c = lead?.contacts || {}
  const site = String(lead?.website || '').replace(/^https?:\/\//i, '').replace(/\/$/, '')
  return [
    site,
    c.whatsapp ? `WA ${c.whatsapp}` : '',
    c.mobile ? `HP ${c.mobile}` : '',
    c.instagram ? `IG ${c.instagram}` : '',
    c.facebook ? `FB ${c.facebook}` : '',
  ].filter(Boolean)
}

/** Values the wizard fills from a picked business. */
export function pickedFields(lead, areaLabel) {
  const phone = String(lead?.phone || '').trim()
  const email = String(lead?.email || '').trim().toLowerCase()
  return {
    customer_name: String(lead?.name || '').trim().slice(0, 120),
    location: pickLocation(lead, areaLabel),
    phone: /^[+()\d\s.-]{6,32}$/.test(phone) ? phone : '',
    email: email.length <= 254 && EMAIL_RE.test(email) ? email : '',
    website: otherContacts(lead).join(' · ').slice(0, 300),
    description: String(lead?.description || '').trim().slice(0, 300),
    lat: Number.isFinite(Number(lead?.lat)) ? Number(lead.lat) : null,
    lng: Number.isFinite(Number(lead?.lon)) ? Number(lead.lon) : null,
  }
}
