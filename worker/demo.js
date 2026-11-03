/**
 * The nine shared demo accounts (seeded by scripts/seed-demo.mjs; keep in sync with
 * src/auth/demo-accounts.js). Demo is 100% demo: AI answers are simulated, integrations are
 * read-only and email to customers is never sent. Live accounts are 100% live.
 */
export const DEMO_EMAILS = new Set([
  'demo-ac@satualur.id', 'demo-cleaning@satualur.id', 'demo-listrik@satualur.id',
  'demo-pest@satualur.id', 'demo-laundry@satualur.id', 'demo-dinding@satualur.id',
  'demo-mall@satualur.id', 'demo-fm@satualur.id', 'demo-rs@satualur.id',
]);

/** True when user.email (case-insensitive) is one of the shared demo accounts. */
export function isDemoUser(user) {
  return DEMO_EMAILS.has(String(user?.email || '').toLowerCase());
}
