# Panduan Integrasi ERP dengan Satu Alur

> Versi: 1.0.0  
> Terakhir diperbarui: 2026-11-02  
> Target: Tim IT, Developer, dan Integrator Sistem

---

## Daftar Isi

1. [Ikhtisar](#1-ikhtisar)
2. [Odoo](#2-odoo)
3. [SAP Business One](#3-sap-business-one)
4. [Oracle NetSuite](#4-oracle-netsuite)
5. [Accurate Online](#5-accurate-online)
6. [Mekari Jurnal](#6-mekari-jurnal)
7. [Database Langsung](#7-database-langsung)
8. [Webhook](#8-webhook)

---

## 1. Ikhtisar

Satu Alur MCP (Model Context Protocol) menyediakan beberapa cara untuk mengintegrasikan dengan ERP yang sudah Anda pakai:

| Metode | Kompleksitas | Real-time | Cocok untuk |
|--------|-------------|-----------|-------------|
| **REST API** | Medium | Ya (dengan webhook) | Odoo, SAP B1, NetSuite |
| **Direct DB** | Rendah | Tidak (scheduled) | MySQL, PostgreSQL, SQL Server |
| **File Import** | Sangat rendah | Tidak | Semua sistem (CSV/Excel) |
| **Webhook** | Medium | Ya | Odoo, custom ERP |

---

## 2. Odoo

### 2.1 Persyaratan

- Odoo Community atau Enterprise versi 14+
- Modul `sale`, `project`, `hr` terinstal
- Akses API eksternal diaktifkan (Pengaturan → Umum → API)

### 2.2 Langkah Konfigurasi

**Di Odoo:**

1. Buat user khusus untuk integrasi:
   ```
   Pengaturan → Pengguna & Perusahaan → Pengguna → Baru
   Nama: Satu Alur Connector
   Email: integration@satualur.id
   Hak akses: Sales (User), Project (User), Employee (User)
   ```

2. Buat API Key:
   ```
   Klik nama user → Preferensi Keamanan → Kunci API → Baru
   Deskripsi: Satu Alur Integration
   Salin kunci API yang dihasilkan
   ```

**Di Satu Alur:**

1. Buka **Pengaturan → Konektor → Tambah Baru**
2. Pilih tipe: **Odoo**
3. Isi konfigurasi:
   ```
   Nama: Odoo Production
   URL: https://erp.perusahaan-anda.id
   Database: nama_database_odoo
   Username: integration@satualur.id
   API Key: [paste dari Odoo]
   ```
4. Klik **Periksa Koneksi**
5. Jika berhasil, konfigurasikan pemetaan bidang

### 2.3 Pemetaan Standar Odoo

```
Odoo Model                    →    Satu Alur Entity
─────────────────────────────────────────────────────
res.partner (pelanggan)       →    requests (historis)
                                   workers (jika adalah karyawan)
                                   
product.product               →    vas_items
                                   requests.service_type
                                   
sale.order (pesanan)          →    requests
sale.order.line               →    offers (dari AI)
                                   
project.task                  →    assignments
                                   completions
                                   
account.move (jurnal)         →    ledger_entries
```

### 2.4 Sinkronisasi Real-time dengan Webhook

Untuk sinkronisasi real-time, aktifkan webhook di Odoo:

```python
# Di Odoo (custom module atau server action):
import requests

def notify_satualur(record, event_type):
    url = "https://satualur.id/api/mcp/webhook/odoo"
    headers = {
        "X-Webhook-Secret": "YOUR_WEBHOOK_SECRET",
        "Content-Type": "application/json"
    }
    payload = {
        "event": event_type,  # created, updated, deleted
        "model": record._name,
        "record_id": record.id,
        "data": {
            "name": record.name,
            "state": record.state,
            # ... field lainnya
        }
    }
    requests.post(url, json=payload, headers=headers, timeout=10)
```

---

## 3. SAP Business One

### 3.1 Persyaratan

- SAP B1 versi 10.0+
- Service Layer diaktifkan
- Akses SQL Server atau HANA

### 3.2 Langkah Konfigurasi

**Di SAP B1:**

1. Aktifkan Service Layer:
   ```
   Administration → System Initialization → General Preferences
   → Enable Service Layer: Yes
   ```

2. Buat user integrasi:
   ```
   Administration → Setup → General → Users
   User Code: SATUALUR
   Password: [password kuat]
   ```

**Di Satu Alur:**

1. Buka **Pengaturan → Konektor → Tambah Baru**
2. Pilih tipe: **SAP Business One**
3. Isi konfigurasi:
   ```
   Nama: SAP B1 Production
   Service Layer URL: https://sap-server:50000/b1s/v1
   Database: SBODemoID
   Username: SATUALUR
   Password: [password]
   ```

### 3.3 Pemetaan Standar SAP B1

```
SAP B1 Table/Entity            →    Satu Alur Entity
─────────────────────────────────────────────────────
OCRD (Business Partners)       →    requests.customer_name
                                   workers (jika employee)
                                   
OITM (Items)                   →    vas_items
                                   requests.service_type
                                   
ORDR (Sales Orders)            →    requests
RDR1 (Order Lines)             →    offers (dari AI)
                                   
OWOR (Production Orders)       →    assignments
                                   completions
                                   
OJDT (Journal Entries)         →    ledger_entries
```

---

## 4. Oracle NetSuite

### 4.1 Persyaratan

- NetSuite dengan SuiteTalk REST Web Services
- Token-based Authentication (TBA) diaktifkan

### 4.2 Langkah Konfigurasi

**Di NetSuite:**

1. Aktifkan REST Web Services:
   ```
   Setup → Company → Enable Features → SuiteCloud
   → REST Web Services: ON
   → Token-based Authentication: ON
   ```

2. Buat Integration Record:
   ```
   Setup → Integration → Manage Integrations → New
   Name: Satu Alur Connector
   Authentication: Token-based Authentication
   State: Enabled
   ```

3. Buat Access Token:
   ```
   Setup → Users/Roles → Access Tokens → New
   Application: Satu Alur Connector
   Name: Satu Alur Token
   ```

**Di Satu Alur:**

1. Buka **Pengaturan → Konektor → Tambah Baru**
2. Pilih tipe: **Oracle NetSuite**
3. Isi konfigurasi:
   ```
   Nama: NetSuite Production
   Account ID: 1234567
   Consumer Key: [dari Integration Record]
   Consumer Secret: [dari Integration Record]
   Token ID: [dari Access Token]
   Token Secret: [dari Access Token]
   ```

---

## 5. Accurate Online

### 5.1 Persyaratan

- Akun Accurate Online aktif
- Akses API (hubungi tim Accurate untuk kredensial)

### 5.2 Langkah Konfigurasi

**Di Accurate Online:**

1. Dapatkan kredensial API dari tim dukungan Accurate
2. Catat:
   - Database ID
   - Access Token
   - Refresh Token

**Di Satu Alur:**

1. Buka **Pengaturan → Konektor → Tambah Baru**
2. Pilih tipe: **Accurate Online**
3. Isi konfigurasi:
   ```
   Nama: Accurate Production
   Database ID: [ID database]
   Access Token: [token]
   Refresh Token: [token]
   ```

### 5.3 Pemetaan Standar Accurate

```
Accurate Entity               →    Satu Alur Entity
─────────────────────────────────────────────────────
Customer                      →    requests.customer_name
Item (jasa)                   →    vas_items
                                   requests.service_type
Sales Order                   →    requests
                                   offers
Sales Invoice                 →    ledger_entries
```

---

## 6. Mekari Jurnal

### 6.1 Persyaratan

- Akun Mekari Jurnal aktif
- API Access (dari dashboard developer Mekari)

### 6.2 Langkah Konfigurasi

**Di Mekari Jurnal:**

1. Login ke dashboard developer
2. Buat aplikasi baru
3. Dapatkan:
   - Client ID
   - Client Secret
   - API Key

**Di Satu Alur:**

1. Buka **Pengaturan → Konektor → Tambah Baru**
2. Pilih tipe: **Mekari Jurnal**
3. Isi konfigurasi:
   ```
   Nama: Jurnal Production
   Client ID: [dari dashboard]
   Client Secret: [dari dashboard]
   API Key: [dari dashboard]
   ```

---

## 7. Database Langsung

### 7.1 MySQL

```
Tipe: Direct Database
Driver: MySQL
Host: db.perusahaan.id
Port: 3306
Database: erp_db
Username: satualur_readonly
Password: [password]
SSL: Ya (direkomendasikan)
Read-Only: Ya (sangat direkomendasikan)
```

### 7.2 PostgreSQL

```
Tipe: Direct Database
Driver: PostgreSQL
Host: db.perusahaan.id
Port: 5432
Database: erp_db
Username: satualur_readonly
Password: [password]
SSL: Ya (direkomendasikan)
Schema: public
Read-Only: Ya (sangat direkomendasikan)
```

### 7.3 Query Kustom

Untuk database langsung, Anda bisa menulis query SQL kustom:

```sql
-- Contoh: Ekstrak pesanan aktif dari MySQL
SELECT 
  c.nama AS customer_name,
  c.telepon AS phone,
  p.jenis_layanan AS service_type,
  p.deskripsi AS description,
  p.tanggal AS requested_at,
  p.status AS status
FROM pesanan p
JOIN pelanggan c ON p.pelanggan_id = c.id
WHERE p.status IN ('baru', 'proses', 'menunggu')
  AND p.tanggal >= DATE_SUB(NOW(), INTERVAL 3 MONTH);
```

---

## 8. Webhook

### 8.1 Endpoint Webhook Satu Alur

```
POST https://satualur.id/api/mcp/webhook/{connector_id}
Headers:
  Content-Type: application/json
  X-Webhook-Secret: {your_webhook_secret}
  X-Event-Type: {event_type}
```

### 8.2 Format Payload

```json
{
  "event": "order.created",
  "timestamp": "2026-11-02T10:30:00Z",
  "source": "odoo",
  "data": {
    "id": "12345",
    "customer_name": "PT Maju Jaya",
    "service_type": "AC Cleaning",
    "description": "Pembersihan AC split 2 unit",
    "amount": 450000,
    "status": "draft",
    "created_at": "2026-11-02T10:30:00Z"
  }
}
```

### 8.3 Verifikasi Signature

```javascript
// Contoh verifikasi HMAC di sisi Satu Alur
const crypto = require('crypto');

function verifyWebhook(payload, signature, secret) {
  const expected = crypto
    .createHmac('sha256', secret)
    .update(JSON.stringify(payload))
    .digest('hex');
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expected)
  );
}
```

### 8.4 Event yang Didukung

| Event | Deskripsi |
|-------|-----------|
| `customer.created` | Pelanggan baru dibuat |
| `customer.updated` | Data pelanggan diperbarui |
| `order.created` | Pesanan baru |
| `order.updated` | Status pesanan berubah |
| `order.completed` | Pesanan selesai |
| `invoice.created` | Invoice baru |
| `invoice.paid` | Invoice dibayar |
| `product.created` | Produk/layanan baru |

---

## Lampiran A: Checklist Integrasi

### Pra-Integrasi
- [ ] Identifikasi sistem ERP yang dipakai
- [ ] Dapatkan akses API/database
- [ ] Buat user khusus untuk integrasi (bukan user admin!)
- [ ] Dokumentasikan skema database/API
- [ ] Identifikasi data yang perlu disinkronkan

### Konfigurasi
- [ ] Buat connector di Satu Alur
- [ ] Konfigurasikan autentikasi
- [ ] Uji koneksi
- [ ] Konfigurasikan pemetaan bidang
- [ ] Jalankan sync percobaan (5-10 record)

### Validasi
- [ ] Bandingkan jumlah record
- [ ] Spot-check 10-20 record
- [ ] Verifikasi total nilai transaksi
- [ ] Periksa log error
- [ ] Uji sinkronisasi update

### Go-Live
- [ ] Jadwalkan sync rutin
- [ ] Konfigurasikan notifikasi error
- [ ] Dokumentasikan prosedur troubleshooting
- [ ] Latih tim support
- [ ] Monitor 7 hari pertama

---

## Lampiran B: Format File Import

### CSV untuk Import Pelanggan

```csv
customer_name,phone,location,service_type,description,requested_at
PT Maju Jaya,08123456789,"Jl. Sudirman No. 1, Jakarta",AC Cleaning,"Pembersihan AC split 2 unit",2026-11-01
CV Sejahtera,08234567890,"Jl. Thamrin No. 5, Jakarta",AC Repair,"Perbaikan AC tidak dingin",2026-11-02
```

### CSV untuk Import Produk/Layanan

```csv
name,price,cost,category,attach_rate,description
AC Cleaning Split,250000,150000,ac,80,Pembersihan AC tipe split
AC Repair Minor,350000,200000,ac,60,Perbaikan ringan AC
Plumbing Repair,200000,120000,plumbing,70,Perbaikan pipa bocor
```

### Excel untuk Import Karyawan

| name | phone | address | skills | zone | status |
|------|-------|---------|--------|------|--------|
| Budi Santoso | 08111111111 | Jakarta Selatan | ["ac","cleaning"] | jaksel | active |
| Siti Aminah | 08222222222 | Jakarta Pusat | ["plumbing"] | jakpus | active |
