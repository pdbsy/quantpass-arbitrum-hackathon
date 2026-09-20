import type { FastifyInstance } from 'fastify';
import { DomainError } from '../../../packages/domain/src/vault.ts';
import {
  asAddress,
  asHexData,
  asTransactionHash,
  sameAddress,
  type Address,
  type HexData,
  type TransactionHash,
} from '../../../packages/chain-adapter/src/types.ts';
import type { ChainOperation } from '../../../packages/chain-adapter/src/lifecycle.ts';
import type { ChainStore } from './chain-store.ts';

export interface ChainEvidenceRoutesOptions {
  readonly store: ChainStore;
  readonly chainId: number;
  readonly contract: Address;
  readonly projectionKey: string;
  readonly passContract?: Address;
  readonly passProjectionKey?: string;
  readonly syncStatus: () => {
    readonly lastAttempt: 'NOT_RUN' | 'SUCCEEDED' | 'FAILED';
    readonly errorCode: 'M3_INDEXER_SYNC_FAILED' | null;
    readonly database: {
      readonly status: 'HEALTHY' | 'UNHEALTHY';
      readonly schemaVersion: number | null;
      readonly integrity: 'OK' | 'FAILED';
    };
    readonly deployment: {
      readonly chainId: number;
      readonly contract: Address;
      readonly manifestDigest: string;
      readonly abiHash: string;
      readonly runtimeBytecodeHash: string;
      readonly strategyPassAddress: Address;
      readonly strategyPassAbiHash: string;
      readonly strategyPassRuntimeBytecodeHash: string;
    };
  };
  readonly recordSubmission: (input: {
    readonly operationId: string;
    readonly chainId: number;
    readonly owner: Address;
    readonly target: Address;
    readonly calldata: HexData;
    readonly txHash: TransactionHash;
  }) => ChainOperation;
}

const operationIdSchema = {
  type: 'string',
  pattern: '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$',
  maxLength: 128,
};
const addressSchema = {
  type: 'string',
  pattern: '^0x[0-9a-fA-F]{40}$',
  maxLength: 42,
};

