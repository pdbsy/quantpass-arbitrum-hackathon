// Test-only ownership orchestration. The Windows test owns process identity
// validation and every timeout; this helper grants no PID signalling authority.
const phases = new Set([
  'create-root',
  'setup',
  'exercise',
  'outer-startup',
  'watchdog',
  'cleanup-identities',
  'lifecycle-diagnostic',
  'outer-kill',
  'outer-wait',
  'stdout-destroy',
  'stderr-destroy',
  'outer-exit-check',
  'remove-root',
]);
const codes = new Set([
  'ENOENT',
  'ENOTDIR',
  'EACCES',
  'EPERM',
  'EBUSY',
  'ENOTEMPTY',
  'EIO',
  'ETIMEDOUT',
  'ENOBUFS',
  'EINVAL',
  'ERR_ASSERTION',
  'ABORT_ERR',
  'EARLY_EXIT',
]);

function failureRecord({ error, phase, role }) {
  const record = {
    phase: phases.has(phase) ? phase : 'unknown',
    code: codes.has(error?.code) ? error.code : 'unknown',
  };
  if (['fixture-child', 'registry-parent'].includes(role)) record.role = role;
  if (Number.isInteger(error?.status) && Math.abs(error.status) <= 2_147_483_647)
    record.status = error.status;
  return Object.freeze(record);
}

class FixtureLifecycleError extends Error {
  constructor(records) {
    const [primary, ...secondary] = records;
    super(
      `Windows fixture lifecycle failed; primary=${JSON.stringify(primary)} secondary=${JSON.stringify(secondary)}`,
    );
    this.name = 'FixtureLifecycleError';
    this.primary = primary;
    this.secondary = Object.freeze(secondary);
    // Never attach raw errors: Node's reporter recursively displays cause,
    // AggregateError.errors and custom fields, including native spawnargs.
  }
}

function throwFailures(failures) {
  if (failures.length === 0) return;
  const records = failures.flatMap((failure) =>
    failure.error instanceof FixtureLifecycleError
      ? [failure.error.primary, ...failure.error.secondary]
      : [failureRecord(failure)],
  );
  throw new FixtureLifecycleError(records);
}

export async function runWindowsFixture({
  createRoot,
  setup,
  exercise,
  cleanupIdentities,
  cleanupSteps,
  removeRoot,
}) {
  let root;
  let allocated = false;
  let phase = 'create-root';
  let result;
  // Original error objects are private to this control flow, never published.
  const failures = [];
  try {
    root = await createRoot();
    allocated = true;
    phase = 'setup';
    await setup(root);
    phase = 'exercise';
    result = await exercise();
  } catch (error) {
    failures.push({ phase, error });
  } finally {
    if (allocated) {
      try {
        const identityFailures = await cleanupIdentities();
        for (const failure of identityFailures ?? [])
          failures.push({ phase: 'cleanup-identities', role: failure.role, error: failure.error });
      } catch (error) {
        failures.push({ phase: 'cleanup-identities', error });
      }
      for (const step of cleanupSteps) {
        try {
          await step.run();
        } catch (error) {
          failures.push({ phase: step.phase, error });
        }
      }
      try {
        await removeRoot(root);
      } catch (error) {
        failures.push({ phase: 'remove-root', error });
      }
    }
  }
  throwFailures(failures);
  return result;
}

export async function awaitWindowsExercise(exercise, completion, deadline) {
  const controller = new AbortController();
  const cancellation = new Error('Windows fixture receipt wait cancelled');
  let authenticated = false;
  const work = Promise.resolve().then(() =>
    exercise({
      signal: controller.signal,
      ready: () => {
        controller.signal.throwIfAborted();
        authenticated = true;
      },
    }),
  );
  const workOutcome = work.then(
    (value) => ({ phase: 'exercise', value }),
    (error) => ({ phase: 'exercise', error, failed: true }),
  );
  const startupOutcome = completion.then(
    () =>
      authenticated
        ? new Promise(() => {})
        : { phase: 'outer-startup', error: { code: 'EARLY_EXIT' }, failed: true },
    (error) => ({ phase: 'outer-startup', error, failed: true }),
  );
  const deadlineOutcome = deadline.then(
    () => ({ phase: 'watchdog', error: undefined, failed: true }),
    (error) => ({ phase: 'watchdog', error, failed: true }),
  );
  let outcome = await Promise.race([workOutcome, startupOutcome, deadlineOutcome]);
  if (!outcome.failed && !authenticated) {
    outcome = { phase: 'exercise', error: { code: 'ERR_ASSERTION' }, failed: true };
  }
  if (!outcome.failed) {
    // Receipt/identity work is finished before waiting for outer exit. Keeping
    // completion inside that work would prevent cancellation from joining it.
    outcome = await Promise.race([
      completion.then(
        (value) => ({ phase: 'exercise', value }),
        (error) => ({ phase: 'outer-startup', error, failed: true }),
      ),
      deadlineOutcome,
    ]);
  }
  controller.abort(cancellation);
  // Cancelling the loser is insufficient: join it before any owned teardown.
  const settledWork = await workOutcome;
  const failures = outcome.failed ? [outcome] : [];
  if (
    settledWork.failed &&
    settledWork.error !== outcome.error &&
    settledWork.error !== cancellation &&
    !(settledWork.error?.code === 'ABORT_ERR' && settledWork.error.cause === cancellation)
  ) {
    failures.push(settledWork);
  }
  throwFailures(failures);
  return outcome.value;
}
