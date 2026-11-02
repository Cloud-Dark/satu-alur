# Satu Alur MCP (Model Context Protocol) Specification

> Status: Draft  
> Version: 1.0.0  
> Last updated: 2026-11-02  
> Owner: Platform Team

## Overview

**Model Context Protocol (MCP)** for Satu Alur is an open connector framework that enables seamless integration between Satu Alur and existing enterprise systems (ERP, CRM, accounting software, legacy databases). It allows companies to:

1. **Connect** their existing systems without replacing them
2. **Synchronize** data bidirectionally or unidirectionally
3. **Migrate** gradually from legacy systems without a "big bang" approach
4. **Extend** Satu Alur capabilities through custom connectors

The protocol is designed for Indonesian service businesses that already run on systems like Odoo, SAP Business One, Oracle NetSuite, or custom-built applications.

---

## 1. Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        SATU ALUR PLATFORM                        │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │   Web App    │  │  Cloudflare  │  │      D1 Database     │  │
│  │  (Vite+JS)   │◄─┤   Worker     │◄─┤   (SQLite)           │  │
│  └──────────────┘  └──────┬───────┘  └──────────────────────┘  │
│                           │                                      │
│                    ┌──────┴──────┐                              │
│                    │  MCP Engine   │                              │
│                    │  (worker)     │                              │
│                    └──────┬──────┘                              │
└───────────────────────────┼─────────────────────────────────────┘
                            │
              ┌─────────────┼─────────────┐
              │             │             │
         ┌────┴───┐   ┌────┴───┐   ┌────┴───┐
         │ REST   │   │ Direct │   │ File   │
         │ API    │   │ DB     │   │ Import │
         └───┬────┘   └───┬────┘   └───┬────┘
             │            │            │
      ┌──────┴──────┐    │     ┌──────┴──────┐
      │  External   │    │     │  External   │
      │  ERP/CRM    │    │     │  Database   │
      └─────────────┘    │     └─────────────┘
                         │
                    ┌────┴────┐
                    │ CSV/XML │
                    │  Upload │
                    └─────────┘
```

### 1.1 Connector Types

| Type | Description | Use Case | Authentication |
|------|-------------|----------|----------------|
| **REST API** | HTTP-based sync with external REST endpoints | Modern ERPs (Odoo, SAP S/4HANA) | API Key, OAuth 2.0, Basic Auth |
| **Direct DB** | Read from external database directly | Legacy systems, on-premise databases | Connection string (read-only recommended) |
| **File Import** | CSV/Excel/XML upload with field mapping | One-time migration, periodic batch imports | File upload + mapping configuration |
| **Webhook** | Event-driven push from external system | Real-time updates from ERP | HMAC signature verification |

### 1.2 Sync Strategies

| Strategy | Direction | Latency | Complexity | Best For |
|----------|-----------|---------|------------|----------|
| **Real-time** | Bidirectional | < 1s | High | High-volume transactional systems |
| **Scheduled** | Uni/Bidirectional | Minutes/Hours | Medium | Daily batch reconciliation |
| **Manual** | Import/Export | On-demand | Low | One-time migration, ad-hoc sync |
| **Event-driven** | Push/Pull | Near real-time | Medium | Webhook-based integrations |

### 1.3 Migration Strategies

| Strategy | Description | Risk | Duration | Data Loss Risk |
|----------|-------------|------|----------|----------------|
| **Parallel Running** | Both systems active; gradual cutover per module | Low | 3-6 months | None |
| **Phased Module** | Migrate one module at a time (requests → offers → assignments) | Low-Medium | 2-4 months | Minimal |
| **Big Bang** | Switch everything at once | High | 1-2 days | High (not recommended) |
| **Read-Only Legacy** | Legacy becomes read-only reference | Medium | 1-2 months | None |

---

## 2. Data Mapping

### 2.1 Entity Mapping

```
External System                  Satu Alur
─────────────────────────────────────────────────────────
Customers/Contacts      ─────►   requests.customer_name
                                 workers.name

Sales Orders            ─────►   requests (status: converted)
                                 offers
                                 assignments

Products/Services       ─────►   vas_items
                                 requests.service_type

Employees/Resources     ─────►   workers
                                 assignment_workers

Invoices                ─────►   ledger_entries
                                 completions

Projects/Tasks          ─────►   assignments
                                 completions
