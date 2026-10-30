-- =====================================================================
-- Satu Alur: DATA CONTOH (DUMMY) untuk Kantor Satu Alur. Semua nama, email, telepon, dan angka FIKTIF.
-- Dibuat oleh scripts/seed-office.mjs. Jangan edit manual; ubah skripnya lalu jalankan ulang.
-- 103 baris; perkiraan D1 rows written <= 309 (termasuk entri indeks).
-- Butuh migrasi 0007_social_meta.sql dan 0008_quota_vouchers.sql. Aman dijalankan ulang (upsert dengan id/kunci tetap).
-- Tidak berisi akun staf atau kunci pembayaran. Buat staf dengan: npm run staff -- add <username>
-- =====================================================================

-- site_content: 5 baris
INSERT INTO site_content (key, value_json, updated_at, updated_by) VALUES
('landing', '{"hero":{"badge":"Untuk bisnis jasa di Indonesia · ditenagai AI","title":"Bisnis jasa Anda, *tumbuh* dalam satu alur.","subtitle":"Satu Alur menyatukan permintaan pelanggan, penawaran, penugasan, pembukuan, dan laporan dalam satu alur kerja. AI mengerjakan yang berulang; Anda fokus melayani dan bertumbuh.","points":["Masuk cukup dengan email (OTP)","Penawaran AI selalu divalidasi","Data aman di cloud"]},"faqs":[{"q":"Di mana data bisnis saya disimpan?","a":"Data disimpan di cloud yang aman. Setiap data terikat ke akun Anda, sehingga terpisah dari pengguna lain."},{"q":"Bagaimana cara masuk ke Satu Alur?","a":"Cukup dengan email. Kami mengirim kode sekali pakai (OTP) ke alamat Anda, jadi tidak ada kata sandi yang perlu diingat atau dibagikan."},{"q":"AI apa yang dipakai, dan apakah hasilnya bisa dipercaya?","a":"Penawaran dan penjelasan laporan dibuat AI dan tampil langsung saat ditulis, sehingga bisa Anda batalkan kapan saja. Hasil penawaran selalu melewati validasi aturan domain sebelum disimpan, dan keputusan akhir tetap di tangan Anda."},{"q":"Bisakah saya mengubah cara AI menulis penawaran?","a":"Bisa. Di Pengaturan tersedia Agent Skill Editor untuk mengubah prompt agen, temperature, batas token, dan preferensi model."},{"q":"Apa batasan paket gratis?","a":"Paket Free bisa dipakai tanpa batas waktu untuk 1 pengguna, dengan kuota AI kecil (3 penawaran AI, 3 penjelasan laporan, dan 3 pencarian prospek per bulan). Butuh lebih? Naik ke Lite atau Pro kapan saja. Harga paket tidak termasuk saldo AI."},{"q":"Apakah sudah terhubung dengan WhatsApp dan email?","a":"Belum. Konektor WhatsApp dan email ada di roadmap. Fondasi konektornya sudah tersedia di Pengaturan, dan akan diaktifkan setelah integrasinya siap."},{"q":"Apa beda paket dan saldo AI?","a":"Paket membuka fitur dan kuota bulanan. Saldo AI terpisah dan dipakai saat kuota AI paket habis. Voucher bisa berisi paket, saldo AI, atau keduanya."}]}', '2026-10-30T09:00:00.000Z', 'seed-office'),
('about', '{"title":"Tentang Satu Alur","body":"Satu Alur membantu bisnis jasa di Indonesia mengelola pekerjaan dari permintaan pelanggan sampai laporan keuangan dalam satu alur kerja.\n\n## Yang kami kerjakan\n\n- Mencatat permintaan pelanggan dan menyusun penawaran dengan bantuan AI.\n\n- Menjadwalkan petugas, menutup pekerjaan, dan membukukan pendapatan serta biaya.\n\n- Membaca angka bisnis Anda untuk menemukan peluang tumbuh: pelanggan rutin, prospek baru, dan konten media sosial.\n\n## Untuk siapa\n\nPemilik usaha jasa: servis AC, kebersihan, laundry, pest control, instalasi listrik, hingga penyedia jasa fasilitas untuk gedung dan rumah sakit.\n\n## Kontak\n\nKirim pesan lewat formulir Hubungi kami di halaman depan. Tim kami membalas di hari kerja."}', '2026-10-30T09:00:00.000Z', 'seed-office'),
('privacy', '{"title":"Kebijakan Privasi","body":"Draf contoh. Teks ini perlu ditinjau oleh penasihat hukum sebelum dipakai.\n\n## Data yang kami simpan\n\n- Email akun dan nama usaha.\n\n- Data operasional yang Anda masukkan: permintaan, penawaran, penugasan, pembukuan, dan laporan.\n\n- Pesan yang Anda kirim ke tim bantuan.\n\n## Cara kami memakainya\n\nData dipakai untuk menjalankan layanan Satu Alur bagi akun Anda. Data setiap akun terpisah dari akun lain. Kami tidak menjual data Anda.\n\n## AI\n\nSaat Anda memakai fitur AI, potongan data yang relevan dikirim ke model AI untuk menghasilkan jawaban. Hasilnya bisa Anda edit atau buang.\n\n## Hak Anda\n\n- Meminta salinan data akun Anda.\n\n- Meminta penghapusan akun beserta datanya.\n\nAjukan permintaan lewat menu Bantuan di aplikasi."}', '2026-10-30T09:00:00.000Z', 'seed-office'),
('terms', '{"title":"Syarat & Ketentuan","body":"Draf contoh. Teks ini perlu ditinjau oleh penasihat hukum sebelum dipakai.\n\n## Akun\n\nAnda bertanggung jawab atas aktivitas di akun Anda dan kebenaran data yang dimasukkan.\n\n## Paket dan pembayaran\n\n- Paket Free tersedia tanpa biaya dengan kuota terbatas.\n\n- Paket berbayar ditagih di muka per periode dan dapat dihentikan kapan saja; layanan berjalan sampai akhir periode.\n\n- Harga paket tidak termasuk saldo AI.\n\n## Penggunaan AI\n\nHasil AI adalah bantuan, bukan nasihat profesional. Periksa harga, syarat, dan isi penawaran sebelum dikirim ke pelanggan.\n\n## Penghentian\n\nKami dapat menangguhkan akun yang melanggar hukum atau menyalahgunakan layanan, setelah pemberitahuan bila memungkinkan."}', '2026-10-30T09:00:00.000Z', 'seed-office'),
('cookies', '{"title":"Kebijakan Cookie","body":"Draf contoh. Teks ini perlu ditinjau oleh penasihat hukum sebelum dipakai.\n\n## Yang kami simpan di perangkat\n\n- Token sesi agar Anda tetap masuk.\n\n- Preferensi tampilan, misalnya tema terang atau gelap.\n\n- Riwayat pencarian prospek dan percakapan penasihat AI, agar tidak hilang saat pindah halaman.\n\nKami tidak memakai cookie iklan pihak ketiga."}', '2026-10-30T09:00:00.000Z', 'seed-office')
ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at, updated_by = excluded.updated_by;

