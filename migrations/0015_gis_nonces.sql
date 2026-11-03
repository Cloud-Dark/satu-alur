-- Google Identity Services (button + One Tap): single-use nonces the browser passes to
-- google.accounts.id.initialize and the Worker checks against the ID token's `nonce` claim.
-- id = SHA-256 of the nonce; rows live 5 minutes and are swept when new nonces are issued.
-- No index besides the primary key: each sign-in writes one row and deletes it.
CREATE TABLE IF NOT EXISTS gis_nonces (
  id TEXT PRIMARY KEY,
  expires_at TEXT NOT NULL
);
