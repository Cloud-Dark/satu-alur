# Video demo Satu Alur

Rekaman layar otomatis yang mengikuti [naskah video demo](../demo-video-script.md).

> **Data demo fiktif, AI disimulasikan.** Rekaman ini dibuat dari aplikasi dalam **mode mock** (`VITE_USE_MOCK=true`): semua usaha, pelanggan, dan angka adalah data contoh, dan jawaban AI berasal dari simulasi streaming lokal, bukan model sungguhan. Bagian yang menunggu loading atau jawaban AI dipercepat dan diberi label "dipercepat ×N".

| Berkas | Isi |
|---|---|
| `record.cjs` | Playwright: menjalankan 16 adegan pada 1920×1080 dengan kursor, efek klik, dan teks layar. Menulis `out/raw.webm` dan `out/scenes.json`. |
| `build.cjs` | ffmpeg: mempercepat bagian tunggu, menyamakan tempo, menambah kartu judul dan penutup, trek audio senyap, lalu membuat `Satu-Alur-Demo.mp4` (±2:48) dan `Satu-Alur-Demo-60s.mp4` (±58 detik). |
| `vo.json` | Naskah narasi per adegan untuk kedua versi, dengan waktu mulai/akhir (detik) di video akhir. `say` adalah ejaan khusus untuk TTS (mis. "A I", "E R P"). |
| `make-audio.py` | Menambah narasi (edge-tts, suara `id-ID-GadisNeural`) dan musik latar orisinal yang dibuat dengan kode (numpy, 92 BPM, Cmaj7–Am7–Fmaj7–G6). Musik diredam otomatis saat ada narasi, lalu dinormalisasi ke sekitar -15 LUFS dan puncak di bawah -1,5 dBTP. Video tidak di-encode ulang. |

Berkas `*.mp4`, `*.webm`, dan `out/` tidak di-commit (lihat `.gitignore`).

## Merekam ulang

```bash
npm install
VITE_USE_MOCK=true VITE_STAFF_USERS='staf:demo-staf-2026' npx vite --port 5281 --strictPort
```

Di terminal lain, dari root repo:

```bash
node docs/lomba/video/record.cjs http://localhost:5281 docs/lomba/video/out
node docs/lomba/video/build.cjs docs/lomba/video/out
```

Lalu tambahkan narasi dan musik (butuh Python 3, `numpy`, `edge-tts`, dan akses internet untuk TTS):

```bash
python3 docs/lomba/video/make-audio.py docs/lomba/video/out/Satu-Alur-Demo.mp4 full Satu-Alur-Demo.mp4 docs/lomba/video/tts.py
python3 docs/lomba/video/make-audio.py docs/lomba/video/out/Satu-Alur-Demo-60s.mp4 short Satu-Alur-Demo-60s.mp4 docs/lomba/video/tts.py
```

`tts.py` (juga di folder ini) menerima `"<teks>" <suara> <keluaran.mp3> [rate]` dan memanggil `edge_tts.Communicate(teks, suara, rate=rate).save(keluaran)`. Kalau teks narasi diubah, `make-audio.py` menaikkan kecepatan bicara sampai +12% agar muat; bila masih tidak muat, build berhenti dan meminta teks dipersingkat.

Butuh Playwright dengan Chromium (`require('playwright')`) dan ffmpeg dengan `libx264` dan `drawtext`. Rekaman sekitar 4,5 menit; build sekitar 3 menit.

## Catatan

- Setiap adegan dibungkus `try/catch`; kalau label UI berubah, adegan itu dilewati dan peringatannya tercetak di konsol. Periksa `scenes.json` dan beberapa frame sebelum memakai hasilnya.
- Adegan Kantor Satu Alur memakai akun staf mock dari `VITE_STAFF_USERS`. Di mode mock halaman Paket langganan, Pengguna, dan Kampanye masih kosong, jadi rekaman menampilkan editor Landing page dan Payment gateway.
- Konektor ERP ditampilkan dari akun demo Enterprise, belum ada konektor yang tersimpan (tampil template dan langkah migrasi).
- Publikasi otomatis ke Instagram/Threads dan notifikasi WhatsApp tidak diperagakan.
- Narasi memakai suara sintetis (text-to-speech). Musik latar orisinal, dibuat oleh `make-audio.py`, jadi aman diunggah ke YouTube.

## Terbit

Versi lengkap (narasi + musik) terbit publik di YouTube: <https://youtu.be/seXJmshTh0U>