-- subscription_plans: 3 baris
INSERT INTO subscription_plans (slug, name, tagline, price_idr, period, period_label, recommended, badge, limits_json, features_json, quota_json, cta_label, cta_kind, sort, active, updated_at, updated_by) VALUES
('free', 'Free', 'Coba seluruh alur kerja tanpa biaya, dengan kuota AI kecil.', 0, 'month', 'selamanya', 0, '', '[{"label":"Pengguna","value":"1 orang"},{"label":"Transaksi","value":"50 per bulan"},{"label":"Penawaran AI","value":"10 per bulan"},{"label":"Laporan AI","value":"10 per bulan"},{"label":"Pencari prospek","value":"10 pencarian per bulan"},{"label":"Penasihat AI","value":"5 pesan per bulan"}]', '["Alur kerja 6 tahap lengkap","Radar peluang (ringkasan)","Media sosial: tulis konten manual","Data aman di cloud","Tidak termasuk saldo AI"]', '{"offer":10,"report":10,"leads":10,"radar":10,"advisor":5,"social":10}', 'Mulai gratis', 'signup', 1, 1, '2026-10-30T09:00:00.000Z', 'seed-office'),
('lite', 'Lite', 'Untuk usaha jasa yang mulai rutin menerima pesanan.', 99000, 'month', 'per bulan', 0, '', '[{"label":"Pengguna","value":"3 orang"},{"label":"Transaksi","value":"300 per bulan"},{"label":"Penawaran AI","value":"50 per bulan"},{"label":"Laporan AI","value":"20 per bulan"},{"label":"Pencari prospek","value":"20 pencarian per bulan"},{"label":"Penasihat AI","value":"100 pesan per bulan"}]', '["Semua fitur Free","Radar peluang lengkap","Jadwal konten media sosial","Kelola petugas lapangan","Ekspor laporan","Tidak termasuk saldo AI"]', '{"offer":50,"report":20,"leads":20,"radar":30,"advisor":100,"social":60}', 'Pilih Lite', 'signup', 2, 1, '2026-10-30T09:00:00.000Z', 'seed-office'),
('pro', 'Pro', 'Alur kerja tanpa batas untuk tim yang sedang tumbuh.', 249000, 'month', 'per bulan', 1, 'Paling populer', '[{"label":"Pengguna","value":"10 orang"},{"label":"Transaksi","value":"Tanpa batas"},{"label":"Penawaran AI","value":"Tanpa batas"},{"label":"Laporan AI","value":"Tanpa batas"},{"label":"Pencari prospek","value":"100 pencarian per bulan"},{"label":"Penasihat AI","value":"500 pesan per bulan"}]', '["Semua fitur Lite","Publikasi ke Facebook, Instagram, dan Threads","Permintaan kolaborasi influencer","Permintaan iklan Meta","Prioritas bantuan","Tidak termasuk saldo AI"]', '{"offer":null,"report":null,"leads":100,"radar":null,"advisor":500,"social":null}', 'Pilih Pro', 'signup', 3, 1, '2026-10-30T09:00:00.000Z', 'seed-office')
ON CONFLICT(slug) DO UPDATE SET name = excluded.name, tagline = excluded.tagline, price_idr = excluded.price_idr, period = excluded.period, period_label = excluded.period_label, recommended = excluded.recommended, badge = excluded.badge, limits_json = excluded.limits_json, features_json = excluded.features_json, quota_json = excluded.quota_json, cta_label = excluded.cta_label, cta_kind = excluded.cta_kind, sort = excluded.sort, active = excluded.active, updated_at = excluded.updated_at, updated_by = excluded.updated_by;

-- payment_settings: 1 baris
INSERT INTO payment_settings (id, provider, mode, client_key, server_key_enc, server_key_last4, webhook_token_enc, updated_at, updated_by) VALUES
(1, 'none', 'sandbox', '', NULL, '', NULL, '2026-10-30T09:00:00.000Z', 'seed-office')
ON CONFLICT(id) DO UPDATE SET provider = excluded.provider, mode = excluded.mode, client_key = excluded.client_key, server_key_enc = excluded.server_key_enc, server_key_last4 = excluded.server_key_last4, webhook_token_enc = excluded.webhook_token_enc, updated_at = excluded.updated_at, updated_by = excluded.updated_by;

