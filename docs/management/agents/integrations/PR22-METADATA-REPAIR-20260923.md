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
