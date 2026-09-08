# HOST BASELINE REPORT

- Report ID: `HOST-BASELINE-2026-09-08`
- Worker: `Worker B`
- Collected: `2026-09-08T13:41:34+08:00`
- Scope: read-only inspection of the Mac host
- Baseline status: `VERIFIED_DONE`
- SSH host readiness: `BLOCKED`

## Executive status

The Mac is reachable on TCP/22 through its private LAN address and the native macOS OpenSSH launchd socket is enabled. The host is not ready for acceptance: the macOS application firewall is disabled, `authorized_keys` is absent, `tmux` is not installed, and no Windows client or disconnect/reconnect flow has been tested.

No system setting, SSH configuration, firewall setting, key file, package, or credential was changed while collecting this report.

## Host identity

| Check | Observed value | Evidence status |
| --- | --- | --- |
| macOS | `26.6.2` (`25G83`) | `VERIFIED` via `sw_vers` |
| Architecture | `arm64` | `VERIFIED` via `uname -m` |
| User | `ikol` | `VERIFIED` via `id -un` |
| Runtime hostname | `Mac.lan` | `VERIFIED` via `hostname` |
| Computer name | `WONDER-OF-U` | `VERIFIED` via `scutil` |
| Local host name | `WONDER-OF-U-2` | `VERIFIED` via `scutil` |
| Explicit system HostName | Not set | `VERIFIED`; the privileged API was unavailable, but `scutil` reported no value |
| Login shell | `/bin/bash` | `VERIFIED`; Bash `3.2.57` |
| Available Zsh | `5.9` | `VERIFIED` |
| Default LAN interface | `en0` | `VERIFIED` via default route |
| LAN address | `192.168.2.222` | `VERIFIED` via `ipconfig getifaddr en0` |
| Default gateway | `192.168.2.1` | `VERIFIED` via route table |

The address and gateway are RFC1918 private-network values. No public listener or router port-forwarding configuration was inspected or created.

## SSH and Remote Login

| Check | Result | Status |
| --- | --- | --- |
| Native service | `/System/Library/LaunchDaemons/ssh.plist` / `com.openssh.sshd` | `VERIFIED` |
| launchd policy | Service marked enabled; passive socket activation configured | `VERIFIED` |
| Daemon process | Not continuously running at inspection time | `EXPECTED`; launchd starts it on connection |
| Loopback TCP/22 | Connection succeeded | `VERIFIED` |
| LAN TCP/22 | Connection to `192.168.2.222:22` succeeded | `VERIFIED` |
| Remote Login UI setting | Direct `systemsetup` read requires administrator authorization | `NOT_AVAILABLE` |
| Effective sshd config dump | `sshd -T` could not read host private keys without elevated access | `NOT_AVAILABLE` |
| Explicit config | `AuthorizedKeysFile .ssh/authorized_keys`; `UsePAM yes` | `VERIFIED` from readable config |
| Password authentication | No explicit override found in readable config | `NOT_VERIFIED`; no assumption made about the effective default |
| Public-key authentication | No explicit override found; user authorization file is absent | `BLOCKED` for inbound key acceptance |
| Root login policy | No explicit override found in readable config | `NOT_VERIFIED` |

The successful LAN TCP handshake proves a listener is reachable; it does not prove that a Windows client can authenticate.

## SSH key material

Only metadata and public fingerprints were inspected. Private key contents, authentication tokens, credentials, cookies, and Codex configuration were not read or printed.

| Check | Result | Status |
| --- | --- | --- |
| `~/.ssh` permissions | `0700` | `PASS` |
| Ed25519 private key permissions | `0600` | `PASS` |
| RSA private key permissions | `0600` | `PASS` |
| Public keys | One Ed25519 and one 2048-bit RSA public key present | `OBSERVED` |
| `authorized_keys` | Absent | `BLOCKED` |
| SSH agent inventory | Sandbox could not connect to the agent | `NOT_VERIFIED` |
| Host public keys | ECDSA, RSA-3072, and Ed25519 host public keys present | `VERIFIED` |

