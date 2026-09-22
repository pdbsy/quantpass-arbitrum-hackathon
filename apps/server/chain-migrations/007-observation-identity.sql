-- Wallet reports are observations until canonical event/state reconciliation succeeds.
-- Retain every original operation and its immutable identity; only reconciled evidence
-- may reserve the canonical transaction. Event/projection uniqueness is unchanged.
DROP INDEX one_operation_per_chain_transaction;
CREATE UNIQUE INDEX one_operation_per_chain_transaction
  ON chain_transactions (chain_id, tx_hash)
  WHERE tx_hash IS NOT NULL AND reconciled = 1;
CREATE INDEX chain_transaction_observation_identity
  ON chain_transactions (chain_id, tx_hash, owner_address, target_address, calldata);

PRAGMA user_version = 7;
