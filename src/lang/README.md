# Terjemahan (lang/)

Setiap bahasa punya folder sendiri dengan nama file yang sama:

```
src/lang/
  id/  common.json  header.json  footer.json  body.json  dashboard.json  …
  en/  common.json  header.json  footer.json  body.json  dashboard.json  …
```

Satu file JSON = satu *namespace*. Kunci dipanggil dengan `t('<namespace>.<jalur>')`:

```js
import { t } from '../i18n/index.js'
t('dashboard.kpi.profit')                 // src/lang/<bahasa>/dashboard.json → kpi.profit
t('dashboard.greeting', { name: 'Ana' })  // "Halo, {name}" → "Halo, Ana"
t('common.items', { count: 3 })           // nilai { "one": "…", "other": "…" } untuk jamak
```

- Kunci yang belum ada di `en` otomatis memakai teks `id`.
- Bahasa dipilih dari tombol **ID / EN** (di samping tombol tema), lalu disimpan di `localStorage.lang`. Tanpa pilihan, bahasa mengikuti browser (`navigator.languages`); selain Indonesia/Melayu/Inggris jatuh ke Indonesia.
- Menambah bahasa: buat folder baru (mis. `ja/`) berisi file yang sama, lalu tambahkan kodenya ke `LANGS` dan `LANG_NAMES` di `src/i18n/index.js`.
- Setiap file di `id/` harus punya pasangan di `en/` dengan kunci yang sama. Jalankan `node --test tests/i18n.test.mjs` untuk memeriksanya.
