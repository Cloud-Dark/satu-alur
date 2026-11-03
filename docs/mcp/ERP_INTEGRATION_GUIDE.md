# Menghubungkan sumber ERP

Cakupan implementasi: [MCP_SPEC.md](MCP_SPEC.md). Bentuk request dan respons: [API.md](../API.md#mcp-konektor-erp-dan-migrasi).

Satu Alur menerima JSON melalui REST/webhook atau ekspor CSV/JSON. Template Odoo dan SAP B1 pada UI adalah konfigurasi awal generik, bukan adapter vendor lengkap. Odoo, SAP Business One, NetSuite, Accurate, dan Mekari memiliki autentikasi dan bentuk data masing-masing; siapkan endpoint adapter bila responsnya tidak cocok. Koneksi vendor belum diuji sebagai bagian rilis ini.

## REST

Di Pengaturan → ERP & Integrasi, pilih Tambah konektor atau template REST. Isi nama, URL HTTPS publik, dan metode autentikasi. Untuk Basic Auth, isi username dan password; untuk OAuth, isi bearer token yang telah diperoleh. Aplikasi belum memperoleh atau memperbarui token OAuth secara otomatis.

Contoh body untuk `POST /api/mcp/connectors`:

```json
{
  "name": "ERP tenaga kerja",
  "type": "rest",
  "enabled": true,
  "config": {
    "endpoint": { "baseUrl": "https://erp.example.com/api" },
    "auth": { "type": "apikey", "headerName": "X-Api-Key" },
    "sync": { "strategy": "manual" }
  },
  "apiKey": "<kredensial dari secret store>"
}
```

Jangan commit kredensial asli. `MCP_ENCRYPTION_KEY` wajib tersedia pada Worker sebelum request berisi rahasia dapat disimpan.

Tombol Uji memanggil HEAD; jika endpoint menjawab 405/501, Worker mencoba GET. Ini memeriksa keterjangkauan dan autentikasi, bukan kebenaran seluruh pemetaan. Redirect ditolak. Respons data untuk sinkronisasi harus berupa array atau salah satu pembungkus berikut:

```json
{ "data": [{ "employee_id": "W-101", "nama": "Budi", "telepon": "081234567890" }] }
```

Simpan pemetaan masuk melalui `PUT /api/mcp/connectors/:id/mappings`:

```json
{
  "entity": "workers",
  "direction": "inbound",
  "mode": "upsert",
  "externalIdField": "employee_id",
  "filters": { "path": "employees" },
  "fields": [
    { "source": "nama", "target": "name", "transform": ["trim"] },
    { "source": "telepon", "target": "phone", "transform": ["phone_id"] }
  ]
}
```

Pengaturan → Peta menerima file contoh untuk menyarankan kolom. Pastikan kolom benar sebelum menyimpan. Endpoint `POST /api/mcp/connectors/:id/sync` dengan `{ "dryRun": true }` memeriksa baris tanpa menulis. Hapus `dryRun` untuk impor. Maksimal 500 baris per permintaan; bila ERP memakai pagination, adapter harus mengirim batch terpisah. Tidak ada penjadwal ERP otomatis.

## File

Pilih konektor File, format CSV atau JSON, delimiter yang sesuai, dan aktifkan konektor. Ekspor Excel menjadi CSV; berkas XLSX/XML tidak dibaca aplikasi.

1. Buka Peta, unggah file contoh, pilih entitas, periksa kolom wajib dan pratinjau, lalu simpan pemetaan.
2. Buka Impor, pilih entitas yang sama, lalu unggah berkas sumber.
3. Periksa hasil dan log; ulangi baris gagal setelah memperbaiki sumber atau pemetaan.

Untuk migrasi bertahap, gunakan [panduan migrasi](MIGRATION_GUIDE.md). Konektor database langsung memerlukan bridge yang belum tersedia; gunakan ekspor file atau adapter REST.

## Webhook

Buat konektor `webhook` dengan secret minimal 16 karakter, aktifkan, dan simpan pemetaan masuk. Kirim ke `POST /api/mcp/webhook/:id` dengan body berikut:

```json
{ "entity": "workers", "rows": [{ "employee_id": "W-101", "nama": "Budi" }] }
```

Header `X-MCP-Signature: sha256=<hex>` adalah HMAC-SHA256 atas byte body mentah menggunakan secret konektor. `X-Hub-Signature-256` juga diterima. Properti `data` tetap diterima untuk kompatibilitas. Gunakan upsert dan ID eksternal stabil agar kiriman berulang tidak membuat duplikat.

Webhook tidak membutuhkan sesi pengirim. Pemilik konektor harus tetap Enterprise dan tidak disuspensi. Body dibatasi 256 KiB dan maksimal 500 baris; request berlebih ditolak seluruhnya. Respons menyebut jumlah diterima, berhasil ditulis, dan gagal. Kirim ulang kegagalan setelah memperbaiki data; webhook tidak menjalankan mekanisme retry otomatis.
