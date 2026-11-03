// Profile rules shared by the Worker, the mock cloud and the UI (no imports).

/** Display name: trimmed, 2–60 chars, no control characters or angle brackets. */
export function cleanProfileName(raw) {
  const name = String(raw ?? '').replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim()
  if (name.length < 2) throw Object.assign(new Error('Nama minimal 2 karakter.'), { validation: true })
  if (name.length > 60) throw Object.assign(new Error('Nama maksimal 60 karakter.'), { validation: true })
  return name
}

/**
 * What the profile menu offers. ctx: { demo, isAdmin, adminVia, inOffice }.
 * Staff sessions only have the office; email admins switch between their app and the office.
 */
export function profileMenuItems({ demo = false, isAdmin = false, adminVia = null, inOffice = false } = {}) {
  const staff = isAdmin && adminVia !== 'email'
  const items = []
  if (!staff) items.push('profile', 'plan', 'settings')
  if (isAdmin && adminVia === 'email') items.push(inOffice ? 'back' : 'office')
  items.push('theme', 'signout')
  return { items, badge: staff ? 'Staf' : isAdmin ? 'Admin' : demo ? 'Demo' : 'Live', canEditProfile: !staff && !demo }
}
