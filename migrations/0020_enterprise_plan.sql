-- Enterprise paket: everything in Pro plus an NDA (perjanjian kerahasiaan) and an SLA (uptime 99,9%,
-- dukungan maks. 4 jam kerja), Rp3.512.172 per bulan. Sold under contract, so cta_kind = 'contact'
-- (the card links to the contact form). Values mirror ENTERPRISE_PLAN in src/business/plan-rules.js;
-- tests/business-plans.test.mjs fails if the two drift apart.
--
-- No schema change: subscription_plans has no CHECK on slug (plan ids are data). INSERT OR IGNORE on the
-- unique slug keeps this safe on a database where staff already made an 'enterprise' paket by hand, and
-- sort puts it after every existing paket. Staff can edit or deactivate it in Kantor > Paket langganan.

INSERT OR IGNORE INTO subscription_plans
  (slug, name, tagline, price_idr, period, period_label, recommended, badge,
   limits_json, features_json, quota_json, cta_label, cta_kind, sort, active, updated_at, updated_by)
SELECT
  'enterprise',
  'Enterprise',
  'Untuk operasi jasa berskala besar yang butuh kerahasiaan dan jaminan layanan tertulis.',
  3512172,
  'month',
  'per bulan',
  0,
  'NDA + SLA',
  '[{"label":"Pengguna","value":"Tanpa batas"},{"label":"Transaksi","value":"Tanpa batas"},{"label":"Penawaran AI","value":"Tanpa batas"},{"label":"Laporan AI","value":"Tanpa batas"},{"label":"Pencari prospek","value":"500 pencarian per bulan"},{"label":"Penasihat AI","value":"2.500 pesan per bulan"}]',
  '["Semua fitur Pro","NDA: perjanjian kerahasiaan untuk data usaha Anda","SLA uptime layanan 99,9% per bulan","SLA respons dukungan maksimal 4 jam kerja","Kontrak dan tagihan atas nama perusahaan","Tidak termasuk saldo AI"]',
  '{"offer":null,"report":null,"leads":500,"radar":null,"advisor":2500,"social":null,"income":null}',
  'Hubungi kami',
  'contact',
  (SELECT COALESCE(MAX(sort), 0) + 1 FROM subscription_plans),
  1,
  '2026-11-05T00:00:00.000Z',
  'migration-0020';
