# Database Schema

> Superseded by [20_DATABASE.md](20_DATABASE.md) (D1). Dokumen ini dipertahankan sebagai referensi desain lama WorkBuddy/PostgreSQL dan tidak lagi diperbarui.

Skema database lama Satu Alur (desain awal) memakai PostgreSQL via WorkBuddy Cloud Service. Sejak 2026-10-28 aplikasi memakai Cloudflare D1 (SQLite); lihat [20_DATABASE.md](20_DATABASE.md).

## Tables

### requests

Permintaan jasa dari pelanggan.

```sql
CREATE TABLE requests (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner_id TEXT NOT NULL DEFAULT auth.uid(),
  customer_name TEXT NOT NULL,
  service_type TEXT NOT NULL,
  location TEXT,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS Policies
ALTER TABLE requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own requests" ON requests FOR SELECT USING (owner_id = auth.uid());
CREATE POLICY "Users can insert own requests" ON requests FOR INSERT WITH CHECK (owner_id = auth.uid());
CREATE POLICY "Users can update own requests" ON requests FOR UPDATE USING (owner_id = auth.uid());
```

### offers

Penawaran yang dihasilkan AI dan divalidasi.

```sql
CREATE TABLE offers (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner_id TEXT NOT NULL DEFAULT auth.uid(),
  request_id BIGINT NOT NULL REFERENCES requests(id),
  ai_proposal_json JSONB,
  validated_price NUMERIC,
  validated_scope TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE offers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own offers" ON offers FOR SELECT USING (owner_id = auth.uid());
CREATE POLICY "Users can insert own offers" ON offers FOR INSERT WITH CHECK (owner_id = auth.uid());
```

### assignments

Penugasan tenaga pelaksana.

```sql
CREATE TABLE assignments (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner_id TEXT NOT NULL DEFAULT auth.uid(),
  offer_id BIGINT NOT NULL REFERENCES offers(id),
  worker_name TEXT,
  scheduled_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own assignments" ON assignments FOR SELECT USING (owner_id = auth.uid());
CREATE POLICY "Users can insert own assignments" ON assignments FOR INSERT WITH CHECK (owner_id = auth.uid());
```

### completions

Penyelesaian pekerjaan.

```sql
CREATE TABLE completions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner_id TEXT NOT NULL DEFAULT auth.uid(),
  assignment_id BIGINT NOT NULL REFERENCES assignments(id),
  notes TEXT,
  photos_path TEXT[],
  status TEXT NOT NULL DEFAULT 'pending',
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE completions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own completions" ON completions FOR SELECT USING (owner_id = auth.uid());
CREATE POLICY "Users can insert own completions" ON completions FOR INSERT WITH CHECK (owner_id = auth.uid());
```

### ledger_entries

Jurnal pembukuan.

```sql
CREATE TABLE ledger_entries (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner_id TEXT NOT NULL DEFAULT auth.uid(),
  completion_id BIGINT NOT NULL REFERENCES completions(id),
  amount NUMERIC NOT NULL,
  category TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  posted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE ledger_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own ledger" ON ledger_entries FOR SELECT USING (owner_id = auth.uid());
CREATE POLICY "Users can insert own ledger" ON ledger_entries FOR INSERT WITH CHECK (owner_id = auth.uid());
```

### reports

Laporan periode dengan penjelasan AI.

```sql
CREATE TABLE reports (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner_id TEXT NOT NULL DEFAULT auth.uid(),
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  summary_json JSONB,
  explanation_html TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own reports" ON reports FOR SELECT USING (owner_id = auth.uid());
CREATE POLICY "Users can insert own reports" ON reports FOR INSERT WITH CHECK (owner_id = auth.uid());
```

## Enum Values

### Status Values

| Entity | Possible Values |
|--------|----------------|
| requests | `draft`, `submitted` |
| offers | `draft`, `pending_approval`, `approved`, `rejected` |
| assignments | `pending`, `assigned`, `in_progress`, `done` |
| completions | `pending`, `done`, `issue` |
| ledger_entries | `pending`, `posted` |
| reports | `draft`, `final` |

## Relationships

```
requests (1) ───< offers (1) ───< assignments (1) ───< completions (1) ───< ledger_entries
                                                        │
                                                        └──< reports (aggregated)
```
