// Demo accounts: one-click logins to the seeded demo businesses. Everything
// a demo account sees is fictional; worker routes use isDemoUser() to keep
// demo sessions away from live data sources.
export const DEMO_EMAILS = new Set([
  'demo-ac@satualur.id', 'demo-cleaning@satualur.id', 'demo-listrik@satualur.id',
  'demo-pest@satualur.id', 'demo-laundry@satualur.id', 'demo-dinding@satualur.id',
  'demo-mall@satualur.id', 'demo-fm@satualur.id', 'demo-rs@satualur.id',
]);

export function isDemoUser(user) {
  return DEMO_EMAILS.has(String(user?.email || '').toLowerCase());
}
