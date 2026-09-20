# Legacy and management browser coverage implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reuse the existing real assertion drivers for legacy product and management dashboard coverage while transporting the exact prepared generated graph and preserving replayable browser lifecycle evidence.

**Architecture:** A coverage adapter creates an isolated runtime root, installs exact generated assets, and launches the existing `tools/verify-ui-browser.mjs` or `tools/verify-management-browser.mjs` unchanged as a child process. A generated Playwright shim installs browser helpers, registers every page with the existing lifecycle collector, and writes the same raw/index artifacts. Source and candidate bindings remain owned by the manager's manifest.

**Tech Stack:** Node 24.21.0, Vite, existing Fastify/static dashboard servers, isolated qualified Playwright/Chrome, Istanbul generated code/maps.

**Files:**

- Create: `tools/coverage/browser-legacy.mjs` — runtime-root preparation, exact production/static asset binding, driver process and shim orchestration.
- Create: `test/coverage-browser-legacy.qualified.test.mjs` — source binding negatives and real legacy/management driver runs.
- Create: this plan.

## Tasks

- [ ] Write red tests for driver selection and changed generated/static source rejection.
- [ ] Implement private runtime root and exact Vite/static asset materialization.
- [ ] Implement generated Playwright shim supporting `browser.newPage` and `context.newPage`, helper bootstrap, and shared lifecycle.
- [ ] Run both existing assertion drivers in the qualified candidate and preserve child stdout/stderr/result artifacts.
- [ ] Replay both collections, run targeted lint/format/tests, commit locally and report exact ref to Macbeth01.

The adapter does not calculate coverage thresholds. It returns raw observations and child workflow status for Macbeth01's total collector. All browser traffic remains restricted to the driver's loopback origin; private DB/runtime data is created below the output directory.
