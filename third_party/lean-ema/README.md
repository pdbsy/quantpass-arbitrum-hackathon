# QuantConnect EMA example provenance

Original author/copyright: QuantConnect Corporation, 2014. License: Apache-2.0, preserved in LICENSE and the original Python header.

Repository: https://github.com/QuantConnect/Lean
Fixed commit: `ebd7268d68609ae85f73de8290d9673afb1992ac`
Source: https://github.com/QuantConnect/Lean/blob/ebd7268d68609ae85f73de8290d9673afb1992ac/Algorithm.Python/MovingAverageCrossAlgorithm.py

Unmodified source SHA-256: `1db7156684722fd9ddeefdffa2a20d5c60bb02bca39cf973027378ea0c660edf`
Unmodified LICENSE SHA-256: `522cf0a716ce03f67d46f8fceb5bf78c5b84400ec5cd8d14bf9f02cddc1cb6ba`

The original Python file is retained for inspection, not imported/executed. AlphaForge's `packages/automata/src/ema-strategy.ts` is an explicitly modified adaptation: existing Node runtime, EMA seeded by the period SMA, deterministic fixed-point division rounded down (12 decimal places in currency), multiple eligible assets with configured target budgets, and synthetic observation periods rather than SPY daily bars. The long/flat entry/exit condition and 0.00015 entry tolerance are retained. The adapter emits targets only on a transition; execution, partial fills and liquidation are AlphaForge responsibilities. It is not a byte-for-byte or numerical-parity claim about LEAN, nor a strategy performance endorsement.