```

### 2.2 Field Mapping Configuration

Each connector defines a `mapping` object that maps external fields to Satu Alur fields:

```javascript
{
  "entity": "requests",
  "source": "sales_orders",
  "direction": "inbound",  // inbound | outbound | bidirectional
  "syncStrategy": "scheduled",
  "schedule": "0 2 * * *",  // Cron: daily at 2 AM
  "fields": [
    {
      "source": "customer_name",
      "target": "customer_name",
      "transform": "trim",
      "required": true
    },
    {
      "source": "service_code",
      "target": "service_type",
      "transform": "map",
      "mapping": {
        "SRV-001": "AC Cleaning",
        "SRV-002": "AC Repair",
        "SRV-003": "Plumbing"
      }
    },
    {
      "source": "order_date",
      "target": "requested_at",
      "transform": "date:ISO8601",
      "required": true
    },
    {
      "source": "total_amount",
      "target": "validated_price",
      "transform": "number",
      "required": false
    }
  ],
  "filters": {
    "source": "status = 'confirmed' AND created_at > :last_sync"
  }
}
```

### 2.3 Transform Functions

| Transform | Input | Output | Example |
|-----------|-------|--------|---------|
| `trim` | String | Trimmed string | `"  John Doe  "` → `"John Doe"` |
| `uppercase` | String | Upper case | `"ac cleaning"` → `"AC Cleaning"` |
| `lowercase` | String | Lower case | `"AC Repair"` → `"ac repair"` |
| `date:ISO8601` | Any date | ISO 8601 string | `2026-11-01` → `"2026-11-01T00:00:00.000Z"` |
| `number` | String/Number | Number | `"1500000"` → `1500000` |
| `map` | String | Mapped value | `"SRV-001"` → `"AC Cleaning"` |
| `concat` | Array | String | `["John", "Doe"]` → `"John Doe"` |
| `split` | String | Array | `"AC,Cleaning"` → `["AC","Cleaning"]` |
| `json` | Object | JSON string | `{skills: ["ac"]}` → `'{"skills":["ac"]}'` |

---

## 3. Connector Configuration

### 3.1 REST API Connector

```javascript
{
  "id": "odoo-connector-01",
  "name": "Odoo ERP Production",
  "type": "rest",
  "enabled": true,
  "auth": {
    "type": "apikey",  // apikey | oauth2 | basic
    "apiKey": "${env.ODOO_API_KEY}",
    "headerName": "X-Api-Key"
  },
  "endpoint": {
    "baseUrl": "https://erp.company.id/api/v1",
    "timeout": 30000,
    "retry": {
      "maxAttempts": 3,
      "backoff": "exponential"
    }
  },
  "mappings": [ /* array of field mappings */ ],
  "sync": {
    "strategy": "scheduled",
    "schedule": "0 */6 * * *",  // Every 6 hours
    "batchSize": 100
  },
  "conflictResolution": "source-wins"  // source-wins | target-wins | manual | timestamp
}
```

### 3.2 Direct Database Connector

```javascript
{
  "id": "legacy-db-01",
  "name": "Legacy MySQL Database",
  "type": "database",
  "enabled": true,
  "connection": {
    "driver": "mysql",  // mysql | postgresql | mssql | sqlite
    "host": "db.company.id",
    "port": 3306,
    "database": "erp_legacy",
    "username": "${env.DB_USER}",
    "password": "${env.DB_PASS}",
    "ssl": true,
    "readOnly": true  // STRONGLY recommended
  },
  "mappings": [ /* array of field mappings */ ]
}
```

### 3.3 File Import Connector

```javascript
{
  "id": "csv-import-01",
  "name": "Monthly Customer Import",
  "type": "file",
  "enabled": true,
  "format": "csv",  // csv | xlsx | xml | json
  "delimiter": ",",
  "encoding": "utf-8",
  "hasHeader": true,
  "mappings": [ /* array of field mappings */ ],
  "validation": {
    "requiredColumns": ["customer_name", "service_type"],
    "skipInvalidRows": true,
    "maxErrors": 50
  }
}
```

---

## 4. Migration Engine

### 4.1 Migration Process

```
Phase 1: Discovery (Days 1-3)
  └─ Analyze source database schema
  └─ Identify entities and relationships
  └─ Map to Satu Alur schema
  └─ Generate mapping configuration

Phase 2: Extract & Transform (Days 4-7)
  └─ Extract data from source system
  └─ Apply field transformations
  └─ Validate data integrity
  └─ Generate preview report

