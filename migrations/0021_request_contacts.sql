-- Optional customer contacts on a request, filled by hand or from "Cari dari peta"
-- (OpenStreetMap email / website / WhatsApp / Instagram / Facebook tags).
-- `website` is free text: "contoh.id · WA 0812… · IG @usaha". Nullable, no backfill.
ALTER TABLE requests ADD COLUMN email TEXT;
ALTER TABLE requests ADD COLUMN website TEXT;
