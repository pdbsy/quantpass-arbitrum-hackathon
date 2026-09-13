# Migrated Wave 1 product API

Canonical source is pdbsy/quantpass-arbitrum-hackathon. Product routes/catalog/owner mappings are imported from AF-BE01; target legacy and canonical errors both retain the exact `{error}` response body. The target statistics read port and domain/storage rules remain authoritative. [Historical API design](../migration/legacy-quantpass/tree/docs/api/AF-BE01-product-api.md) and [fixtures](fixtures/AF-BE01.json) record the source; archived richer error examples are historical, not the target response contract. Tests in test/product-api.test.ts and the unchanged target server/HTTP tests define current behavior. This is a local/mock ledger, with no chain writes.


## Atomic product refresh

`GET /api/v1/product-snapshot` requires the existing demo session and accepts no query parameters. It returns schemaVersion 1, TEST_ONLY scope, ownerId, account, vaults, details with accountStrategy relationships, audit rows with ownerId/vaultId, and a vaultId-to-revision map. All mutable values come from one SQLite read transaction; the separate strategy catalogue is static. Collection is bounded by the registered catalogue and 10,000 audit entries per vault; overflow fails instead of returning an incomplete snapshot. Existing individual endpoints remain compatible.

The canonical web adapter stages this response and commits only after ProductClient accepts the request generation. Rejected or failed refreshes keep the prior complete projection visibly non-ready. Equal-revision state divergence is RESPONSE_CONTEXT_MISMATCH; audit keys include owner, vault and command.