-- users: 13 baris (demo + pendaftar contoh; baris yang sudah ada tidak diubah)
INSERT OR IGNORE INTO users (id, email, name, created_at) VALUES
('0d3e5a11-7c1a-4b5e-9a01-5a7a1a1d0001', 'demo-ac@satualur.id', 'Budi Santoso (Servis AC)', '2025-10-01T02:00:00.000Z'),
('0d3e5a11-7c1a-4b5e-9a02-5a7a1a1d0002', 'demo-cleaning@satualur.id', 'Rina Kusuma (Rapi Bersih Home Cleaning)', '2025-10-01T02:00:00.000Z'),
('0d3e5a11-7c1a-4b5e-9a03-5a7a1a1d0003', 'demo-listrik@satualur.id', 'Hendra Siregar (Listrik Siaga Medan)', '2025-10-01T02:00:00.000Z'),
('0d3e5a11-7c1a-4b5e-9a04-5a7a1a1d0004', 'demo-pest@satualur.id', 'CV Basmi Hama Nusantara', '2025-10-01T02:00:00.000Z'),
('0d3e5a11-7c1a-4b5e-9a05-5a7a1a1d0005', 'demo-laundry@satualur.id', 'CV Wangi Bersih Laundry', '2025-10-01T02:00:00.000Z'),
('0d3e5a11-7c1a-4b5e-9a06-5a7a1a1d0006', 'demo-dinding@satualur.id', 'CV Glasur Dinding Borneo', '2025-10-01T02:00:00.000Z'),
('0d3e5a11-7c1a-4b5e-9a07-5a7a1a1d0007', 'demo-mall@satualur.id', 'PT Arunika Layanan Ritel', '2025-10-01T02:00:00.000Z'),
('0d3e5a11-7c1a-4b5e-9a08-5a7a1a1d0008', 'demo-fm@satualur.id', 'PT Prima Layanan Fasilitas', '2025-10-01T02:00:00.000Z'),
('0d3e5a11-7c1a-4b5e-9a09-5a7a1a1d0009', 'demo-rs@satualur.id', 'PT Sehat Bersih Medika', '2025-10-01T02:00:00.000Z'),
('5eed0ff1-0000-4000-8000-000000000001', 'sari.laundrykiloan@contoh.satualur.id', 'Sari Laundry Kiloan', '2026-10-18T02:00:00.000Z'),
('5eed0ff1-0000-4000-8000-000000000002', 'agus.servispompa@contoh.satualur.id', 'Agus Servis Pompa Air', '2026-10-21T02:00:00.000Z'),
('5eed0ff1-0000-4000-8000-000000000003', 'dewi.cucisofa@contoh.satualur.id', 'Dewi Cuci Sofa & Karpet', '2026-10-25T02:00:00.000Z'),
('5eed0ff1-0000-4000-8000-000000000004', 'bengkel.lasprima@contoh.satualur.id', 'Las & Kanopi Prima', '2026-10-28T02:00:00.000Z');

-- customer_accounts: 12 baris
INSERT INTO customer_accounts (owner_id, plan_id, status, period_end, company, phone, notes, updated_at, updated_by) VALUES
((SELECT id FROM users WHERE email = 'demo-ac@satualur.id'), (SELECT id FROM subscription_plans WHERE slug = 'free'), 'active', NULL, 'Servis AC Budi', '0812-1000-0001', 'Akun demo. Aktif tiap hari, tertarik naik ke Lite.', '2026-10-30T09:00:00.000Z', 'seed-office'),
((SELECT id FROM users WHERE email = 'demo-cleaning@satualur.id'), (SELECT id FROM subscription_plans WHERE slug = 'lite'), 'active', '2026-11-22', 'Rapi Bersih Home Cleaning', '0812-1000-0002', 'Akun demo. Memakai jadwal konten tiap minggu.', '2026-10-30T09:00:00.000Z', 'seed-office'),
((SELECT id FROM users WHERE email = 'demo-listrik@satualur.id'), (SELECT id FROM subscription_plans WHERE slug = 'lite'), 'trial', '2026-11-08', 'Listrik Siaga Medan', '0812-1000-0003', 'Akun demo. Trial Lite 14 hari.', '2026-10-30T09:00:00.000Z', 'seed-office'),
((SELECT id FROM users WHERE email = 'demo-pest@satualur.id'), (SELECT id FROM subscription_plans WHERE slug = 'pro'), 'active', '2026-11-16', 'CV Basmi Hama Nusantara', '031-5550-0004', 'Akun demo. Minta kolaborasi influencer (lihat Permintaan).', '2026-10-30T09:00:00.000Z', 'seed-office'),
((SELECT id FROM users WHERE email = 'demo-laundry@satualur.id'), (SELECT id FROM subscription_plans WHERE slug = 'lite'), 'past_due', '2026-10-27', 'CV Wangi Bersih Laundry', '022-5550-0005', 'Akun demo. Tagihan Oktober belum dibayar; sudah diingatkan via email.', '2026-10-30T09:00:00.000Z', 'seed-office'),
((SELECT id FROM users WHERE email = 'demo-dinding@satualur.id'), (SELECT id FROM subscription_plans WHERE slug = 'lite'), 'active', '2026-11-11', 'CV Glasur Dinding Borneo', '0542-555-0006', 'Akun demo.', '2026-10-30T09:00:00.000Z', 'seed-office'),
((SELECT id FROM users WHERE email = 'demo-mall@satualur.id'), (SELECT id FROM subscription_plans WHERE slug = 'pro'), 'active', '2026-11-27', 'PT Arunika Layanan Ritel', '021-5550-0007', 'Akun demo. Enterprise; minta penawaran kustom untuk 12 cabang.', '2026-10-30T09:00:00.000Z', 'seed-office'),
((SELECT id FROM users WHERE email = 'demo-fm@satualur.id'), (SELECT id FROM subscription_plans WHERE slug = 'pro'), 'active', '2026-11-04', 'PT Prima Layanan Fasilitas', '021-5550-0008', 'Akun demo. Perpanjangan tahunan sedang dibahas.', '2026-10-30T09:00:00.000Z', 'seed-office'),
((SELECT id FROM users WHERE email = 'demo-rs@satualur.id'), (SELECT id FROM subscription_plans WHERE slug = 'pro'), 'trial', '2026-11-10', 'PT Sehat Bersih Medika', '021-5550-0009', 'Akun demo. Trial Pro; jadwalkan demo dengan tim housekeeping.', '2026-10-30T09:00:00.000Z', 'seed-office'),
((SELECT id FROM users WHERE email = 'sari.laundrykiloan@contoh.satualur.id'), (SELECT id FROM subscription_plans WHERE slug = 'free'), 'active', NULL, 'Sari Laundry Kiloan', '0857-2000-0001', 'Daftar dari soft launch. Belum pernah membuat penawaran.', '2026-10-30T09:00:00.000Z', 'seed-office'),
((SELECT id FROM users WHERE email = 'agus.servispompa@contoh.satualur.id'), (SELECT id FROM subscription_plans WHERE slug = 'lite'), 'cancelled', '2026-10-24', 'Agus Servis Pompa Air', '0857-2000-0002', 'Berhenti: musim sepi. Tawarkan voucher bila kembali.', '2026-10-30T09:00:00.000Z', 'seed-office'),
((SELECT id FROM users WHERE email = 'dewi.cucisofa@contoh.satualur.id'), (SELECT id FROM subscription_plans WHERE slug = 'lite'), 'active', '2026-11-26', 'Dewi Cuci Sofa & Karpet', '0857-2000-0003', 'Lite 30 hari dari voucher SATU-COMBO (soft launch).', '2026-10-30T09:00:00.000Z', 'seed-office')
ON CONFLICT(owner_id) DO UPDATE SET plan_id = excluded.plan_id, status = excluded.status, period_end = excluded.period_end, company = excluded.company, phone = excluded.phone, notes = excluded.notes, updated_at = excluded.updated_at, updated_by = excluded.updated_by;

