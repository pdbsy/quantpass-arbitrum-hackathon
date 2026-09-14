> Current assignments: [M3-ASSIGNMENTS.md](M3-ASSIGNMENTS.md). Existing public Forum ownership and ACK rules remain in force.

# Public PR evidence and manager coordination

GitHub Pull Requests are the public communication channel. Private chats, worktrees, localhost services and local files are not shared. The Agent Forum is a read-only index of original PR text, never a separate source of truth.

## Message schema

Post this block in the publishing worker's own PR description, comment or review:

```text
[AGENT-MESSAGE]

Schema-Version: 1
Agent: Macbeth02
To: Macbeth01
Type: CHECK_IN
Thread: AF-AGENT-SETUP
Reply-To: NONE
Related-PR: https://github.com/pdbsy/quantpass-arbitrum-hackathon/pull/123
Body:
Message body as plain text, at most 4,000 characters.

[/AGENT-MESSAGE]
```

Allowed types are `CHECK_IN`, `NOTICE`, `QUESTION`, `REPLY`, `ACK`, `BLOCKED` and `SUMMARY`. `TASK` is not allowed. `Reply-To` is `NONE` or the exact GitHub URL of the original PR message. A message is `ACKNOWLEDGED` only when the intended worker publishes an `ACK` in that worker's own PR, in the same thread, addressed to the original agent and linked through `Reply-To`.

## Dependency request

```text
DEPENDENCY REQUEST

Requester: Macbeth02
Target Agent: Macbeth03
Related PR: #123
Needed: ...
Interface: ...
Blocking: YES / NO
Reason: ...
Expected integration: ...
```

The requester must not modify the target worker's branch or worktree. Only the user or an explicitly designated manager may reassign ownership.

## Forum data flow and refresh

`npm run forum:sync` uses the currently authorized `gh` CLI to paginate up to 200 PRs and 500 source records within 40 requests, reporting PARTIAL when collection completeness is unproven. It extracts only the supported message blocks, validates links against `https://github.com/pdbsy/quantpass-arbitrum-hackathon/pull/...`, writes `forum-snapshot.json`, and rebuilds `docs/management/dashboard/agent-forum.html`. Tokens are never copied to the snapshot or browser. The page uses text-only DOM rendering and a restrictive CSP.

If GitHub is unavailable, the sync command retains the last trusted messages, marks the source `ERROR`, and exits nonzero. The page marks snapshots older than 15 minutes as `STALE`. Neither state implies that a worker has read a message.

## Identity assurance and PR 11 boundary

Agent-ID validation is workflow/process identity consistency, not cryptographic identity assurance.

Branch, commit subject, Task-ID/Agent-ID trailers and PR title must agree. A shared GitHub account does not establish five independent principals. GitHub PR author/branch/title checks are routing evidence only; GOV-001 and SUPPLY-001 remain OPEN. Worker summaries, retrospectives, decisions and unresolved questions belong in structured PR messages; the read-only Forum indexes them. Existing Worker A/B history has a separate searchable Dashboard view and is never relabelled as Macbeth communication. No local writable-post API was enabled.


## Logical ACK and bounded collection

A source URL can contain several logical messages. To ACK one, set the optional `Reply-To-Message: afm-<16 hex digits>` header to its displayed Message ID and retain `Reply-To` as its original GitHub source URL. The ID is derived from source URL and block index. URL-only legacy ACKs match only when exactly one logical source message exists; ambiguous ACKs match none. Sender, recipient and thread consistency still apply.

Forum synchronization paginates within 40 GitHub requests, 200 pull requests and 500 source records. A reached bound or rejected record makes completeness uncertain and is displayed as PARTIAL, never unqualified OK. Source failure retains the previous snapshot with ERROR. All message content remains inert text with safe GitHub provenance links.

## M3 manager coordination

The current user explicitly authorized Macbeth01 to coordinate Macbeth02–05 through their existing app tasks. Those task receipts record actual baseline reads and blockers; they do not generate GitHub message records, public Forum ACKs, independent approval or signing authority. The registry therefore retains `communication_status=UNVERIFIED` until the public Forum protocol is independently satisfied.
