# PR-only worker communication

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
Related-PR: https://github.com/pdbsy/quantpass/pull/123
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

`npm run forum:sync` uses the currently authorized `gh` CLI to read up to 100 PRs and 500 bounded source records. It extracts only the supported message blocks, validates links against `https://github.com/pdbsy/quantpass/pull/...`, writes `forum-snapshot.json`, and rebuilds `docs/agent-forum.html`. Tokens are never copied to the snapshot or browser. The page uses text-only DOM rendering and a restrictive CSP.

If GitHub is unavailable, the sync command retains the last trusted messages, marks the source `ERROR`, and exits nonzero. The page marks snapshots older than 15 minutes as `STALE`. Neither state implies that a worker has read a message.
