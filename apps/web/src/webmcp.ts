interface ModelContext {
  registerTool(
    tool: {
      name: string;
      title: string;
      description: string;
      inputSchema: object;
      annotations: { readOnlyHint: boolean; untrustedContentHint: boolean };
      execute(input: unknown): Promise<unknown>;
    },
    options: { signal: AbortSignal },
  ): void | Promise<void>;
}
export function registerSimulationTools(actions: {
  read: () => Promise<unknown>;
  claim: () => Promise<unknown>;
}) {
  const context = (document as Document & { modelContext?: ModelContext }).modelContext;
  if (!context?.registerTool) return () => {};
  const lifecycle = new AbortController();
  for (const tool of [
    {
      name: 'read_local_simulation_ledger',
      title: '读取本地模拟账本',
      description:
        'Read the current demo identity and its TEST_ONLY ledger, refreshing the visible page. No real assets or strategy source.',
      readOnly: true,
      execute: actions.read,
    },
    {
      name: 'complete_test_pass_claim',
      title: '领取固定测试 Pass',
      description:
        'For an already selected demo identity, obtain the fixed 1000 TEST_ONLY Pass entitlement and update the visible page. Idempotent, no payment, no real token mint, no deposit, no strategy execution.',
      readOnly: false,
      execute: actions.claim,
    },
  ]) {
    try {
      void Promise.resolve(
        context.registerTool(
          {
            name: tool.name,
            title: tool.title,
            description: tool.description,
            inputSchema: { type: 'object', properties: {}, additionalProperties: false },
            annotations: { readOnlyHint: tool.readOnly, untrustedContentHint: false },
            async execute(input) {
              if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length)
                throw new Error('EMPTY_OBJECT_REQUIRED');
              return tool.execute();
            },
          },
          { signal: lifecycle.signal },
        ),
      ).catch(() => {
        /* Optional capability; normal UI remains available. */
      });
    } catch {
      /* Unsupported registration must not prevent ordinary interaction. */
    }
  }
  return () => lifecycle.abort();
}
