-- =====================================================================
-- Satu Alur: PETUGAS CONTOH untuk 9 akun demo (DATA FIKTIF).
-- Dibuat oleh scripts/seed-demo-workers.mjs dari src/demo/demo-workers.js.
-- 75 baris. Aman dijalankan ulang: petugas di-upsert per id, keahlian hanya ditambah bila belum ada.
-- Butuh migrasi 0003_workers dan 0017_worker_skills.
-- =====================================================================
-- 0d3e5a11-7c1a-4b5e-9a01-5a7a1a1d0001: 4 petugas, 3 keahlian
INSERT INTO workers (id, owner_id, name, phone, address, skills, lat, lng, zone, status, created_at) VALUES
(1000001, '0d3e5a11-7c1a-4b5e-9a01-5a7a1a1d0001', 'Budi Santoso', '0812-0000-0101', 'Jl. Anggrek No. 20 (contoh), Bekasi, Jawa Barat', '["ac","electrical"]', -6.2203, 106.9531, 'Bekasi', 'active', '2025-10-01T02:00:00.000Z'),
(1000002, '0d3e5a11-7c1a-4b5e-9a01-5a7a1a1d0001', 'Andi (helper)', '0812-0000-0102', 'Jl. Cempaka No. 27 (contoh), Bekasi, Jawa Barat', '["ac","cleaning"]', -6.2608, 106.9801, 'Bekasi', 'active', '2025-10-01T02:00:00.000Z'),
(1000003, '0d3e5a11-7c1a-4b5e-9a01-5a7a1a1d0001', 'Rizky Pratama (teknisi)', '0812-0000-0103', 'Jl. Flamboyan No. 34 (contoh), Bekasi, Jawa Barat', '["ac","electrical"]', -6.2518, 106.9576, 'Bekasi', 'active', '2025-10-01T02:00:00.000Z'),
(1000004, '0d3e5a11-7c1a-4b5e-9a01-5a7a1a1d0001', 'Fikri (helper)', '0812-0000-0104', 'Jl. Dahlia No. 41 (contoh), Bekasi, Jawa Barat', '["ac"]', -6.2428, 106.9846, 'Bekasi', 'inactive', '2025-10-01T02:00:00.000Z')
ON CONFLICT(id) DO UPDATE SET name = excluded.name, phone = excluded.phone, address = excluded.address, skills = excluded.skills, lat = excluded.lat, lng = excluded.lng, zone = excluded.zone, status = excluded.status WHERE workers.owner_id = excluded.owner_id;
INSERT OR IGNORE INTO worker_skills (id, owner_id, key, name, created_at) VALUES
(1000100, '0d3e5a11-7c1a-4b5e-9a01-5a7a1a1d0001', 'ac', 'Service AC', '2025-10-01T02:00:00.000Z'),
(1000101, '0d3e5a11-7c1a-4b5e-9a01-5a7a1a1d0001', 'cleaning', 'Cleaning', '2025-10-01T02:00:00.000Z'),
(1000102, '0d3e5a11-7c1a-4b5e-9a01-5a7a1a1d0001', 'electrical', 'Listrik', '2025-10-01T02:00:00.000Z');
-- 0d3e5a11-7c1a-4b5e-9a02-5a7a1a1d0002: 5 petugas, 3 keahlian
INSERT INTO workers (id, owner_id, name, phone, address, skills, lat, lng, zone, status, created_at) VALUES
(2000001, '0d3e5a11-7c1a-4b5e-9a02-5a7a1a1d0002', 'Rina Kusuma', '0812-0000-0201', 'Jl. Cempaka No. 23 (contoh), Makassar, Sulawesi Selatan', '["cleaning","sofa"]', -5.1477, 119.4327, 'Makassar', 'active', '2025-10-01T02:00:00.000Z'),
(2000002, '0d3e5a11-7c1a-4b5e-9a02-5a7a1a1d0002', 'Wati', '0812-0000-0202', 'Jl. Flamboyan No. 30 (contoh), Makassar, Sulawesi Selatan', '["cleaning"]', -5.1387, 119.4102, 'Makassar', 'active', '2025-10-01T02:00:00.000Z'),
(2000003, '0d3e5a11-7c1a-4b5e-9a02-5a7a1a1d0002', 'Sukma', '0812-0000-0203', 'Jl. Dahlia No. 37 (contoh), Makassar, Sulawesi Selatan', '["cleaning","carpet"]', -5.1297, 119.4372, 'Makassar', 'active', '2025-10-01T02:00:00.000Z'),
(2000004, '0d3e5a11-7c1a-4b5e-9a02-5a7a1a1d0002', 'Dewi', '0812-0000-0204', 'Jl. Mawar No. 44 (contoh), Makassar, Sulawesi Selatan', '["cleaning","sofa"]', -5.1702, 119.4147, 'Makassar', 'active', '2025-10-01T02:00:00.000Z'),
(2000005, '0d3e5a11-7c1a-4b5e-9a02-5a7a1a1d0002', 'Nurul', '0812-0000-0205', 'Jl. Teratai No. 51 (contoh), Makassar, Sulawesi Selatan', '["cleaning"]', -5.1612, 119.4417, 'Makassar', 'inactive', '2025-10-01T02:00:00.000Z')
ON CONFLICT(id) DO UPDATE SET name = excluded.name, phone = excluded.phone, address = excluded.address, skills = excluded.skills, lat = excluded.lat, lng = excluded.lng, zone = excluded.zone, status = excluded.status WHERE workers.owner_id = excluded.owner_id;
INSERT OR IGNORE INTO worker_skills (id, owner_id, key, name, created_at) VALUES
(2000100, '0d3e5a11-7c1a-4b5e-9a02-5a7a1a1d0002', 'cleaning', 'Cleaning', '2025-10-01T02:00:00.000Z'),
(2000101, '0d3e5a11-7c1a-4b5e-9a02-5a7a1a1d0002', 'carpet', 'Cuci Karpet', '2025-10-01T02:00:00.000Z'),
(2000102, '0d3e5a11-7c1a-4b5e-9a02-5a7a1a1d0002', 'sofa', 'Cuci Sofa', '2025-10-01T02:00:00.000Z');
-- 0d3e5a11-7c1a-4b5e-9a03-5a7a1a1d0003: 3 petugas, 2 keahlian
INSERT INTO workers (id, owner_id, name, phone, address, skills, lat, lng, zone, status, created_at) VALUES
(3000001, '0d3e5a11-7c1a-4b5e-9a03-5a7a1a1d0003', 'Hendra Siregar', '0812-0000-0301', 'Jl. Flamboyan No. 26 (contoh), Medan, Sumatera Utara', '["electrical"]', 3.5772, 98.6947, 'Medan', 'active', '2025-10-01T02:00:00.000Z'),
(3000002, '0d3e5a11-7c1a-4b5e-9a03-5a7a1a1d0003', 'Bonar (helper)', '0812-0000-0302', 'Jl. Dahlia No. 33 (contoh), Medan, Sumatera Utara', '["electrical"]', 3.5862, 98.6722, 'Medan', 'active', '2025-10-01T02:00:00.000Z'),
(3000003, '0d3e5a11-7c1a-4b5e-9a03-5a7a1a1d0003', 'Daniel (helper)', '0812-0000-0303', 'Jl. Mawar No. 40 (contoh), Medan, Sumatera Utara', '["electrical","ac"]', 3.5952, 98.6497, 'Medan', 'active', '2025-10-01T02:00:00.000Z')
ON CONFLICT(id) DO UPDATE SET name = excluded.name, phone = excluded.phone, address = excluded.address, skills = excluded.skills, lat = excluded.lat, lng = excluded.lng, zone = excluded.zone, status = excluded.status WHERE workers.owner_id = excluded.owner_id;
INSERT OR IGNORE INTO worker_skills (id, owner_id, key, name, created_at) VALUES
(3000100, '0d3e5a11-7c1a-4b5e-9a03-5a7a1a1d0003', 'electrical', 'Listrik', '2025-10-01T02:00:00.000Z'),
(3000101, '0d3e5a11-7c1a-4b5e-9a03-5a7a1a1d0003', 'ac', 'Service AC', '2025-10-01T02:00:00.000Z');
-- 0d3e5a11-7c1a-4b5e-9a04-5a7a1a1d0004: 6 petugas, 4 keahlian
INSERT INTO workers (id, owner_id, name, phone, address, skills, lat, lng, zone, status, created_at) VALUES
(4000001, '0d3e5a11-7c1a-4b5e-9a04-5a7a1a1d0004', 'Agus Salim', '0812-0000-0401', 'Jl. Dahlia No. 29 (contoh), Surabaya, Jawa Timur', '["pest","fogging"]', -7.244, 112.7476, 'Surabaya', 'active', '2025-10-01T02:00:00.000Z'),
(4000002, '0d3e5a11-7c1a-4b5e-9a04-5a7a1a1d0004', 'Siti Aminah', '0812-0000-0402', 'Jl. Mawar No. 36 (contoh), Surabaya, Jawa Timur', '["pest","cleaning"]', -7.235, 112.7746, 'Surabaya', 'active', '2025-10-01T02:00:00.000Z'),
(4000003, '0d3e5a11-7c1a-4b5e-9a04-5a7a1a1d0004', 'Joko Purnomo', '0812-0000-0403', 'Jl. Teratai No. 43 (contoh), Sidoarjo, Jawa Timur', '["pest","garden"]', -7.4658, 112.7183, 'Sidoarjo', 'active', '2025-10-01T02:00:00.000Z'),
(4000004, '0d3e5a11-7c1a-4b5e-9a04-5a7a1a1d0004', 'Rahmat Hidayat', '0812-0000-0404', 'Jl. Melati No. 50 (contoh), Surabaya, Jawa Timur', '["pest","fogging"]', -7.2665, 112.7296, 'Surabaya', 'active', '2025-10-01T02:00:00.000Z'),
(4000005, '0d3e5a11-7c1a-4b5e-9a04-5a7a1a1d0004', 'Dedi Kurniawan', '0812-0000-0405', 'Jl. Kenanga No. 57 (contoh), Sidoarjo, Jawa Timur', '["pest"]', -7.4478, 112.7228, 'Sidoarjo', 'active', '2025-10-01T02:00:00.000Z'),
(4000006, '0d3e5a11-7c1a-4b5e-9a04-5a7a1a1d0004', 'Eko Prasetyo', '0812-0000-0406', 'Jl. Anggrek No. 64 (contoh), Surabaya, Jawa Timur', '["fogging","cleaning"]', -7.2485, 112.7341, 'Surabaya', 'inactive', '2025-10-01T02:00:00.000Z')
ON CONFLICT(id) DO UPDATE SET name = excluded.name, phone = excluded.phone, address = excluded.address, skills = excluded.skills, lat = excluded.lat, lng = excluded.lng, zone = excluded.zone, status = excluded.status WHERE workers.owner_id = excluded.owner_id;
INSERT OR IGNORE INTO worker_skills (id, owner_id, key, name, created_at) VALUES
(4000100, '0d3e5a11-7c1a-4b5e-9a04-5a7a1a1d0004', 'pest', 'Pest Control', '2025-10-01T02:00:00.000Z'),
(4000101, '0d3e5a11-7c1a-4b5e-9a04-5a7a1a1d0004', 'fogging', 'Fogging & disinfeksi', '2025-10-01T02:00:00.000Z'),
(4000102, '0d3e5a11-7c1a-4b5e-9a04-5a7a1a1d0004', 'cleaning', 'Cleaning', '2025-10-01T02:00:00.000Z'),
(4000103, '0d3e5a11-7c1a-4b5e-9a04-5a7a1a1d0004', 'garden', 'Taman', '2025-10-01T02:00:00.000Z');
-- 0d3e5a11-7c1a-4b5e-9a05-5a7a1a1d0005: 6 petugas, 4 keahlian
INSERT INTO workers (id, owner_id, name, phone, address, skills, lat, lng, zone, status, created_at) VALUES
(5000001, '0d3e5a11-7c1a-4b5e-9a05-5a7a1a1d0005', 'Neneng Suryani', '0812-0000-0501', 'Jl. Mawar No. 32 (contoh), Bandung, Jawa Barat', '["laundry"]', -6.922, 107.6371, 'Bandung', 'active', '2025-10-01T02:00:00.000Z'),
(5000002, '0d3e5a11-7c1a-4b5e-9a05-5a7a1a1d0005', 'Asep Saepudin', '0812-0000-0502', 'Jl. Teratai No. 39 (contoh), Bandung, Jawa Barat', '["antar","laundry"]', -6.913, 107.6146, 'Bandung', 'active', '2025-10-01T02:00:00.000Z'),
(5000003, '0d3e5a11-7c1a-4b5e-9a05-5a7a1a1d0005', 'Euis Rahmawati', '0812-0000-0503', 'Jl. Melati No. 46 (contoh), Bandung, Jawa Barat', '["laundry","carpet"]', -6.904, 107.6416, 'Bandung', 'active', '2025-10-01T02:00:00.000Z'),
(5000004, '0d3e5a11-7c1a-4b5e-9a05-5a7a1a1d0005', 'Dadang Hermawan', '0812-0000-0504', 'Jl. Kenanga No. 53 (contoh), Bandung, Jawa Barat', '["antar"]', -6.895, 107.6191, 'Bandung', 'active', '2025-10-01T02:00:00.000Z'),
(5000005, '0d3e5a11-7c1a-4b5e-9a05-5a7a1a1d0005', 'Yayan Sopyan', '0812-0000-0505', 'Jl. Anggrek No. 60 (contoh), Bandung, Jawa Barat', '["carpet","sofa"]', -6.9355, 107.5966, 'Bandung', 'active', '2025-10-01T02:00:00.000Z'),
(5000006, '0d3e5a11-7c1a-4b5e-9a05-5a7a1a1d0005', 'Lilis Andriani', '0812-0000-0506', 'Jl. Cempaka No. 67 (contoh), Bandung, Jawa Barat', '["laundry"]', -6.9265, 107.6236, 'Bandung', 'inactive', '2025-10-01T02:00:00.000Z')
ON CONFLICT(id) DO UPDATE SET name = excluded.name, phone = excluded.phone, address = excluded.address, skills = excluded.skills, lat = excluded.lat, lng = excluded.lng, zone = excluded.zone, status = excluded.status WHERE workers.owner_id = excluded.owner_id;
INSERT OR IGNORE INTO worker_skills (id, owner_id, key, name, created_at) VALUES
(5000100, '0d3e5a11-7c1a-4b5e-9a05-5a7a1a1d0005', 'laundry', 'Laundry & setrika', '2025-10-01T02:00:00.000Z'),
(5000101, '0d3e5a11-7c1a-4b5e-9a05-5a7a1a1d0005', 'antar', 'Antar-jemput', '2025-10-01T02:00:00.000Z'),
(5000102, '0d3e5a11-7c1a-4b5e-9a05-5a7a1a1d0005', 'carpet', 'Cuci Karpet', '2025-10-01T02:00:00.000Z'),
(5000103, '0d3e5a11-7c1a-4b5e-9a05-5a7a1a1d0005', 'sofa', 'Cuci Sofa', '2025-10-01T02:00:00.000Z');
-- 0d3e5a11-7c1a-4b5e-9a06-5a7a1a1d0006: 6 petugas, 3 keahlian
INSERT INTO workers (id, owner_id, name, phone, address, skills, lat, lng, zone, status, created_at) VALUES
(6000001, '0d3e5a11-7c1a-4b5e-9a06-5a7a1a1d0006', 'Syamsul Bahri', '0812-0000-0601', 'Jl. Teratai No. 35 (contoh), Balikpapan, Kalimantan Timur', '["cat","waterproofing"]', -1.2604, 116.8439, 'Balikpapan', 'active', '2025-10-01T02:00:00.000Z'),
(6000002, '0d3e5a11-7c1a-4b5e-9a06-5a7a1a1d0006', 'La Ode Rahman', '0812-0000-0602', 'Jl. Melati No. 42 (contoh), Balikpapan, Kalimantan Timur', '["cat"]', -1.2514, 116.8709, 'Balikpapan', 'active', '2025-10-01T02:00:00.000Z'),
(6000003, '0d3e5a11-7c1a-4b5e-9a06-5a7a1a1d0006', 'Andi Baso', '0812-0000-0603', 'Jl. Kenanga No. 49 (contoh), Balikpapan, Kalimantan Timur', '["waterproofing","roof"]', -1.2424, 116.8484, 'Balikpapan', 'active', '2025-10-01T02:00:00.000Z'),
(6000004, '0d3e5a11-7c1a-4b5e-9a06-5a7a1a1d0006', 'Ruslan Effendi', '0812-0000-0604', 'Jl. Anggrek No. 56 (contoh), Balikpapan, Kalimantan Timur', '["cat","roof"]', -1.2334, 116.8754, 'Balikpapan', 'active', '2025-10-01T02:00:00.000Z'),
(6000005, '0d3e5a11-7c1a-4b5e-9a06-5a7a1a1d0006', 'Jumadi', '0812-0000-0605', 'Jl. Cempaka No. 63 (contoh), Balikpapan, Kalimantan Timur', '["waterproofing"]', -1.2244, 116.8529, 'Balikpapan', 'active', '2025-10-01T02:00:00.000Z'),
(6000006, '0d3e5a11-7c1a-4b5e-9a06-5a7a1a1d0006', 'Muh. Arsyad', '0812-0000-0606', 'Jl. Flamboyan No. 70 (contoh), Balikpapan, Kalimantan Timur', '["cat"]', -1.2154, 116.8304, 'Balikpapan', 'inactive', '2025-10-01T02:00:00.000Z')
ON CONFLICT(id) DO UPDATE SET name = excluded.name, phone = excluded.phone, address = excluded.address, skills = excluded.skills, lat = excluded.lat, lng = excluded.lng, zone = excluded.zone, status = excluded.status WHERE workers.owner_id = excluded.owner_id;
INSERT OR IGNORE INTO worker_skills (id, owner_id, key, name, created_at) VALUES
(6000100, '0d3e5a11-7c1a-4b5e-9a06-5a7a1a1d0006', 'cat', 'Pengecatan', '2025-10-01T02:00:00.000Z'),
(6000101, '0d3e5a11-7c1a-4b5e-9a06-5a7a1a1d0006', 'waterproofing', 'Waterproofing', '2025-10-01T02:00:00.000Z'),
(6000102, '0d3e5a11-7c1a-4b5e-9a06-5a7a1a1d0006', 'roof', 'Roof Repair', '2025-10-01T02:00:00.000Z');
-- 0d3e5a11-7c1a-4b5e-9a07-5a7a1a1d0007: 5 petugas, 4 keahlian
INSERT INTO workers (id, owner_id, name, phone, address, skills, lat, lng, zone, status, created_at) VALUES
(7000001, '0d3e5a11-7c1a-4b5e-9a07-5a7a1a1d0007', 'Tim JKT-01 · Spv. Bambang Wijaya', '0812-0000-0701', 'Jl. Melati No. 38 (contoh), Jakarta Selatan, DKI Jakarta', '["cleaning","mep"]', -6.2525, 106.8241, 'Jakarta Selatan', 'active', '2025-10-01T02:00:00.000Z'),
(7000002, '0d3e5a11-7c1a-4b5e-9a07-5a7a1a1d0007', 'Tim JKT-02 · Spv. Sri Wahyuni', '0812-0000-0702', 'Jl. Kenanga No. 45 (contoh), Jakarta Barat, DKI Jakarta', '["cleaning"]', -6.1494, 106.7547, 'Jakarta Barat', 'active', '2025-10-01T02:00:00.000Z'),
(7000003, '0d3e5a11-7c1a-4b5e-9a07-5a7a1a1d0007', 'Tim BDG-01 · Spv. Ujang Kurnia', '0812-0000-0703', 'Jl. Anggrek No. 52 (contoh), Bandung, Jawa Barat', '["cleaning","ac"]', -6.94, 107.6371, 'Bandung', 'active', '2025-10-01T02:00:00.000Z'),
(7000004, '0d3e5a11-7c1a-4b5e-9a07-5a7a1a1d0007', 'Tim SBY-01 · Spv. Heru Susanto', '0812-0000-0704', 'Jl. Cempaka No. 59 (contoh), Surabaya, Jawa Timur', '["mep","electrical"]', -7.271, 112.7476, 'Surabaya', 'active', '2025-10-01T02:00:00.000Z'),
(7000005, '0d3e5a11-7c1a-4b5e-9a07-5a7a1a1d0007', 'Tim MDN-01 · Spv. Ilham Nasution', '0812-0000-0705', 'Jl. Flamboyan No. 66 (contoh), Medan, Sumatera Utara', '["cleaning","mep"]', 3.5907, 98.6947, 'Medan', 'active', '2025-10-01T02:00:00.000Z')
ON CONFLICT(id) DO UPDATE SET name = excluded.name, phone = excluded.phone, address = excluded.address, skills = excluded.skills, lat = excluded.lat, lng = excluded.lng, zone = excluded.zone, status = excluded.status WHERE workers.owner_id = excluded.owner_id;
INSERT OR IGNORE INTO worker_skills (id, owner_id, key, name, created_at) VALUES
(7000100, '0d3e5a11-7c1a-4b5e-9a07-5a7a1a1d0007', 'cleaning', 'Cleaning', '2025-10-01T02:00:00.000Z'),
(7000101, '0d3e5a11-7c1a-4b5e-9a07-5a7a1a1d0007', 'mep', 'Maintenance MEP', '2025-10-01T02:00:00.000Z'),
(7000102, '0d3e5a11-7c1a-4b5e-9a07-5a7a1a1d0007', 'ac', 'Service AC', '2025-10-01T02:00:00.000Z'),
(7000103, '0d3e5a11-7c1a-4b5e-9a07-5a7a1a1d0007', 'electrical', 'Listrik', '2025-10-01T02:00:00.000Z');
-- 0d3e5a11-7c1a-4b5e-9a08-5a7a1a1d0008: 5 petugas, 4 keahlian
INSERT INTO workers (id, owner_id, name, phone, address, skills, lat, lng, zone, status, created_at) VALUES
(8000001, '0d3e5a11-7c1a-4b5e-9a08-5a7a1a1d0008', 'Tim JKT-01 · Spv. Retno Wulandari', '0812-0000-0801', 'Jl. Kenanga No. 41 (contoh), Jakarta Pusat, DKI Jakarta', '["cleaning","ob"]', -6.1955, 106.8206, 'Jakarta Pusat', 'active', '2025-10-01T02:00:00.000Z'),
(8000002, '0d3e5a11-7c1a-4b5e-9a08-5a7a1a1d0008', 'Tim JKT-02 · Spv. Fajar Ramadhan', '0812-0000-0802', 'Jl. Anggrek No. 48 (contoh), Jakarta Selatan, DKI Jakarta', '["gedung","electrical"]', -6.2615, 106.8241, 'Jakarta Selatan', 'active', '2025-10-01T02:00:00.000Z'),
(8000003, '0d3e5a11-7c1a-4b5e-9a08-5a7a1a1d0008', 'Tim BDG-01 · Spv. Cecep Hidayat', '0812-0000-0803', 'Jl. Cempaka No. 55 (contoh), Bandung, Jawa Barat', '["cleaning","ob"]', -6.9085, 107.6101, 'Bandung', 'active', '2025-10-01T02:00:00.000Z'),
(8000004, '0d3e5a11-7c1a-4b5e-9a08-5a7a1a1d0008', 'Tim SBY-01 · Spv. Teguh Santoso', '0812-0000-0804', 'Jl. Flamboyan No. 62 (contoh), Surabaya, Jawa Timur', '["gedung"]', -7.2395, 112.7701, 'Surabaya', 'active', '2025-10-01T02:00:00.000Z'),
(8000005, '0d3e5a11-7c1a-4b5e-9a08-5a7a1a1d0008', 'Tim BPN-01 · Spv. Fadli Hasan', '0812-0000-0805', 'Jl. Dahlia No. 69 (contoh), Balikpapan, Kalimantan Timur', '["cleaning","gedung"]', -1.2604, 116.8484, 'Balikpapan', 'inactive', '2025-10-01T02:00:00.000Z')
ON CONFLICT(id) DO UPDATE SET name = excluded.name, phone = excluded.phone, address = excluded.address, skills = excluded.skills, lat = excluded.lat, lng = excluded.lng, zone = excluded.zone, status = excluded.status WHERE workers.owner_id = excluded.owner_id;
INSERT OR IGNORE INTO worker_skills (id, owner_id, key, name, created_at) VALUES
(8000100, '0d3e5a11-7c1a-4b5e-9a08-5a7a1a1d0008', 'cleaning', 'Cleaning', '2025-10-01T02:00:00.000Z'),
(8000101, '0d3e5a11-7c1a-4b5e-9a08-5a7a1a1d0008', 'ob', 'Office boy', '2025-10-01T02:00:00.000Z'),
(8000102, '0d3e5a11-7c1a-4b5e-9a08-5a7a1a1d0008', 'gedung', 'Teknisi gedung', '2025-10-01T02:00:00.000Z'),
(8000103, '0d3e5a11-7c1a-4b5e-9a08-5a7a1a1d0008', 'electrical', 'Listrik', '2025-10-01T02:00:00.000Z');
-- 0d3e5a11-7c1a-4b5e-9a09-5a7a1a1d0009: 4 petugas, 4 keahlian
INSERT INTO workers (id, owner_id, name, phone, address, skills, lat, lng, zone, status, created_at) VALUES
(9000001, '0d3e5a11-7c1a-4b5e-9a09-5a7a1a1d0009', 'Tim SBY-01 · Spv. Wahyu Nugroho', '0812-0000-0901', 'Jl. Anggrek No. 44 (contoh), Surabaya, Jawa Timur', '["hk-rs","cleaning"]', -7.235, 112.7611, 'Surabaya', 'active', '2025-10-01T02:00:00.000Z'),
(9000002, '0d3e5a11-7c1a-4b5e-9a09-5a7a1a1d0009', 'Tim SBY-02 · Spv. Yani Mulyani', '0812-0000-0902', 'Jl. Cempaka No. 51 (contoh), Surabaya, Jawa Timur', '["hk-rs"]', -7.2755, 112.7386, 'Surabaya', 'active', '2025-10-01T02:00:00.000Z'),
(9000003, '0d3e5a11-7c1a-4b5e-9a09-5a7a1a1d0009', 'Tim JKT-01 · Spv. Gilang Permana', '0812-0000-0903', 'Jl. Flamboyan No. 58 (contoh), Jakarta Selatan, DKI Jakarta', '["hk-rs","fogging"]', -6.2705, 106.8241, 'Jakarta Selatan', 'active', '2025-10-01T02:00:00.000Z'),
(9000004, '0d3e5a11-7c1a-4b5e-9a09-5a7a1a1d0009', 'Tim MKS-01 · Spv. Haris Munandar', '0812-0000-0904', 'Jl. Dahlia No. 65 (contoh), Makassar, Sulawesi Selatan', '["hk-rs","pest"]', -5.1477, 119.4237, 'Makassar', 'active', '2025-10-01T02:00:00.000Z')
ON CONFLICT(id) DO UPDATE SET name = excluded.name, phone = excluded.phone, address = excluded.address, skills = excluded.skills, lat = excluded.lat, lng = excluded.lng, zone = excluded.zone, status = excluded.status WHERE workers.owner_id = excluded.owner_id;
INSERT OR IGNORE INTO worker_skills (id, owner_id, key, name, created_at) VALUES
(9000100, '0d3e5a11-7c1a-4b5e-9a09-5a7a1a1d0009', 'hk-rs', 'Housekeeping RS', '2025-10-01T02:00:00.000Z'),
(9000101, '0d3e5a11-7c1a-4b5e-9a09-5a7a1a1d0009', 'cleaning', 'Cleaning', '2025-10-01T02:00:00.000Z'),
(9000102, '0d3e5a11-7c1a-4b5e-9a09-5a7a1a1d0009', 'pest', 'Pest Control', '2025-10-01T02:00:00.000Z'),
(9000103, '0d3e5a11-7c1a-4b5e-9a09-5a7a1a1d0009', 'fogging', 'Fogging & disinfeksi', '2025-10-01T02:00:00.000Z');