Phase 3: Dry Run (Days 8-10)
  └─ Run migration to staging environment
  └─ Compare record counts
  └─ Validate data accuracy (spot checks)
  └─ Generate discrepancy report

Phase 4: Live Migration (Days 11-14)
  └─ Enable parallel running
  └─ Sync initial data batch
  └─ Set up incremental sync
  └─ Monitor for errors

Phase 5: Validation (Days 15-21)
  └─ Run reports on both systems
  └─ Compare totals (customers, revenue, jobs)
  └─ Fix discrepancies
  └─ Train users on new system

Phase 6: Cutover (Day 22+)
  └─ Switch primary system to Satu Alur
  └─ Legacy system becomes read-only
  └─ Monitor for 30 days
  └─ Archive legacy data
```

### 4.2 Migration Configuration

```javascript
{
  "migration": {
    "name": "ERP to Satu Alur Q4 2026",
    "strategy": "parallel",
    "phases": [
      {
        "phase": 1,
        "name": "Master Data",
        "entities": ["workers", "vas_items"],
        "validation": {
          "rowCountTolerance": 0,
          "checksumSampleSize": 100
        }
      },
      {
        "phase": 2,
        "name": "Open Requests",
        "entities": ["requests", "offers"],
        "filters": {
          "requests": "status IN ('draft', 'open')",
          "offers": "status IN ('draft', 'sent')"
        }
      },
      {
        "phase": 3,
        "name": "Historical Data",
        "entities": ["assignments", "completions", "ledger_entries"],
        "dateRange": {
          "from": "2026-01-01",
          "to": "2026-10-31"
        }
      }
    ],
    "rollback": {
      "enabled": true,
      "backupTables": true,
      "retentionDays": 30
    }
  }
}
```

---

## 5. Security Model

### 5.1 Authentication

| Method | Description | Risk Level |
|--------|-------------|------------|
| **API Key** | Static key in header | Medium |
| **OAuth 2.0** | Token-based with refresh | Low |
| **Basic Auth** | Username/password (HTTPS only) | Medium |
| **IP Whitelist** | Restrict by source IP | Low |
| **HMAC** | Request signing for webhooks | Low |

### 5.2 Data Protection

- All connector credentials stored encrypted at rest
- API keys never returned in API responses
- Connection strings use environment variables, never hardcoded
- Read-only database connections strongly recommended
- All traffic over HTTPS/TLS 1.3

### 5.3 Audit Trail

```javascript
{
  "syncLog": {
    "id": "sync-20261102-001",
    "connectorId": "odoo-connector-01",
    "startedAt": "2026-11-02T02:00:00Z",
    "endedAt": "2026-11-02T02:03:15Z",
    "status": "completed",
    "records": {
      "processed": 156,
      "inserted": 12,
      "updated": 144,
      "failed": 0,
      "skipped": 2
    },
    "errors": []
  }
}
```

---

## 6. Error Handling

### 6.1 Error Categories

| Code | Description | Retry | Action |
|------|-------------|-------|--------|
| `CONN_TIMEOUT` | Connection timeout | Yes (3x) | Alert admin |
| `AUTH_FAILED` | Authentication error | No | Check credentials |
| `SCHEMA_MISMATCH` | Source schema changed | No | Update mapping |
| `VALIDATION_ERROR` | Data validation failed | No | Review in UI |
| `RATE_LIMITED` | API rate limit hit | Yes (backoff) | Wait and retry |
| `CONFLICT` | Record conflict | No | Manual resolution |

### 6.2 Dead Letter Queue

Failed records are stored in a `sync_errors` table for manual review:

```sql
CREATE TABLE IF NOT EXISTS sync_errors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id TEXT NOT NULL,
  sync_id TEXT NOT NULL,
  connector_id TEXT NOT NULL,
  entity TEXT NOT NULL,
  source_data TEXT,
  error_message TEXT NOT NULL,
  error_code TEXT,
  retry_count INTEGER DEFAULT 0,
  status TEXT DEFAULT 'open',  -- open | resolved | ignored
  created_at TEXT NOT NULL,
  resolved_at TEXT
);
```

---

## 7. API Endpoints (Worker)

### 7.1 Connector Management

```
POST   /api/mcp/connectors       → Create connector
GET    /api/mcp/connectors       → List connectors
GET    /api/mcp/connectors/:id   → Get connector
PUT    /api/mcp/connectors/:id   → Update connector
DELETE /api/mcp/connectors/:id   → Delete connector
POST   /api/mcp/connectors/:id/test  → Test connection
```

### 7.2 Sync Operations

```
POST   /api/mcp/sync             → Trigger sync
GET    /api/mcp/sync/:id         → Get sync status
GET    /api/mcp/sync/:id/log     → Get sync log
POST   /api/mcp/sync/:id/cancel  → Cancel running sync
```

### 7.3 Migration

```
POST   /api/mcp/migrate          → Start migration
GET    /api/mcp/migrate/:id      → Get migration status
GET    /api/mcp/migrate/:id/preview  → Preview migration
POST   /api/mcp/migrate/:id/rollback → Rollback migration
```

### 7.4 Mapping

```
POST   /api/mcp/mapping/discover → Auto-discover source schema
POST   /api/mcp/mapping/validate → Validate mapping configuration
POST   /api/mcp/mapping/preview  → Preview transformed data
```

---

## 8. UI Components (Pengaturan)

### 8.1 Pengaturan Tabs

The MCP section in Pengaturan consists of four tabs:

| Tab | Description |
|-----|-------------|
| **Konektor** | Manage REST, DB, and file connectors |
| **Pemetaan** | Field mapping configuration per entity |
| **Migrasi** | Migration wizard and status monitoring |
| **Log Sinkronisasi** | Sync history and error review |

### 8.2 Migration Wizard Steps

1. **Pilih Sumber** → Choose connector type and configure connection
2. **Pemetaan Bidang** → Map source fields to Satu Alur fields
3. **Pratinjau** → Preview transformed data (first 10 rows)
4. **Validasi** → Run validation checks
5. **Jalankan** → Execute migration with progress bar
6. **Verifikasi** → Compare counts and spot-check data

---

## 9. Supported ERP Systems

### 9.1 Pre-built Connectors

| System | Type | Status | Notes |
|--------|------|--------|-------|
| **Odoo** | REST API | Planned | Community & Enterprise editions |
| **SAP Business One** | REST API | Planned | Service Layer required |
| **Oracle NetSuite** | REST API | Planned | SuiteTalk API |
| **Accurate Online** | REST API | Planned | Popular in Indonesia |
| **Mekari Jurnal** | REST API | Planned | Indonesian accounting |
| **MySQL** | Direct DB | Available | Generic connector |
| **PostgreSQL** | Direct DB | Available | Generic connector |
| **Microsoft SQL Server** | Direct DB | Planned | Generic connector |
| **CSV/Excel** | File | Available | Universal import |

### 9.2 Custom Connector SDK

Developers can build custom connectors using the MCP SDK:

```javascript
// Example custom connector
import { defineConnector } from '@satualur/mcp-sdk'

