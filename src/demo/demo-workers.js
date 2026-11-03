/**
 * Petugas contoh untuk 9 akun demo (DATA FIKTIF). Dipakai oleh seeds/demo-workers.sql
 * (scripts/seed-demo-workers.mjs) dan scripts/seed-demo.mjs. Nama mengikuti nama
 * pelaksana di data demo bila ada (pemilik + helper, roster UKM, supervisor tim).
 * Telepon 0812-0000-xxxx sengaja palsu; alamat berlabel "(contoh)".
 */

export const demoOwnerId = (k) => `0d3e5a11-7c1a-4b5e-9a0${k}-5a7a1a1d000${k}`

// Koordinat kota (sama dengan gazetteer offline src/leads/demo.js), digeser sedikit per petugas.
const CITY = {
  BKS: ['Bekasi, Jawa Barat', -6.2383, 106.9756],
  MKS: ['Makassar, Sulawesi Selatan', -5.1477, 119.4327],
  MDN: ['Medan, Sumatera Utara', 3.5952, 98.6722],
  SBY: ['Surabaya, Jawa Timur', -7.2575, 112.7521],
  SDA: ['Sidoarjo, Jawa Timur', -7.4478, 112.7183],
  BDG: ['Bandung, Jawa Barat', -6.9175, 107.6191],
  BPN: ['Balikpapan, Kalimantan Timur', -1.2379, 116.8529],
  JKT: ['Jakarta Selatan, DKI Jakarta', -6.2615, 106.8106],
  JKB: ['Jakarta Barat, DKI Jakarta', -6.1674, 106.7637],
  JKP: ['Jakarta Pusat, DKI Jakarta', -6.1865, 106.8341],
}

/** Keahlian per akun: key bawaan memakai nama bawaan; key khusus diberi nama sendiri. */
const SKILL_NAMES = {
  ac: 'Service AC', cleaning: 'Cleaning', waterproofing: 'Waterproofing', roof: 'Roof Repair', carpet: 'Cuci Karpet',
  sofa: 'Cuci Sofa', electrical: 'Listrik', pool: 'Kolam Renang', garden: 'Taman', pest: 'Pest Control',
  laundry: 'Laundry & setrika', antar: 'Antar-jemput', cat: 'Pengecatan', mep: 'Maintenance MEP',
  ob: 'Office boy', gedung: 'Teknisi gedung', 'hk-rs': 'Housekeeping RS', fogging: 'Fogging & disinfeksi',
}

const STREETS = ['Jl. Melati', 'Jl. Kenanga', 'Jl. Anggrek', 'Jl. Cempaka', 'Jl. Flamboyan', 'Jl. Dahlia', 'Jl. Mawar', 'Jl. Teratai']

// [name, skills, city, status]
const ROSTER = {
  1: { skills: ['ac', 'cleaning', 'electrical'], people: [
    ['Budi Santoso', ['ac', 'electrical'], 'BKS'], ['Andi (helper)', ['ac', 'cleaning'], 'BKS'],
    ['Rizky Pratama (teknisi)', ['ac', 'electrical'], 'BKS'], ['Fikri (helper)', ['ac'], 'BKS', 'inactive'],
  ] },
  2: { skills: ['cleaning', 'carpet', 'sofa'], people: [
    ['Rina Kusuma', ['cleaning', 'sofa'], 'MKS'], ['Wati', ['cleaning'], 'MKS'], ['Sukma', ['cleaning', 'carpet'], 'MKS'],
    ['Dewi', ['cleaning', 'sofa'], 'MKS'], ['Nurul', ['cleaning'], 'MKS', 'inactive'],
  ] },
  3: { skills: ['electrical', 'ac'], people: [
    ['Hendra Siregar', ['electrical'], 'MDN'], ['Bonar (helper)', ['electrical'], 'MDN'], ['Daniel (helper)', ['electrical', 'ac'], 'MDN'],
  ] },
  4: { skills: ['pest', 'fogging', 'cleaning', 'garden'], people: [
    ['Agus Salim', ['pest', 'fogging'], 'SBY'], ['Siti Aminah', ['pest', 'cleaning'], 'SBY'], ['Joko Purnomo', ['pest', 'garden'], 'SDA'],
    ['Rahmat Hidayat', ['pest', 'fogging'], 'SBY'], ['Dedi Kurniawan', ['pest'], 'SDA'], ['Eko Prasetyo', ['fogging', 'cleaning'], 'SBY', 'inactive'],
  ] },
  5: { skills: ['laundry', 'antar', 'carpet', 'sofa'], people: [
    ['Neneng Suryani', ['laundry'], 'BDG'], ['Asep Saepudin', ['antar', 'laundry'], 'BDG'], ['Euis Rahmawati', ['laundry', 'carpet'], 'BDG'],
    ['Dadang Hermawan', ['antar'], 'BDG'], ['Yayan Sopyan', ['carpet', 'sofa'], 'BDG'], ['Lilis Andriani', ['laundry'], 'BDG', 'inactive'],
  ] },
  6: { skills: ['cat', 'waterproofing', 'roof'], people: [
    ['Syamsul Bahri', ['cat', 'waterproofing'], 'BPN'], ['La Ode Rahman', ['cat'], 'BPN'], ['Andi Baso', ['waterproofing', 'roof'], 'BPN'],
    ['Ruslan Effendi', ['cat', 'roof'], 'BPN'], ['Jumadi', ['waterproofing'], 'BPN'], ['Muh. Arsyad', ['cat'], 'BPN', 'inactive'],
  ] },
  7: { skills: ['cleaning', 'mep', 'ac', 'electrical'], people: [
    ['Tim JKT-01 · Spv. Bambang Wijaya', ['cleaning', 'mep'], 'JKT'], ['Tim JKT-02 · Spv. Sri Wahyuni', ['cleaning'], 'JKB'],
    ['Tim BDG-01 · Spv. Ujang Kurnia', ['cleaning', 'ac'], 'BDG'], ['Tim SBY-01 · Spv. Heru Susanto', ['mep', 'electrical'], 'SBY'],
    ['Tim MDN-01 · Spv. Ilham Nasution', ['cleaning', 'mep'], 'MDN'],
  ] },
  8: { skills: ['cleaning', 'ob', 'gedung', 'electrical'], people: [
    ['Tim JKT-01 · Spv. Retno Wulandari', ['cleaning', 'ob'], 'JKP'], ['Tim JKT-02 · Spv. Fajar Ramadhan', ['gedung', 'electrical'], 'JKT'],
    ['Tim BDG-01 · Spv. Cecep Hidayat', ['cleaning', 'ob'], 'BDG'], ['Tim SBY-01 · Spv. Teguh Santoso', ['gedung'], 'SBY'],
    ['Tim BPN-01 · Spv. Fadli Hasan', ['cleaning', 'gedung'], 'BPN', 'inactive'],
  ] },
  9: { skills: ['hk-rs', 'cleaning', 'pest', 'fogging'], people: [
    ['Tim SBY-01 · Spv. Wahyu Nugroho', ['hk-rs', 'cleaning'], 'SBY'], ['Tim SBY-02 · Spv. Yani Mulyani', ['hk-rs'], 'SBY'],
    ['Tim JKT-01 · Spv. Gilang Permana', ['hk-rs', 'fogging'], 'JKT'], ['Tim MKS-01 · Spv. Haris Munandar', ['hk-rs', 'pest'], 'MKS'],
  ] },
}

