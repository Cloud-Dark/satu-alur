# API Documentation

## Overview

Satu Alur menggunakan WorkBuddy Cloud SDK untuk semua operasi backend. Tidak ada API kustom — semua komunikasi melalui SDK WorkBuddy.

## Authentication

### Email OTP

```javascript
import { getCloud } from './cloud.js'

const cloud = getCloud()

// Kirim OTP
const { data, error } = await cloud.auth.sendOtp({ email: 'user@example.com' })
// Returns: { verificationId, isExistingUser }

// Verifikasi OTP
const result = await cloud.auth.verifyOtp({
  email: 'user@example.com',
  verificationId: data.verificationId,
  isExistingUser: data.isExistingUser,
  token: '123456'
})
```

### Session Management

```javascript
// Get current session
const { data: session } = await cloud.auth.getSession()

// Listen auth state changes
cloud.auth.onAuthStateChange((event, session) => {
  console.log(event, session)
})

// Sign out
await cloud.auth.signOut()
```

## Database Operations

### Requests

```javascript
const cloud = getCloud()

// Create
await cloud.database.from('requests').insert({
  customer_name: 'PT Maju Jaya',
  service_type: 'Pembersihan AC',
  location: 'Jakarta Selatan',
  description: 'AC 5 unit'
})

// Read all
const { data } = await cloud.database.from('requests')
  .select('*')
  .order('created_at', { ascending: false })

// Read one
const { data } = await cloud.database.from('requests')
  .select('*')
  .eq('id', 1)
  .single()
```

### Offers

```javascript
// Create with AI proposal
await cloud.database.from('offers').insert({
  request_id: 1,
  ai_proposal_json: { scope: '...', price: 500000, terms: '...' },
  validated_price: 500000,
  validated_scope: 'Pembersihan AC 5 unit',
  status: 'draft'
})

// Update status
await cloud.database.from('offers')
  .update({ status: 'approved' })
  .eq('id', 1)
```

## AI Operations

### Generate Offer

```javascript
import { generateOffer } from './ai/agent.js'

const offer = await generateOffer({
  request: { customer_name: '...', service_type: '...' },
  modelId: 'gpt-4o',
  signal: abortController.signal,
  onChunk: (delta, full) => console.log(delta)
})
// Returns: { scope, price, terms, notes }
```

### Explain Report

```javascript
import { explainReport } from './ai/agent.js'

const html = await explainReport({
  report: { total_revenue: 1000000, total_cost: 600000 },
  modelId: 'gpt-4o',
  signal: abortController.signal,
  onChunk: (delta, full) => console.log(delta)
})
// Returns: HTML string
```

## Storage Operations

```javascript
const cloud = getCloud()

// Upload file
const path = cloud.storage.userPath(userId, 'photos/job-1.jpg')
await cloud.storage.upload(path, file, { contentType: file.type })

// Get signed URL
const { data } = await cloud.storage.createSignedUrl(path, 600)
// data.signedUrl
```

## Error Handling

```javascript
try {
  const { data, error } = await cloud.database.from('requests').insert({...})
  if (error) throw error
} catch (err) {
  if (err.code === '23505') {
    // Unique constraint violation
  } else if (err.code === '42501') {
    // RLS permission denied
  }
}
```

## Rate Limits

- Database: 100 requests/minute per user
- AI: Subject to WorkBuddy Cloud quota
- Storage: 100MB per user (default)
