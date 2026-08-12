import { buildApp } from './app.js';
import { loadEnv } from './env.js';
import { prisma } from './prisma.js';

async function main(): Promise<void> {
  const env = loadEnv();
  const app = await buildApp(env);

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'Shutting down');
    try {
      await app.close();
      await prisma.$disconnect();
      process.exit(0);
    } catch (err) {
      app.log.error({ err }, 'Error during shutdown');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  try {
    await app.listen({ port: env.PORT, host: env.HOST });
  } catch (err) {
    app.log.error({ err }, 'Failed to start');
    process.exit(1);
  }
}

void main();