export default defineConnector({
  id: 'custom-erp',
  name: 'My Custom ERP',
  version: '1.0.0',
  
  async connect(config) {
    // Initialize connection
    return { client, version }
  },
  
  async fetch(client, entity, filters) {
    // Fetch data from source
    return records
  },
  
  async push(client, entity, records) {
    // Push data to source
    return results
  },
  
  async disconnect(client) {
    // Clean up
  }
})
```

---

## 10. Implementation Roadmap

| Phase | Deliverable | ETA | Priority |
|-------|-------------|-----|----------|
| 1 | MCP Specification & Data Migration UI | Nov 2026 | P0 |
| 2 | CSV/Excel Import + Field Mapping | Nov 2026 | P0 |
| 3 | REST API Connector Framework | Dec 2026 | P1 |
| 4 | Odoo Connector | Dec 2026 | P1 |
| 5 | Direct DB Connector (MySQL/PostgreSQL) | Jan 2027 | P1 |
| 6 | SAP B1 & NetSuite Connectors | Q1 2027 | P2 |
| 7 | Webhook + Real-time Sync | Q1 2027 | P2 |
| 8 | Custom Connector SDK | Q2 2027 | P3 |

---

## Appendix A: Glossary

| Term | Definition |
|------|------------|
| **MCP** | Model Context Protocol — the connector framework |
| **Connector** | A configured link to an external system |
| **Mapping** | Field-level transformation rules between systems |
| **Sync** | The process of exchanging data between systems |
| **Migration** | One-time or phased transfer of data to Satu Alur |
| **Entity** | A business object (customer, order, product, etc.) |
| **Dry Run** | Simulated execution without writing data |
| **Big Bang** | All-at-once migration (high risk) |
| **Parallel Running** | Both systems active during transition (low risk) |
