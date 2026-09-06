CREATE TABLE vaults (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  strategy_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 0),
  state_json TEXT NOT NULL,
  digest TEXT NOT NULL,
  UNIQUE (owner_id, strategy_id)
);
CREATE TABLE audit_events (
  vault_id TEXT NOT NULL REFERENCES vaults(id),
  revision INTEGER NOT NULL,
  command_id TEXT NOT NULL,
  command_type TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  PRIMARY KEY (vault_id, revision),
  UNIQUE (vault_id, command_id)
);
PRAGMA user_version = 1;