export function registerChainEvidenceRoutes(
  app: FastifyInstance,
  input: ChainEvidenceRoutesOptions | readonly ChainEvidenceRoutesOptions[],
): void {
  const runtimes: readonly ChainEvidenceRoutesOptions[] = Array.isArray(input)
    ? input
    : [input as ChainEvidenceRoutesOptions];
  if (runtimes.length === 0) throw new Error('INVALID_CHAIN_RUNTIME_SET');
  const identities = new Set<string>();
  for (const runtime of runtimes) {
    if (!/^[A-Za-z][A-Za-z0-9._-]{0,127}$/.test(runtime.projectionKey))
      throw new Error('INVALID_PROJECTION_KEY');
    const identity = `${runtime.chainId}:${runtime.contract.toLowerCase()}`;
    if (identities.has(identity)) throw new Error('DUPLICATE_CHAIN_RUNTIME');
    identities.add(identity);
    if ((runtime.passContract === undefined) !== (runtime.passProjectionKey === undefined))
      throw new Error('INVALID_CHAIN_RUNTIME_SET');
    if (runtime.passContract && runtime.passProjectionKey) {
      if (!/^[A-Za-z][A-Za-z0-9._-]{0,127}$/.test(runtime.passProjectionKey))
        throw new Error('INVALID_PROJECTION_KEY');
      const passIdentity = `${runtime.chainId}:${runtime.passContract.toLowerCase()}`;
      if (identities.has(passIdentity)) throw new Error('DUPLICATE_CHAIN_RUNTIME');
      identities.add(passIdentity);
    }
  }
  const runtimeForContract = (contract: Address) =>
    runtimes.find((runtime) => sameAddress(runtime.contract, contract)) ?? null;
  const runtimeForTarget = (contract: Address) =>
    runtimes.find(
      (runtime) =>
        sameAddress(runtime.contract, contract) ||
        (runtime.passContract !== undefined && sameAddress(runtime.passContract, contract)),
    ) ?? null;
  const readProjection = (
    runtime: ChainEvidenceRoutesOptions,
    owner: Address,
    contract = runtime.contract,
    projectionKey = runtime.projectionKey,
  ) => {
    if (runtime.syncStatus().lastAttempt === 'FAILED') throw new DomainError('CHAIN_PROJECTION_UNAVAILABLE');
    let projection;
    try {
      if (!runtime.store.checkpoint(runtime.chainId, contract))
        throw new DomainError('CHAIN_PROJECTION_UNAVAILABLE');
      projection = runtime.store.projection(runtime.chainId, owner, contract, projectionKey);
    } catch (error) {
      if (error instanceof DomainError) throw error;
      throw new DomainError('CHAIN_PROJECTION_UNAVAILABLE');
    }
    if (!projection) throw new DomainError('CHAIN_PROJECTION_NOT_FOUND');
    return { ...projection, blockNumber: projection.blockNumber.toString() };
  };

  app.get('/api/v1/chain/runtime-status', async () =>
    runtimes.length === 1
      ? runtimes[0]!.syncStatus()
      : { runtimes: runtimes.map((runtime) => runtime.syncStatus()) },
  );
  app.get<{ Params: { contract: string } }>(
    '/api/v1/chain/runtime-status/:contract',
    {
      schema: {
        params: {
          type: 'object',
          additionalProperties: false,
          required: ['contract'],
          properties: { contract: addressSchema },
        },
      },
    },
    async (request) => {
      const runtime = runtimeForTarget(asAddress(request.params.contract));
      if (!runtime) throw new DomainError('CHAIN_PROJECTION_NOT_FOUND');
      return runtime.syncStatus();
    },
  );
  app.post<{
    Body: {
      operationId: string;
      chainId: number;
      owner: string;
      target: string;
      calldata: string;
      txHash: string;
    };
  }>(
    '/api/v1/chain/operations',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['operationId', 'chainId', 'owner', 'target', 'calldata', 'txHash'],
          properties: {
            operationId: operationIdSchema,
            chainId: {
              type: 'integer',
              enum: [...new Set(runtimes.map((runtime) => runtime.chainId))],
            },
            owner: addressSchema,
            target: addressSchema,
            calldata: {
              type: 'string',
              pattern: '^0x(?:[0-9a-fA-F]{2})+$',
              minLength: 10,
              maxLength: 138,
            },
            txHash: { type: 'string', pattern: '^0x[0-9a-fA-F]{64}$', maxLength: 66 },
          },
        },
      },
    },
    async (request, reply) => {
      let operation: ChainOperation;
      try {
        const target = asAddress(request.body.target);
        const runtime = runtimes.find(
          (candidate) =>
            candidate.chainId === request.body.chainId &&
            (sameAddress(candidate.contract, target) ||
              (candidate.passContract !== undefined && sameAddress(candidate.passContract, target))),
        );
        if (!runtime) throw new Error('INVALID_M3_WALLET_SUBMISSION');
        operation = runtime.recordSubmission({
          operationId: request.body.operationId,
          chainId: request.body.chainId,
          owner: asAddress(request.body.owner),
          target,
          calldata: asHexData(request.body.calldata),
          txHash: asTransactionHash(request.body.txHash),
        });
      } catch (error) {
        if (error instanceof Error && error.message === 'OPERATION_IDENTITY_CONFLICT')
          throw new DomainError('CHAIN_OPERATION_CONFLICT');
        if (error instanceof Error && error.message === 'INVALID_M3_WALLET_SUBMISSION')
          throw new DomainError('CHAIN_SUBMISSION_INVALID');
        throw error;
      }
      return reply.code(202).send({
        operationId: operation.operationId,
        chainId: operation.chainId,
        owner: operation.owner,
        target: operation.target,
        calldata: operation.calldata,
        state: operation.state,
        txHash: operation.txHash,
        submittedAt: operation.submittedAt,
      });
    },
  );
  app.get<{ Params: { operationId: string }; Querystring: { owner: string } }>(
    '/api/v1/chain/operations/:operationId/evidence',
    {
      schema: {
        params: {
          type: 'object',
          additionalProperties: false,
          required: ['operationId'],
          properties: { operationId: operationIdSchema },
        },
        querystring: {
          type: 'object',
          additionalProperties: false,
          required: ['owner'],
          properties: { owner: addressSchema },
        },
      },
    },
    async (request) => {
      const owner = asAddress(request.query.owner);
      const matches = runtimes.flatMap((runtime) => {
        const operation = runtime.store.operation(request.params.operationId);
        return operation &&
          operation.chainId === runtime.chainId &&
          (sameAddress(operation.target, runtime.contract) ||
            (runtime.passContract !== undefined && sameAddress(operation.target, runtime.passContract))) &&
          sameAddress(operation.owner, owner)
          ? [{ runtime, operation }]
          : [];
      });
      if (matches.length !== 1) throw new DomainError('CHAIN_OPERATION_NOT_FOUND');
      const { runtime, operation } = matches[0]!;
      if (runtime.syncStatus().lastAttempt === 'FAILED')
        throw new DomainError('CHAIN_PROJECTION_UNAVAILABLE');
      const projectionKey = sameAddress(operation.target, runtime.contract)
        ? runtime.projectionKey
        : runtime.passProjectionKey!;
      const evidence = runtime.store.operationEvidence(operation.operationId, projectionKey);
      if (!evidence) throw new DomainError('CHAIN_OPERATION_NOT_FOUND');
      return { operationId: operation.operationId, ...evidence };
    },
  );
  app.get<{ Params: { contract: string; owner: string } }>(
    '/api/v1/chain/passes/:contract/:owner',
    {
      schema: {
        params: {
          type: 'object',
          additionalProperties: false,
          required: ['contract', 'owner'],
          properties: { contract: addressSchema, owner: addressSchema },
        },
      },
    },
    async (request) => {
      const contract = asAddress(request.params.contract);
      const runtime = runtimeForTarget(contract);
      if (
        !runtime ||
        runtime.passContract === undefined ||
        runtime.passProjectionKey === undefined ||
        !sameAddress(runtime.passContract, contract)
      )
        throw new DomainError('CHAIN_PROJECTION_NOT_FOUND');
      return readProjection(runtime, asAddress(request.params.owner), contract, runtime.passProjectionKey);
    },
  );
  app.get<{ Params: { contract: string; owner: string } }>(
    '/api/v1/chain/vaults/:contract/:owner',
    {
      schema: {
        params: {
          type: 'object',
          additionalProperties: false,
          required: ['contract', 'owner'],
          properties: { contract: addressSchema, owner: addressSchema },
        },
      },
    },
    async (request) => {
      const runtime = runtimeForContract(asAddress(request.params.contract));
      if (!runtime) throw new DomainError('CHAIN_PROJECTION_NOT_FOUND');
      return readProjection(runtime, asAddress(request.params.owner));
    },
  );
  app.get<{ Params: { owner: string } }>(
    '/api/v1/chain/vaults/:owner',
    {
      schema: {
        params: {
          type: 'object',
          additionalProperties: false,
          required: ['owner'],
          properties: { owner: addressSchema },
        },
      },
    },
    async (request) => {
      if (runtimes.length !== 1) throw new DomainError('INVALID_REQUEST');
      return readProjection(runtimes[0]!, asAddress(request.params.owner));
    },
  );
}