Public host-key fingerprints must be delivered to the Windows client through a trusted channel during B3. They are intentionally not copied into the public repository in this baseline.

## Firewall

| Check | Result | Status |
| --- | --- | --- |
| macOS application firewall | Disabled | `HIGH-RISK GAP` |
| Stealth mode | Off | `OBSERVED` |
| Block-all mode | Disabled | `OBSERVED` |

The target explicitly forbids disabling the firewall. The current state predates Worker B's work and must be corrected or explicitly accepted before the SSH host can pass B2. Enabling the firewall is a visible system configuration change and requires an approval checkpoint.

## Developer toolchain

| Tool | Version / path | Status |
| --- | --- | --- |
| Homebrew | `5.0.16`, `/opt/homebrew/bin/brew` | `PASS` |
| Git | Apple Git `2.50.1`, `/usr/bin/git` | `PASS` |
| Node.js | `v24.2.0`, `/opt/homebrew/bin/node` | `PASS` |
| npm | `11.3.0`, `/opt/homebrew/bin/npm` | `PASS` |
| Codex CLI | `0.153.4`, `/opt/homebrew/bin/codex` | `PASS` for executable/version check only |
| tmux | Not installed or not on `PATH` | `BLOCKED` |

Codex command execution inside an SSH session has not been verified and remains a B3 acceptance item.

## Project filesystem and Git

| Check | Result | Status |
| --- | --- | --- |
| Project path | `/Users/ikol/Documents/ChatGPT/quant meme/work/quantpass-arbitrum-hackathon` | `VERIFIED` |
| Filesystem | Local APFS on `/System/Volumes/Data` | `PASS`; not an SMB working tree |
| Available capacity | Approximately `59 GiB` | `WARNING` |
| Volume utilization | `87%` | `WARNING`; monitor before large build/log workloads |
| Branch | `codex/supply-security-evidence` | `VERIFIED` |
| Baseline commit | `00c4e35ce8abded0e9a5fec6ee3d07c27fcc4674` | `VERIFIED` |
| Working tree before report | Clean | `VERIFIED` |

## Problems found

1. `HIGH`: macOS application firewall is disabled.
2. `BLOCKER`: `~/.ssh/authorized_keys` does not exist, so the required Windows public key is not authorized.
3. `BLOCKER`: `tmux` is unavailable.
4. `UNVERIFIED`: Windows-to-Mac authentication and host-key verification have not been exercised.
5. `UNVERIFIED`: tmux survival across SSH disconnect/reconnect has not been exercised.
6. `UNVERIFIED`: Codex CLI has not been executed inside the remote SSH session.
7. `WARNING`: the data volume is 87% utilized.
8. `NOT AVAILABLE`: exact effective password/root-login policy could not be obtained without privileged inspection.

## Security boundaries and decisions

- Do not expose TCP/22 or the dashboard through router port forwarding.
- Do not bind the future dashboard or project preview to a LAN interface by default.
- Prefer an SSH tunnel for Windows dashboard access.
- Do not copy a private key between machines; authorize a Windows-generated public key.
- Do not disable password authentication until public-key access has been externally verified and the user separately approves the lock-down.
- Do not publish SSH private-key content, credentials, `~/.codex`, or raw unsanitized logs.
- Host public-key fingerprints are operational evidence but are withheld from the public repository; B3 must compare them through a trusted out-of-band channel.

## B2 approval checkpoint

Before changing the host, record approval for this exact change set:

1. Enable the macOS application firewall without enabling block-all mode.
2. Install `tmux` with Homebrew.
3. Create `~/.ssh/authorized_keys` with mode `0600` and add only the Windows client's public key.
4. Preserve password authentication until B3 key authentication is proven and a separate lock-down decision is approved.
5. Keep SSH and future dashboard services LAN/private or loopback-only; create no router forwarding.