-- user_flags: 1 baris
INSERT INTO user_flags (user_id, suspended, reason, updated_at, updated_by) VALUES
((SELECT id FROM users WHERE email = 'bengkel.lasprima@contoh.satualur.id'), 1, 'Contoh: mendaftar dengan data usaha palsu dan mengirim spam lewat formulir kontak.', '2026-10-30T09:00:00.000Z', 'seed-office')
ON CONFLICT(user_id) DO UPDATE SET suspended = excluded.suspended, reason = excluded.reason, updated_at = excluded.updated_at, updated_by = excluded.updated_by;

-- contact_messages: 6 baris
INSERT INTO contact_messages (id, name, email, phone, subject, message, status, staff_note, ip_hash, created_at, updated_at, updated_by) VALUES
(9001, 'Rudi Hartono', 'rudi.hartono@contoh.id', '0813-3000-1001', 'Harga untuk 5 cabang laundry', 'Halo, saya punya 5 cabang laundry di Depok. Apakah ada paket untuk banyak cabang dan bisa dibayar tahunan?', 'new', '', 'seed-office-9001', '2026-10-30T03:00:00.000Z', NULL, NULL),
(9002, 'Maya Lestari', 'maya@contoh.id', '', 'Bisa dipakai untuk jasa catering?', 'Usaha saya catering harian. Apakah alur permintaan sampai laporan cocok untuk pesanan nasi kotak?', 'new', '', 'seed-office-9002', '2026-10-29T03:00:00.000Z', NULL, NULL),
(9003, 'Yusuf Pratama', 'yusuf.p@contoh.id', '0821-3000-1003', 'Integrasi WhatsApp', 'Apakah penawaran bisa langsung dikirim ke WhatsApp pelanggan?', 'read', 'Belum tersedia; masuk roadmap konektor.', 'seed-office-9003', '2026-10-28T03:00:00.000Z', '2026-10-29T07:00:00.000Z', 'seed-office'),
(9004, 'Lina Wijaya', 'lina.w@contoh.id', '0817-3000-1004', 'Demo untuk tim', 'Kami tim facility management 40 orang. Boleh jadwalkan demo minggu depan?', 'replied', 'Demo dijadwalkan Selasa 10.00 via Meet.', 'seed-office-9004', '2026-10-26T03:00:00.000Z', '2026-10-27T07:00:00.000Z', 'seed-office'),
(9005, 'Andi Saputra', 'andi.s@contoh.id', '', 'Voucher soft launch', 'Saya dapat voucher di acara soft launch, cara menukarnya bagaimana?', 'replied', 'Dikirim panduan tukar voucher.', 'seed-office-9005', '2026-10-24T03:00:00.000Z', '2026-10-25T07:00:00.000Z', 'seed-office'),
(9006, 'Promo SEO Murah', 'promo@contoh.id', '', 'Jasa backlink', 'Kami menawarkan 1000 backlink murah untuk website Anda.', 'archived', 'Spam.', 'seed-office-9006', '2026-10-21T03:00:00.000Z', '2026-10-22T07:00:00.000Z', 'seed-office')
ON CONFLICT(id) DO UPDATE SET name = excluded.name, email = excluded.email, phone = excluded.phone, subject = excluded.subject, message = excluded.message, status = excluded.status, staff_note = excluded.staff_note, ip_hash = excluded.ip_hash, created_at = excluded.created_at, updated_at = excluded.updated_at, updated_by = excluded.updated_by;

