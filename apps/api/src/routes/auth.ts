import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../prisma.js';
import { hashPassword, signAccessToken, validatePasswordStrength, verifyPassword } from '../lib/auth.js';
import { hashToken, randomToken } from '../lib/crypto.js';
import { badRequest, conflict, unauthorized } from '../lib/errors.js';
import { createHousehold } from '../services/household-setup.js';

const registerSchema = z.object({
  email: z.string().email().max(320),
  password: z.string(),
  displayName: z.string().min(1).max(120),
  /** Name for the household created alongside the first user. */
  householdName: z.string().min(1).max(120).default('Vårt hushåll'),
});

const loginSchema = z.object({
  email: z.string().email().max(320),
  password: z.string().max(200),
});

const refreshSchema = z.object({ refreshToken: z.string().min(10).max(500) });

const authRoutes: FastifyPluginAsync = async (fastify) => {
  const env = fastify.config;

  /** Stricter limit on credential endpoints than the global one. */
  const credentialLimit = {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  };

  fastify.post('/register', credentialLimit, async (request, reply) => {
    const body = registerSchema.parse(request.body);

    const weakness = validatePasswordStrength(body.password);
    if (weakness) throw badRequest(weakness);

    const email = body.email.toLowerCase().trim();
    const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (existing) throw conflict('An account with that email already exists');

    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: await hashPassword(body.password),
        displayName: body.displayName.trim(),
      },
      select: { id: true, email: true, displayName: true },
    });

    const household = await createHousehold({ name: body.householdName, userId: user.id });
    const tokens = await issueTokens(user.id, user.email, request.headers['user-agent']);

    reply.status(201);
    return { user, householdId: household.id, ...tokens };
  });

  fastify.post('/login', credentialLimit, async (request) => {
    const body = loginSchema.parse(request.body);
    const email = body.email.toLowerCase().trim();

    const user = await prisma.user.findUnique({ where: { email } });

    // Same response whether the email is unknown or the password is wrong.
    if (!user || !(await verifyPassword(user.passwordHash, body.password))) {
      throw unauthorized('Incorrect email or password');
    }

    const memberships = await prisma.householdMember.findMany({
      where: { userId: user.id },
      select: { householdId: true, role: true, household: { select: { name: true } } },
    });

    const tokens = await issueTokens(user.id, user.email, request.headers['user-agent']);

    return {
      user: { id: user.id, email: user.email, displayName: user.displayName },
      households: memberships.map((m) => ({
        id: m.householdId,
        name: m.household.name,
        role: m.role,
      })),
      ...tokens,
    };
  });

  fastify.post('/refresh', credentialLimit, async (request) => {
    const body = refreshSchema.parse(request.body);

    const session = await prisma.session.findUnique({
      where: { refreshTokenHash: hashToken(body.refreshToken) },
      include: { user: { select: { id: true, email: true } } },
    });

    if (!session || session.revokedAt || session.expiresAt < new Date()) {
      throw unauthorized('Refresh token is no longer valid');
    }

    // Rotate: a refresh token is single-use, so a stolen one is only good
    // until the legitimate client next refreshes.
    await prisma.session.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    });

    return issueTokens(session.user.id, session.user.email, request.headers['user-agent']);
  });

  fastify.post('/logout', async (request) => {
    const body = refreshSchema.safeParse(request.body);
    if (body.success) {
      await prisma.session.updateMany({
        where: { refreshTokenHash: hashToken(body.data.refreshToken), revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    return { ok: true };
  });

  fastify.get('/me', async (request) => {
    const userId = await fastify.requireAuth(request);

    const user = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        displayName: true,
        memberships: {
          select: {
            role: true,
            household: { select: { id: true, name: true, baseCurrency: true } },
          },
        },
      },
    });

    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      households: user.memberships.map((m) => ({
        id: m.household.id,
        name: m.household.name,
        baseCurrency: m.household.baseCurrency,
        role: m.role,
      })),
    };
  });

  async function issueTokens(userId: string, email: string, userAgent?: string) {
    const refreshToken = randomToken(32);
    const expiresAt = new Date();
    expiresAt.setUTCDate(expiresAt.getUTCDate() + env.REFRESH_TOKEN_TTL_DAYS);

    await prisma.session.create({
      data: {
        userId,
        refreshTokenHash: hashToken(refreshToken),
        userAgent: userAgent?.slice(0, 300) ?? null,
        expiresAt,
      },
    });

    return {
      accessToken: await signAccessToken({ sub: userId, email }, env),
      refreshToken,
      expiresAt: expiresAt.toISOString(),
    };
  }
};

export default authRoutes;
