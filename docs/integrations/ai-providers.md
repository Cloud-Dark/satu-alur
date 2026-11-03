# Penyedia AI per Bisnis

> Status: Draft
> Terakhir diperbarui: 2026-11-03

Setiap bisnis memilih mesin AI di Pengaturan › Email & AI:

| Mode | Endpoint | Kuota Satu Alur |
|------|----------|-----------------|
| Bawaan (`builtin`) | Workers AI (`env.AI`) | Dipakai (worker/quota.js: kuota bulanan, lalu saldo AI, lalu 402) |
| OpenAI-compatible (`openai`) | `POST {base}/chat/completions`, `stream: true`, header `Authorization: Bearer <key>` | **Tidak dipakai**; dihitung di `usage_counters` sebagai `byo_<fitur>` untuk analitik |
| Anthropic-compatible (`anthropic`) | `POST {base}/v1/messages`, `stream: true`, header `x-api-key`, `anthropic-version: 2023-06-01` | Sama dengan OpenAI-compatible |

- Semua fitur AI (penawaran, laporan, radar, penasihat, media sosial, optimasi pendapatan) tetap memanggil `/api/llm/chat`; Worker memilih penyedia dari `business_integrations`. `/api/llm/models` mengembalikan model bisnis itu bila memakai penyedia sendiri.
- Aliran SSE penyedia diubah ke kontrak aplikasi (`data: {"choices":[{"delta":{"content":…}}]}` … `data: [DONE]`). Event Anthropic yang dipetakan: `content_block_delta` (`text_delta`), `message_stop`, `error`.
- Mode JSON (`response_format: json_schema`) untuk penyedia sendiri diganti instruksi sistem berisi skema; klien sudah memakai parser toleran (`parseModelJson`).
- API key dienkripsi (`TOKEN_KEY`). Tanpa `TOKEN_KEY`, atau bila admin mematikan "Izinkan bisnis memakai penyedia AI sendiri", semua bisnis kembali ke mesin bawaan.
- Alamat API wajib `https`, domain publik, tanpa kredensial di URL.
- Akun demo tidak memanggil mesin AI apa pun: `/api/llm/chat` mengalirkan jawaban contoh dari `src/ai/simulate.js` (juga untuk mode JSON), tanpa kuota. Pengaturan mesin AI akun demo hanya-baca.