-- support_tickets: 5 baris
INSERT INTO support_tickets (id, owner_id, category, subject, status, created_at, updated_at, last_reply_by) VALUES
(8001, (SELECT id FROM users WHERE email = 'demo-laundry@satualur.id'), 'tagihan', 'Tagihan Oktober belum tercatat', 'in_progress', '2026-10-27T02:00:00.000Z', '2026-10-29T08:00:00.000Z', 'customer'),
(8002, (SELECT id FROM users WHERE email = 'demo-ac@satualur.id'), 'teknis', 'Pencari prospek lama memuat', 'resolved', '2026-10-25T02:00:00.000Z', '2026-10-26T08:00:00.000Z', 'staff'),
(8003, (SELECT id FROM users WHERE email = 'demo-rs@satualur.id'), 'akun', 'Tambah pengguna untuk supervisor', 'open', '2026-10-29T02:00:00.000Z', '2026-10-29T08:00:00.000Z', 'customer'),
(8004, (SELECT id FROM users WHERE email = 'demo-cleaning@satualur.id'), 'lainnya', 'Permintaan fitur cetak invoice', 'open', '2026-10-28T02:00:00.000Z', '2026-10-29T08:00:00.000Z', 'staff'),
(8005, (SELECT id FROM users WHERE email = 'dewi.cucisofa@contoh.satualur.id'), 'akun', 'Cara tukar voucher', 'closed', '2026-10-22T02:00:00.000Z', '2026-10-23T08:00:00.000Z', 'staff')
ON CONFLICT(id) DO UPDATE SET owner_id = excluded.owner_id, category = excluded.category, subject = excluded.subject, status = excluded.status, created_at = excluded.created_at, updated_at = excluded.updated_at, last_reply_by = excluded.last_reply_by;

-- support_messages: 10 baris
INSERT INTO support_messages (id, ticket_id, author, author_name, body, created_at) VALUES
(80001, 8001, 'customer', 'CV Wangi Bersih Laundry', 'Kami sudah transfer tanggal 27, tapi status masih menunggak.', '2026-10-27T02:00:00.000Z'),
(80002, 8001, 'staff', 'Tim Satu Alur', 'Terima kasih. Mohon kirim bukti transfer, kami cek ke bank.', '2026-10-28T08:00:00.000Z'),
(80003, 8001, 'customer', 'CV Wangi Bersih Laundry', 'Sudah kami lampirkan di email ke tim bantuan.', '2026-10-29T08:00:00.000Z'),
(80004, 8002, 'customer', 'Budi Santoso', 'Pencarian di Bekasi muter terus.', '2026-10-25T02:00:00.000Z'),
(80005, 8002, 'staff', 'Tim Satu Alur', 'Sudah kami perbaiki; pencarian kini jalan di belakang layar. Silakan coba lagi.', '2026-10-26T08:00:00.000Z'),
(80006, 8003, 'customer', 'PT Sehat Bersih Medika', 'Kami butuh 3 akun tambahan untuk supervisor per rumah sakit.', '2026-10-29T02:00:00.000Z'),
(80007, 8004, 'customer', 'Rina Kusuma', 'Bisa ada tombol cetak invoice PDF dari penawaran?', '2026-10-28T02:00:00.000Z'),
(80008, 8004, 'staff', 'Tim Satu Alur', 'Ide bagus, kami catat untuk roadmap.', '2026-10-29T08:00:00.000Z'),
(80009, 8005, 'customer', 'Dewi', 'Voucher dari acara soft launch dimasukkan di mana?', '2026-10-22T02:00:00.000Z'),
(80010, 8005, 'staff', 'Tim Satu Alur', 'Sudah kami aktifkan trial Lite di akun Ibu. Terima kasih!', '2026-10-23T08:00:00.000Z')
ON CONFLICT(id) DO UPDATE SET ticket_id = excluded.ticket_id, author = excluded.author, author_name = excluded.author_name, body = excluded.body, created_at = excluded.created_at;

