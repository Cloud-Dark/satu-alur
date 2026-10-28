/**
 * Landing page pricing tiers.
 *
 * DRAFT — semua harga, batas transaksi, jumlah pengguna, dan fitur per paket
 * di bawah ini masih sementara dan menunggu keputusan skema bisnis.
 * Ubah nilai di sini saja; landing page merender kartu harga dari config ini.
 *
 * cta.variant: 'primary' | 'accent' | 'soft' (kelas tombol design system v2).
 */

export const PRICING_NOTE = 'Harga draf — dapat berubah.'

export const PRICING_TIERS = [
  {
    id: 'sole-trader',
    name: 'Sole Trader',
    tagline: 'Untuk pemilik usaha jasa yang bekerja sendiri.',
    price: 'Rp0',
    period: 'Gratis 3 bulan',
    recommended: false,
    limits: [
      { label: 'Transaksi', value: 'Hingga 50 / bulan' },
      { label: 'Pengguna', value: '1 pengguna' },
    ],
    features: [
      'Enam tahap alur lengkap',
      'AI penawaran & laporan dasar',
      'Validasi aturan domain',
    ],
    cta: { label: 'Mulai gratis', href: '#/masuk', variant: 'soft' },
  },
  {
    id: 'ukm',
    name: 'UKM',
    tagline: 'Untuk tim jasa yang mulai bertumbuh.',
    price: 'Rp349rb',
    period: 'per bulan',
    recommended: true,
    badge: 'Rekomendasi',
    limits: [
      { label: 'Transaksi', value: 'Hingga 1.000 / bulan' },
      { label: 'Pengguna', value: '10 pengguna' },
    ],
    features: [
      'AI penuh untuk penawaran & laporan',
      'Agent Skill Editor (prompt AI kustom)',
      'Konektor WhatsApp & email',
      'Dukungan prioritas',
    ],
    cta: { label: 'Pilih UKM', href: '#/masuk', variant: 'accent' },
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    tagline: 'Untuk operasi jasa berskala besar.',
    price: 'Kustom',
    period: 'Hubungi kami',
    recommended: false,
    limits: [
      { label: 'Transaksi', value: 'Tanpa batas' },
      { label: 'Pengguna', value: 'Tanpa batas' },
    ],
    features: [
      'Forecasting & model data kustom',
      'SSO & integrasi sistem internal',
      'SLA & pendampingan implementasi',
    ],
    // Kontak penjualan belum tersedia: href null dirender sebagai placeholder.
    cta: { label: 'Hubungi kami', href: null, variant: 'primary' },
  },
]
