# UI Adaptation Map — AF-UI01

User UI: AlphaForge v3 English. The supplied HTML is the editable bundle; JSX is an opaque iframe wrapper. Original source SHA256 `949627bc39a2076de97d234546ce7bebabda6db330d22b423874063eb0243b45` is preserved exactly.

Contract: Wave 1 v1 `73230c43e464cd1b579fa16a6425756291ef9e8e`. Canonical browser integration uses published backend candidate `f66faa10c2a22f56048b04416cd83a2e8e9dd481`; current-master compatibility uses `0a813de422a02a2b3f0ade7eee693f0d2491ec33`.

| Page | Existing UI | Required Data / Current API | Missing Interface | Integration | Visual Change Required |
| --- | --- | --- | --- | --- | --- |
| Homepage | Press, Pass, editorial shelf, navigation | Session and environment via `/api/session` | Production identity | Original composition plus existing-style local API status controls | NO — original styles |
| Marketplace | Six fixture cards and original filters | `/api/v1/strategies`, account associations | Six fixture IDs have no server mapping | Additional real catalogue with text, status, environment filters; fixture cards remain labelled | NO — existing cards/forms |
| Strategy Detail | Original price and performance charts, rights/risk panels | `/api/v1/strategies/:strategyId`, access and vault state | API has no live performance or risk rating | Preserve fixture detail; actual API IDs use test-access/workspace with truthful capability information | NO — existing terminal/receipt classes |
| Account | Passes, trades, funds, saved, notes, settings | `/api/v1/account`, `/api/v1/vaults`, `/api/v1/vaults/:vaultId/audit` | Production auth | Owner-strategy associations, Pass access, actual balances and pending withdrawals; original local fixtures remain separate | NO — existing receipt/account styles |
| Trading Workspace | Original trade terminal and review dialogs | `/api/v1/vaults/:vaultId`, command endpoint | No execution mapping for six specimen IDs | Thirteen commands on real core/satellite vaults, exact review/retry and audit receipts | NO — existing forms/dialogs |

Session creation remains `/api/demo/session`. Only an initial canonical catalogue 404 enables explicit legacy `/api` compatibility. Other failures never silently downgrade. All opaque catalogue/vault/audit pages and optional account vault pages are consumed. Missing legacy fields display Unavailable.

The two real strategy IDs remain separate owner-strategy-vault relationships. Six original fixtures are never aliases. SQLite is authoritative for API money; the original browser Pass exchange and notes keep their own storage. No backend implementation, dependency, lockfile, global CSS or navigation was changed.

Public endpoint questions and exact-candidate ACK were posted in PR #9; final evidence is in VERIFICATION.md. Approved shared-file changes were limited to the frontend entry/build/test wiring and additive Retry-After metadata; no new lint or format exclusions were needed.