-- influencers: 10 baris
INSERT INTO influencers (id, name, photo_key, niche, city, ig_followers, tiktok_followers, bio, visible, handle_ig, handle_tiktok, handle_youtube, contact_phone, contact_email, rates_json, internal_notes, created_at) VALUES
(7001, 'Nadia Rumah Rapi', NULL, 'Rumah tangga & kebersihan', 'Jakarta', 48200, 61500, 'Tips beres-beres rumah kecil dan kos. Audiens ibu muda 25–34.', 1, 'nadiarumahrapi', 'nadiarumahrapi', '', '0811-7000-7001', 'nadiarumahrapi@contoh.id', '[{"deliverable":"Feed Instagram","price_idr":1500000},{"deliverable":"Reel Instagram","price_idr":2500000},{"deliverable":"Story (3 frame)","price_idr":750000},{"deliverable":"Video TikTok","price_idr":2200000}]', 'Respons cepat. Minta brief 5 hari sebelum tayang.', '2026-10-11T04:00:00.000Z'),
(7002, 'Kang Dadang Teknik', NULL, 'Servis & DIY', 'Bandung', 22800, 104000, 'Video servis AC, pompa air, dan listrik rumah dengan bahasa Sunda santai.', 1, 'kangdadangteknik', 'kangdadang.teknik', 'KangDadangTeknik', '0811-7000-7002', 'kangdadangteknik@contoh.id', '[{"deliverable":"Feed Instagram","price_idr":900000},{"deliverable":"Reel Instagram","price_idr":1800000},{"deliverable":"Story (3 frame)","price_idr":500000},{"deliverable":"Video TikTok","price_idr":2000000}]', 'Paling cocok untuk servis AC dan listrik.', '2026-10-12T04:00:00.000Z'),
(7003, 'Mbak Laundry Kece', NULL, 'Laundry & fashion care', 'Surabaya', 15400, 38900, 'Cara merawat pakaian, review laundry kiloan.', 1, 'mbaklaundrykece', 'mbaklaundrykece', '', '0811-7000-7003', 'mbaklaundrykece@contoh.id', '[{"deliverable":"Feed Instagram","price_idr":600000},{"deliverable":"Reel Instagram","price_idr":1100000},{"deliverable":"Story (3 frame)","price_idr":350000},{"deliverable":"Video TikTok","price_idr":1000000}]', '', '2026-10-13T04:00:00.000Z'),
(7004, 'Ardi Properti', NULL, 'Properti & renovasi', 'Tangerang', 87300, 52100, 'Renovasi rumah subsidi, cat dinding, kanopi.', 1, 'ardiproperti', 'ardi.properti', 'ArdiProperti', '0811-7000-7004', 'ardiproperti@contoh.id', '[{"deliverable":"Feed Instagram","price_idr":3000000},{"deliverable":"Reel Instagram","price_idr":4500000},{"deliverable":"Story (3 frame)","price_idr":1200000},{"deliverable":"Video TikTok","price_idr":3500000}]', 'Harga bisa nego untuk paket 3 konten.', '2026-10-14T04:00:00.000Z'),
(7005, 'Sasa Mom Life', NULL, 'Parenting & rumah', 'Depok', 132000, 88400, 'Keseharian ibu bekerja; sering bahas jasa bersih rumah dan pest control.', 1, 'sasamomlife', 'sasamomlife', '', '0811-7000-7005', 'sasamomlife@contoh.id', '[{"deliverable":"Feed Instagram","price_idr":4500000},{"deliverable":"Reel Instagram","price_idr":6500000},{"deliverable":"Story (3 frame)","price_idr":1800000},{"deliverable":"Video TikTok","price_idr":5000000}]', 'Wajib kontrak tertulis.', '2026-10-15T04:00:00.000Z'),
(7006, 'Medan Kuliner & Usaha', NULL, 'UMKM lokal', 'Medan', 41000, 27600, 'Liputan usaha lokal Medan.', 1, 'medanusaha', '', '', '0811-7000-7006', 'medanusaha@contoh.id', '[{"deliverable":"Feed Instagram","price_idr":800000},{"deliverable":"Reel Instagram","price_idr":1500000},{"deliverable":"Story (3 frame)","price_idr":400000}]', '', '2026-10-16T04:00:00.000Z'),
(7007, 'Bersih Bareng Rio', NULL, 'Kebersihan & deep cleaning', 'Makassar', 9800, 71200, 'Video before–after deep cleaning yang viral di TikTok.', 1, 'bersihbarengrio', 'bersihbarengrio', '', '0811-7000-7007', 'bersihbarengrio@contoh.id', '[{"deliverable":"Feed Instagram","price_idr":500000},{"deliverable":"Reel Instagram","price_idr":900000},{"deliverable":"Story (3 frame)","price_idr":250000},{"deliverable":"Video TikTok","price_idr":1300000}]', 'Mikro influencer, engagement tinggi.', '2026-10-17T04:00:00.000Z'),
(7008, 'Dokter Gedung', NULL, 'Facility management', 'Jakarta', 18600, 6400, 'Edukasi perawatan gedung kantor dan rumah sakit untuk audiens B2B.', 1, 'doktergedung', '', 'DokterGedung', '0811-7000-7008', 'doktergedung@contoh.id', '[{"deliverable":"Feed Instagram","price_idr":2000000},{"deliverable":"Reel Instagram","price_idr":3000000}]', 'Cocok untuk klien enterprise (FM, RS).', '2026-10-18T04:00:00.000Z'),
(7009, 'Borneo Living', NULL, 'Gaya hidup Kalimantan', 'Balikpapan', 27500, 19300, 'Rumah, kuliner, dan usaha di Balikpapan–Samarinda.', 1, 'borneoliving', 'borneoliving', '', '0811-7000-7009', 'borneoliving@contoh.id', '[{"deliverable":"Feed Instagram","price_idr":700000},{"deliverable":"Reel Instagram","price_idr":1300000},{"deliverable":"Story (3 frame)","price_idr":350000},{"deliverable":"Video TikTok","price_idr":1100000}]', '', '2026-10-19T04:00:00.000Z'),
(7010, 'Raka Review Jasa', NULL, 'Review jasa', 'Yogyakarta', 56000, 143000, 'Mencoba dan mereview jasa rumah tangga secara jujur.', 0, 'rakareviewjasa', 'rakareviewjasa', 'RakaReviewJasa', '0811-7000-7010', 'rakareviewjasa@contoh.id', '[{"deliverable":"Feed Instagram","price_idr":2500000},{"deliverable":"Reel Instagram","price_idr":3800000},{"deliverable":"Story (3 frame)","price_idr":900000},{"deliverable":"Video TikTok","price_idr":3200000}]', 'Sedang cuti sampai akhir November.', '2026-10-20T04:00:00.000Z')
ON CONFLICT(id) DO UPDATE SET name = excluded.name, photo_key = excluded.photo_key, niche = excluded.niche, city = excluded.city, ig_followers = excluded.ig_followers, tiktok_followers = excluded.tiktok_followers, bio = excluded.bio, visible = excluded.visible, handle_ig = excluded.handle_ig, handle_tiktok = excluded.handle_tiktok, handle_youtube = excluded.handle_youtube, contact_phone = excluded.contact_phone, contact_email = excluded.contact_email, rates_json = excluded.rates_json, internal_notes = excluded.internal_notes, created_at = excluded.created_at;

