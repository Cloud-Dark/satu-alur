/**
 * Landing page pricing tiers.
 *
 * DRAFT — semua harga, batas transaksi, jumlah pengguna, dan fitur per paket
 * di bawah ini masih sementara dan menunggu keputusan skema bisnis.
 * Ubah nilai di sini saja; landing page merender kartu harga dari config ini.
 *
 * cta.variant: 'primary' | 'accent' | 'soft' (kelas tombol design system v2).
 */

import { ENTERPRISE_PLAN, formatPrice } from '../business/plan-rules.js'

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
    // Same numbers and wording as the Enterprise paket in the database (ENTERPRISE_PLAN).
    id: ENTERPRISE_PLAN.slug,
    name: ENTERPRISE_PLAN.name,
    tagline: ENTERPRISE_PLAN.tagline,
    price: formatPrice(ENTERPRISE_PLAN).price,
    period: formatPrice(ENTERPRISE_PLAN).period,
    recommended: false,
    badge: ENTERPRISE_PLAN.badge,
    limits: [
      { label: 'Transaksi', value: 'Tanpa batas' },
      { label: 'Pengguna', value: 'Tanpa batas' },
    ],
    features: [
      'Semua fitur UKM',
      ...ENTERPRISE_PLAN.features.filter((f) => /^(NDA|SLA)/.test(f)),
      'Integrasi ERP & migrasi data',
    ],
    quota: ENTERPRISE_PLAN.quota,
    // href null = contact CTA: the landing links it to #/kontak and the plan importer saves it as cta_kind 'contact'.
    cta: { label: ENTERPRISE_PLAN.cta_label, href: null, variant: 'primary' },
  },
]
