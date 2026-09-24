import test from 'node:test';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const approvedBrowserTool =
  process.env.AF_PLAYWRIGHT_PATH ||
  (process.env.AF_QUALIFIED_BROWSER_TOOLS && resolve(process.env.AF_QUALIFIED_BROWSER_TOOLS, 'index.mjs'));

// Finding003: actual M3 execution, with explicitly labeled native-boundary faults.
test(
  'FAULT_INJECTED actual M3 cleanup retains primary errors and delays success',
  { timeout: 1_200_000 },
  async (t) => {
    const { verifyM3Cleanup } = await import('./helpers/m3-browser-cleanup.mjs');
    await verifyM3Cleanup(t, root, resolve(approvedBrowserTool));
  },
);

test(
  'FAULT_INJECTED actual M3 collector persists primary and cleanup through workflow report',
  { timeout: 600_000 },
  async (t) => {
    const { verifyM3CollectorFailure } = await import('./helpers/m3-browser-cleanup.mjs');
    await verifyM3CollectorFailure(t, root, resolve(approvedBrowserTool));
  },
);