-- service_requests: 8 baris
INSERT INTO service_requests (id, owner_id, kind, influencer_id, payload_json, status, admin_note, created_at, updated_at) VALUES
(6001, (SELECT id FROM users WHERE email = 'demo-pest@satualur.id'), 'collab', 7005, '{"campaign":"Kampanye musim hujan: kenalkan layanan anti rayap rumah di Surabaya–Sidoarjo. Ingin video before–after di rumah klien.","budget_range":"Rp5–10 juta","timing":"November 2026"}', 'in_progress', 'Kampanye dibuat; menunggu konten pertama.', '2026-10-18T03:00:00.000Z', '2026-10-19T09:00:00.000Z'),
(6002, (SELECT id FROM users WHERE email = 'demo-cleaning@satualur.id'), 'collab', 7007, '{"campaign":"Promo langganan bersih rumah mingguan untuk kos-kosan di Makassar.","budget_range":"Rp1–3 juta","timing":"Minggu ke-2 November"}', 'in_progress', 'Brief terkirim ke Rio.', '2026-10-24T03:00:00.000Z', '2026-10-25T09:00:00.000Z'),
(6003, (SELECT id FROM users WHERE email = 'demo-ac@satualur.id'), 'collab', 7002, '{"campaign":"Servis AC cuci + isi freon menjelang musim panas, area Bekasi.","budget_range":"Rp1–3 juta","timing":"Desember 2026"}', 'new', '', '2026-10-29T03:00:00.000Z', '2026-10-30T09:00:00.000Z'),
(6004, (SELECT id FROM users WHERE email = 'demo-fm@satualur.id'), 'collab', 7008, '{"campaign":"Edukasi B2B: perawatan gedung kantor BUMN, target manajer gedung di LinkedIn & Instagram.","budget_range":"Rp10–25 juta","timing":"Q1 2027"}', 'done', 'Kampanye selesai, 2 konten tayang.', '2026-09-20T03:00:00.000Z', '2026-09-21T09:00:00.000Z'),
(6005, (SELECT id FROM users WHERE email = 'demo-laundry@satualur.id'), 'ads', NULL, '{"service":"Laundry kiloan antar-jemput","location":"Bandung","daily_budget":75000,"duration_days":14,"goal":"messages","notes":"Target ibu rumah tangga radius 5 km dari 3 outlet."}', 'new', '', '2026-10-30T03:00:00.000Z', '2026-10-30T09:00:00.000Z'),
(6006, (SELECT id FROM users WHERE email = 'demo-dinding@satualur.id'), 'ads', NULL, '{"service":"Cat ulang dinding rumah","location":"Balikpapan","daily_budget":50000,"duration_days":30,"goal":"leads","notes":""}', 'in_progress', 'Iklan disiapkan, menunggu materi foto.', '2026-10-26T03:00:00.000Z', '2026-10-27T09:00:00.000Z'),
(6007, (SELECT id FROM users WHERE email = 'demo-mall@satualur.id'), 'ads', NULL, '{"service":"Jasa kebersihan tenant mal","location":"Jakarta, Bandung, Surabaya","daily_budget":300000,"duration_days":21,"goal":"awareness","notes":"Kampanye rekrutmen mitra tenant."}', 'done', 'Iklan berjalan 21 hari, laporan dikirim.', '2026-09-25T03:00:00.000Z', '2026-09-26T09:00:00.000Z'),
(6008, (SELECT id FROM users WHERE email = 'demo-rs@satualur.id'), 'ads', NULL, '{"service":"Housekeeping rumah sakit & klinik","location":"Jabodetabek","daily_budget":150000,"duration_days":14,"goal":"traffic","notes":"Arahkan ke halaman profil perusahaan."}', 'new', '', '2026-10-28T03:00:00.000Z', '2026-10-29T09:00:00.000Z')
ON CONFLICT(id) DO UPDATE SET owner_id = excluded.owner_id, kind = excluded.kind, influencer_id = excluded.influencer_id, payload_json = excluded.payload_json, status = excluded.status, admin_note = excluded.admin_note, created_at = excluded.created_at, updated_at = excluded.updated_at;

-- campaigns: 3 baris
INSERT INTO campaigns (id, request_id, owner_id, title, brief, status, start_date, end_date, client_fee_idr, created_at, updated_at, updated_by) VALUES
(5001, 6001, (SELECT id FROM users WHERE email = 'demo-pest@satualur.id'), 'Anti rayap musim hujan — Surabaya', 'Dua video before–after di rumah klien dan satu story ajakan konsultasi gratis. Sebutkan garansi 1 tahun.', 'active', '2026-10-20', '2026-11-19', 9500000, '2026-10-18T06:00:00.000Z', '2026-10-20T06:00:00.000Z', 'seed-office'),
(5002, 6002, (SELECT id FROM users WHERE email = 'demo-cleaning@satualur.id'), 'Langganan bersih kos — Makassar', 'Video TikTok kunjungan bersih kamar kos 60 detik + kode promo KOSRAPI.', 'active', '2026-10-25', '2026-11-14', 2200000, '2026-10-24T06:00:00.000Z', '2026-10-26T06:00:00.000Z', 'seed-office'),
(5003, 6004, (SELECT id FROM users WHERE email = 'demo-fm@satualur.id'), 'Edukasi perawatan gedung — B2B', 'Seri edukasi perawatan gedung untuk manajer gedung.', 'completed', '2026-09-22', '2026-10-22', 6000000, '2026-09-20T06:00:00.000Z', '2026-09-22T06:00:00.000Z', 'seed-office')
ON CONFLICT(id) DO UPDATE SET request_id = excluded.request_id, owner_id = excluded.owner_id, title = excluded.title, brief = excluded.brief, status = excluded.status, start_date = excluded.start_date, end_date = excluded.end_date, client_fee_idr = excluded.client_fee_idr, created_at = excluded.created_at, updated_at = excluded.updated_at, updated_by = excluded.updated_by;

-- campaign_influencers: 4 baris
INSERT INTO campaign_influencers (campaign_id, influencer_id, payout_idr) VALUES
(5001, 7005, 6500000),
(5001, 7003, 1100000),
(5002, 7007, 1300000),
(5003, 7008, 5000000)
ON CONFLICT(campaign_id, influencer_id) DO UPDATE SET payout_idr = excluded.payout_idr;

