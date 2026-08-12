import { PrismaClient } from '@prisma/client';

/**
 * Single client for the process. In dev, `tsx watch` re-evaluates modules on
 * every save, which would otherwise leak a connection pool per reload until
 * Postgres refuses new connections.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

export type { PrismaClient };
