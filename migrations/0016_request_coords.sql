-- Optional coordinates of a request picked from the map in the Permintaan wizard
-- ("Cari dari peta"). Nullable, no backfill; same names as workers.lat/lng.
ALTER TABLE requests ADD COLUMN lat REAL;
ALTER TABLE requests ADD COLUMN lng REAL;