-- campaign_deliverables: 6 baris
INSERT INTO campaign_deliverables (id, campaign_id, influencer_id, kind, due_date, status, link, note, updated_at, updated_by) VALUES
(50001, 5001, 7005, 'reel', '2026-11-02', 'in_progress', NULL, 'Syuting di Sidoarjo hari Sabtu.', '2026-10-30T09:00:00.000Z', 'seed-office'),
(50002, 5001, 7005, 'story', '2026-11-04', 'planned', NULL, '', '2026-10-30T09:00:00.000Z', 'seed-office'),
(50003, 5001, 7003, 'reel', '2026-10-29', 'published', 'https://www.instagram.com/reel/contoh-satualur-1/', 'Tayang, 12 ribu tayangan hari pertama.', '2026-10-30T09:00:00.000Z', 'seed-office'),
(50004, 5002, 7007, 'tiktok', '2026-11-03', 'briefed', NULL, 'Brief dikirim 25 Okt.', '2026-10-30T09:00:00.000Z', 'seed-office'),
(50005, 5003, 7008, 'feed', '2026-09-30', 'published', 'https://www.instagram.com/p/contoh-satualur-2/', '', '2026-10-30T09:00:00.000Z', 'seed-office'),
(50006, 5003, 7008, 'youtube', '2026-10-18', 'published', 'https://www.youtube.com/watch?v=contoh-satualur', 'Video 8 menit.', '2026-10-30T09:00:00.000Z', 'seed-office')
ON CONFLICT(id) DO UPDATE SET campaign_id = excluded.campaign_id, influencer_id = excluded.influencer_id, kind = excluded.kind, due_date = excluded.due_date, status = excluded.status, link = excluded.link, note = excluded.note, updated_at = excluded.updated_at, updated_by = excluded.updated_by;

-- vouchers: 3 baris
INSERT INTO vouchers (id, code, type, plan_id, plan_days, credit_idr, max_redemptions, redeemed_count, expires_on, active, note, created_by, created_at) VALUES
(1, 'SATU-LAUNCH-PRO', 'plan', (SELECT id FROM subscription_plans WHERE slug = 'pro'), 30, 0, 20, 0, '2026-12-31', 1, 'Soft launch: Pro 30 hari untuk 20 usaha terpilih.', 'seed-office', '2026-10-22T02:00:00.000Z'),
(2, 'SATU-AI-50K', 'credit', NULL, NULL, 50000, 20, 1, '2026-12-31', 1, 'Saldo AI Rp50.000 untuk mencoba fitur AI setelah kuota habis.', 'seed-office', '2026-10-22T02:00:00.000Z'),
(3, 'SATU-COMBO', 'bundle', (SELECT id FROM subscription_plans WHERE slug = 'lite'), 30, 25000, 10, 1, '2026-11-30', 1, 'Lite 30 hari + saldo AI Rp25.000 untuk peserta demo.', 'seed-office', '2026-10-24T02:00:00.000Z')
ON CONFLICT(id) DO UPDATE SET code = excluded.code, type = excluded.type, plan_id = excluded.plan_id, plan_days = excluded.plan_days, credit_idr = excluded.credit_idr, max_redemptions = excluded.max_redemptions, redeemed_count = excluded.redeemed_count, expires_on = excluded.expires_on, active = excluded.active, note = excluded.note, created_by = excluded.created_by, created_at = excluded.created_at;

-- voucher_redemptions: 2 baris
INSERT INTO voucher_redemptions (voucher_id, user_id, redeemed_at) VALUES
(2, (SELECT id FROM users WHERE email = 'sari.laundrykiloan@contoh.satualur.id'), '2026-10-26T07:00:00.000Z'),
(3, (SELECT id FROM users WHERE email = 'dewi.cucisofa@contoh.satualur.id'), '2026-10-27T03:00:00.000Z')
ON CONFLICT(voucher_id, user_id) DO UPDATE SET redeemed_at = excluded.redeemed_at;

-- ai_credits: 2 baris
INSERT INTO ai_credits (user_id, balance_idr, updated_at) VALUES
((SELECT id FROM users WHERE email = 'sari.laundrykiloan@contoh.satualur.id'), 48000, '2026-10-29T08:00:00.000Z'),
((SELECT id FROM users WHERE email = 'dewi.cucisofa@contoh.satualur.id'), 25000, '2026-10-27T03:00:00.000Z')
ON CONFLICT(user_id) DO UPDATE SET balance_idr = excluded.balance_idr, updated_at = excluded.updated_at;

-- ai_credit_entries: 4 baris
INSERT INTO ai_credit_entries (id, user_id, amount_idr, reason, ref, created_at) VALUES
(90001, (SELECT id FROM users WHERE email = 'sari.laundrykiloan@contoh.satualur.id'), 50000, 'voucher', 'SATU-AI-50K', '2026-10-26T07:00:00.000Z'),
(90002, (SELECT id FROM users WHERE email = 'sari.laundrykiloan@contoh.satualur.id'), -1000, 'offer', '2026-10', '2026-10-28T04:00:00.000Z'),
(90003, (SELECT id FROM users WHERE email = 'sari.laundrykiloan@contoh.satualur.id'), -1000, 'offer', '2026-10', '2026-10-29T08:00:00.000Z'),
(90004, (SELECT id FROM users WHERE email = 'dewi.cucisofa@contoh.satualur.id'), 25000, 'voucher', 'SATU-COMBO', '2026-10-27T03:00:00.000Z')
ON CONFLICT(id) DO UPDATE SET user_id = excluded.user_id, amount_idr = excluded.amount_idr, reason = excluded.reason, ref = excluded.ref, created_at = excluded.created_at;

-- usage_counters: 5 baris
INSERT INTO usage_counters (user_id, feature, period, count) VALUES
((SELECT id FROM users WHERE email = 'sari.laundrykiloan@contoh.satualur.id'), 'offer', '2026-10', 10),
((SELECT id FROM users WHERE email = 'sari.laundrykiloan@contoh.satualur.id'), 'report', '2026-10', 3),
((SELECT id FROM users WHERE email = 'sari.laundrykiloan@contoh.satualur.id'), 'advisor', '2026-10', 5),
((SELECT id FROM users WHERE email = 'dewi.cucisofa@contoh.satualur.id'), 'offer', '2026-10', 4),
((SELECT id FROM users WHERE email = 'dewi.cucisofa@contoh.satualur.id'), 'leads', '2026-10', 2)
ON CONFLICT(user_id, feature, period) DO UPDATE SET count = excluded.count;
