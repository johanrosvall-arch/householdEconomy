import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { prisma } from '../prisma.js';
import { verifyAccessToken } from '../lib/auth.js';
import { forbidden, unauthorized } from '../lib/errors.js';

/**
 * Authentication and household scoping.
 *
 * Every financial route is scoped to a household the caller belongs to.
 * `requireHousehold` resolves that membership once per request and is the only
 * sanctioned way to obtain a household id — routes must never read one
 * straight off the request body, or one household could read another's ledger.
 */

declare module 'fastify' {
  interface FastifyRequest {
    userId?: string;
    userEmail?: string;
  }
  interface FastifyInstance {
    requireAuth: (request: FastifyRequest) => Promise<string>;
    requireHousehold: (
      request: FastifyRequest,
      householdId: string,
      minimumRole?: HouseholdRole,
    ) => Promise<{ userId: string; householdId: string; role: HouseholdRole }>;
  }
}

export type HouseholdRole = 'owner' | 'member' | 'viewer';

const ROLE_RANK: Record<HouseholdRole, number> = { viewer: 0, member: 1, owner: 2 };

const authPlugin: FastifyPluginAsync = async (fastify) => {
  const env = fastify.config;

  fastify.decorateRequest('userId', undefined);
  fastify.decorateRequest('userEmail', undefined);

  fastify.decorate('requireAuth', async (request: FastifyRequest): Promise<string> => {
    if (request.userId) return request.userId;

    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw unauthorized('Missing bearer token');
    }

    const claims = await verifyAccessToken(header.slice(7).trim(), env);
    request.userId = claims.sub;
    request.userEmail = claims.email;
    return claims.sub;
  });

  fastify.decorate(
    'requireHousehold',
    async (request: FastifyRequest, householdId: string, minimumRole: HouseholdRole = 'viewer') => {
      const userId = await fastify.requireAuth(request);

      const membership = await prisma.householdMember.findUnique({
        where: { householdId_userId: { householdId, userId } },
        select: { role: true },
      });

      // Deliberately the same error whether the household does not exist or
      // the caller is not a member — otherwise the API confirms which
      // household ids are real.
      if (!membership) throw forbidden();

      const role = membership.role as HouseholdRole;
      if (ROLE_RANK[role] < ROLE_RANK[minimumRole]) {
        throw forbidden(`This action requires the ${minimumRole} role`);
      }

      return { userId, householdId, role };
    },
  );
};

export default fp(authPlugin, { name: 'auth' });