const pad = (n, w = 4) => String(n).padStart(w, '0')

/** Rows for one demo account: { workers, skills } with fixed ids K×1,000,000 + n. */
export function demoWorkerRows(k) {
  const r = ROSTER[k]
  if (!r) return { workers: [], skills: [] }
  const owner = demoOwnerId(k)
  const workers = r.people.map(([name, skills, city, status = 'active'], i) => {
    const [label, lat, lng] = CITY[city]
    const n = i + 1
    // Small deterministic offset (≈1–3 km) so pins in one city don't overlap.
    const dLat = (((k * 7 + n * 13) % 11) - 5) * 0.0045
    const dLng = (((k * 5 + n * 17) % 11) - 5) * 0.0045
    return {
      id: k * 1_000_000 + n, owner_id: owner, name,
      phone: `0812-0000-${pad(k * 100 + n)}`,
      address: `${STREETS[(k + n) % STREETS.length]} No. ${10 + ((k * 3 + n * 7) % 80)} (contoh), ${label}`,
      skills, lat: Number((lat + dLat).toFixed(5)), lng: Number((lng + dLng).toFixed(5)), zone: label.split(',')[0],
      status, created_at: '2025-10-01T02:00:00.000Z',
    }
  })
  const skills = r.skills.map((key, i) => ({ id: k * 1_000_000 + 100 + i, owner_id: owner, key, name: SKILL_NAMES[key], created_at: '2025-10-01T02:00:00.000Z' }))
  return { workers, skills }
}

export const DEMO_KS = Object.keys(ROSTER).map(Number)

const sqlVal = (v) => (v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`)

/**
 * Idempotent SQL for the given accounts. Workers are upserted by id (never deleted,
 * so links from assignment_workers stay valid); skills are inserted only when the
 * key/name is free, so a business's own renamed skills are kept.
 */
export function demoWorkersSql(ks = DEMO_KS) {
  const out = []
  let rows = 0
  const W = ['id', 'owner_id', 'name', 'phone', 'address', 'skills', 'lat', 'lng', 'zone', 'status', 'created_at']
  const S = ['id', 'owner_id', 'key', 'name', 'created_at']
  for (const k of ks) {
    const { workers, skills } = demoWorkerRows(k)
    if (!workers.length) continue
    out.push(`-- ${demoOwnerId(k)}: ${workers.length} petugas, ${skills.length} keahlian`)
    out.push(`INSERT INTO workers (${W.join(', ')}) VALUES\n${workers.map((w) => `(${W.map((c) => sqlVal(c === 'skills' ? JSON.stringify(w.skills) : w[c])).join(', ')})`).join(',\n')}\nON CONFLICT(id) DO UPDATE SET name = excluded.name, phone = excluded.phone, address = excluded.address, skills = excluded.skills, lat = excluded.lat, lng = excluded.lng, zone = excluded.zone, status = excluded.status WHERE workers.owner_id = excluded.owner_id;`)
    out.push(`INSERT OR IGNORE INTO worker_skills (${S.join(', ')}) VALUES\n${skills.map((x) => `(${S.map((c) => sqlVal(x[c])).join(', ')})`).join(',\n')};`)
    rows += workers.length + skills.length
  }
  return { sql: out.join('\n'), rows }
}
