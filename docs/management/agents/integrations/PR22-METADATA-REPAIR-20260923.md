# PR22 authorized metadata repair

[AlphaForge][Robinhood][M3-01-PHASE1-CLOSEOUT][Macbeth01]

The user approved this exact exception on 2026-09-23. Only the two manager merge messages gained identity metadata and original commit references; three successors were reconnected. Every tree, author, committer timestamp and worker parent is preserved. No force push was performed. Anchor001 is unchanged.

Original chain retained at `refs/alphaforge/metadata-repair/pr22-20260923-original`.

| Original | Corrected | Tree | Message changed |
| --- | --- | --- | --- |
| 63900a277fde5a523b2fd46d9cf9915ae15ee3ff | 1a2c28cf626904995cd47e85b75092f168255bd5 | 0fb2de3d981f34160c327509e91be09903efba1c | True |
| 07039d2255336a2236d63db8d4dac64077cfdf85 | b7501cd90dcb4c67e14770d93b998482e1b2ae55 | 9a7d3329e4f1f971e54dfcf76358890bd555090d | True |
| 8bf3dd2f108fa993a011bae574c421e93ea3f810 | 192e14b144b10639139c4420e807b46ff865d5e9 | a915e8078e4fde08670f5f5f549ec9616cd5086f | False |
| 12f74d718727282a8464630c2754f277ba483bd2 | fff90762e402bb2a1877c52dd858f71d2b9c71c9 | 3088baa1529af04d520644d985d9dc5b93d3dbea | False |
| 1f1bee0a32092fd804b7ff55cd69f02f397f9993 | b4723a74c4a6b8d364fa93da4a3cafd27812afec | 2c6979acabca5b523bd4a47fa22fc2d5a775045a | False |

The old remote head `3a78e34ba933f1e3239424d3bf0b1e27b1a65bb8` remains an ancestor. Original scan and diagnostic reports retain their original commit bindings; code-identical repair does not relabel them as final-head CI.

## Additional runner source repair

The user separately approved the two new Macbeth03 subject corrections and their two manager successors. The original bodies, trees, author/committer identities and timestamps remain byte-equivalent; only the subjects and required parent links changed. Original worker checkout and branch are preserved. Corrected source branch: `macbeth03/m3-pr22-runner-closeout-corrected`.

- `refs/alphaforge/metadata-repair/pr22-runner-20260923-original-manager` → `068bdbb337ffc9f06d4e4f9551326ed2a9a38de8`
- `refs/alphaforge/metadata-repair/pr22-runner-20260923-original-source` → `bccc22ec3f9b5025ac80573c86dac8b1a63f10a0`

| Original | Corrected | Tree | Message changed |
| --- | --- | --- | --- |
| 4513a20d47a4db86dfdd873b061ad34972b3074c | 8dd163cf916dfc4daa230360bcc9375f966b93f2 | 3257db2a53075489e458b37cfb56f8375f7d24d9 | True |
| bccc22ec3f9b5025ac80573c86dac8b1a63f10a0 | 68c307dcc46c21f16fe50d3ddaf9a53162ad59e7 | 1c250d1eabe4531ba8579816ce6afb2877c5dfb2 | True |
| 7d956a0f79e160ae9bf68d80c8550c4941e55abb | 24177578e0415771619109bfc16d3df53fc07eac | 7e4dfd3ba3d93f74fcb070b03244620f9877988f | False |
| 068bdbb337ffc9f06d4e4f9551326ed2a9a38de8 | 002ff73544211d15cb1cbbec593cd2675d80b9a2 | 6306636c4e752ee38bb9abe463d1ac6910384fcf | False |

The source subject must include the registered Agent-ID before admission, in addition to both body trailers. All later incoming ranges are validated before integration. No rule or required check was weakened; Anchor001 is unchanged.


## Additional single UI source repair

The user explicitly approved this separate one-commit exception during the current closeout. Only the missing `Agent-ID: Macbeth04` and `Task-ID: M3-04-PHASE1-PRODUCT` body trailers were appended. The entire commit header is byte-identical, including tree, parent, author, committer and all timestamps. There are no reconnected descendants. The original remains under `refs/alphaforge/metadata-repair/pr22-ui-20260923-original-source`; Anchor001 is unchanged.

| Original | Corrected | Tree | Parent |
| --- | --- | --- | --- |
| 14b4bb0e28702fd52c5dbc4e0df7b0f01ca73025 | 04372fc9658c946db756b56aa1c2d38d65c063d7 | 3884ea2d8eab633080e25a9d01a1995a1d4587f7 | f0108b41ecbf848f2d23a0bcb695ff7cd97dd3dc |

The original strict identity check failed with `body is required`; the corrected three-commit range from `7e683e7` passes unchanged rules. Macbeth05 independently verified the object mapping and the identical code tree, preserving its actual code-test binding rather than relabeling it as hosted CI. No force push or remote mutation was part of the repair.
