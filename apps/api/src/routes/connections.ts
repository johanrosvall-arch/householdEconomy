import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { ConnectionDTO, StartLinkDTO } from '@household/shared';
import { prisma } from '../prisma.js';
import { badRequest, notFound } from '../lib/errors.js';
import { defaultProvider, getProvider } from '../services/banking/index.js';
import { syncConnection } from '../services/sync.js';

const householdParams = z.object({ householdId: z.string() });
const connectionParams = householdParams.extend({ connectionId: z.string() });

const startLinkSchema = z.object({
  institutionId: z.string().min(1),
  provider: z.string().optional(),
});

const connectionRoutes: FastifyPluginAsync = async (fastify) => {
  const env = fastify.config;

  /** Institutions the user can connect to, for the bank picker. */
  fastify.get('/:householdId/institutions', async (request) => {
    const { householdId } = householdParams.parse(request.params);
    await fastify.requireHousehold(request, householdId);

    const { country = 'SE' } = z
      .object({ country: z.string().length(2).optional() })
      .parse(request.query ?? {});

    const provider = defaultProvider(env);
    return {
      provider: provider.id,
      institutions: await provider.listInstitutions(country),
    };
  });

  fastify.get('/:householdId/connections', async (request) => {
    const { householdId } = householdParams.parse(request.params);
    await fastify.requireHousehold(request, householdId);

    const connections = await prisma.connection.findMany({
      where: { householdId },
      include: { accounts: { select: { id: true } } },
      orderBy: { createdAt: 'desc' },
    });

    return { connections: connections.map(toDTO) };
  });

  /**
   * Step 1 of linking a bank: create a consent at the provider and hand the
   * app a URL to open. The user authenticates with BankID at their own bank;
   * we never see their credentials.
   */
  fastify.post('/:householdId/connections', async (request, reply) => {
    const { householdId } = householdParams.parse(request.params);
    await fastify.requireHousehold(request, householdId, 'member');
    const body = startLinkSchema.parse(request.body);

    const provider = body.provider ? getProvider(body.provider) : defaultProvider(env);
    const institutions = await provider.listInstitutions('SE');
    const institution = institutions.find((i) => i.id === body.institutionId);
    if (!institution) throw badRequest(`Unknown institution "${body.institutionId}"`);

    const connection = await prisma.connection.create({
      data: {
        householdId,
        provider: provider.id,
        institutionId: institution.id,
        institutionName: institution.name,
        logoUrl: institution.logoUrl,
        status: 'pending',
      },
      select: { id: true },
    });

    const link = await provider.createLink({
      institutionId: institution.id,
      redirectUrl: env.BANK_REDIRECT_URL,
      reference: connection.id,
    });

    await prisma.connection.update({
      where: { id: connection.id },
      data: {
        externalRef: link.externalRef,
        consentExpiresAt: link.consentExpiresAt,
      },
    });

    const result: StartLinkDTO = {
      connectionId: connection.id,
      authUrl: link.authUrl,
      expiresAt: link.expiresAt.toISOString(),
    };

    reply.status(201);
    return result;
  });

  /**
   * Step 2: called once the user returns from the bank. Confirms the consent
   * is live and pulls the first batch of history.
   */
  fastify.post('/:householdId/connections/:connectionId/complete', async (request) => {
    const { householdId, connectionId } = connectionParams.parse(request.params);
    await fastify.requireHousehold(request, householdId, 'member');

    const connection = await prisma.connection.findFirst({
      where: { id: connectionId, householdId },
      select: { id: true },
    });
    if (!connection) throw notFound('Connection');

    const result = await syncConnection(connectionId, env);
    const fresh = await prisma.connection.findUniqueOrThrow({
      where: { id: connectionId },
      include: { accounts: { select: { id: true } } },
    });

    return { connection: toDTO(fresh), sync: result };
  });

  fastify.post('/:householdId/connections/:connectionId/sync', async (request) => {
    const { householdId, connectionId } = connectionParams.parse(request.params);
    await fastify.requireHousehold(request, householdId, 'member');

    const connection = await prisma.connection.findFirst({
      where: { id: connectionId, householdId },
      select: { id: true },
    });
    if (!connection) throw notFound('Connection');

    return { sync: await syncConnection(connectionId, env) };
  });

  /** Syncs every connection in the household — what the app calls on open. */
  fastify.post('/:householdId/sync', async (request) => {
    const { householdId } = householdParams.parse(request.params);
    await fastify.requireHousehold(request, householdId, 'member');

    const connections = await prisma.connection.findMany({
      where: { householdId, status: { in: ['active', 'error'] } },
      select: { id: true },
    });

    // Sequential on purpose: aggregators rate-limit per account per day, and
    // a burst of parallel requests is the fastest way to get throttled.
    const results = [];
    for (const connection of connections) {
      results.push(await syncConnection(connection.id, env));
    }

    return {
      synced: results.length,
      imported: results.reduce((sum, r) => sum + r.imported, 0),
      results,
    };
  });

  fastify.delete('/:householdId/connections/:connectionId', async (request) => {
    const { householdId, connectionId } = connectionParams.parse(request.params);
    await fastify.requireHousehold(request, householdId, 'member');

    const connection = await prisma.connection.findFirst({
      where: { id: connectionId, householdId },
      select: { id: true, provider: true, externalRef: true },
    });
    if (!connection) throw notFound('Connection');

    // Best-effort revocation at the provider; a failure there must not block
    // the user from disconnecting on our side.
    if (connection.externalRef) {
      try {
        await getProvider(connection.provider).deleteLink?.(connection.externalRef);
      } catch (err) {
        request.log.warn({ err, connectionId }, 'Provider link revocation failed');
      }
    }

    // Accounts and their transactions survive: the history is the user's, and
    // deleting it would silently rewrite past months.
    await prisma.account.updateMany({
      where: { connectionId },
      data: { connectionId: null },
    });
    await prisma.connection.delete({ where: { id: connectionId } });

    return { deleted: true };
  });
};

type ConnectionRow = {
  id: string;
  provider: string;
  institutionId: string;
  institutionName: string;
  logoUrl: string | null;
  status: string;
  consentExpiresAt: Date | null;
  lastSyncedAt: Date | null;
  lastError: string | null;
  accounts: { id: string }[];
};

function toDTO(connection: ConnectionRow): ConnectionDTO {
  return {
    id: connection.id,
    provider: connection.provider,
    institutionId: connection.institutionId,
    institutionName: connection.institutionName,
    logoUrl: connection.logoUrl,
    status: connection.status as ConnectionDTO['status'],
    consentExpiresAt: connection.consentExpiresAt?.toISOString() ?? null,
    lastSyncedAt: connection.lastSyncedAt?.toISOString() ?? null,
    lastError: connection.lastError,
    accountIds: connection.accounts.map((a) => a.id),
  };
}

export default connectionRoutes;
