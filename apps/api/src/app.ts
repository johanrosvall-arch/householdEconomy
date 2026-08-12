import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import { loadEnv, type Env } from './env.js';
import { errorHandler } from './lib/errors.js';
import authPlugin from './plugins/auth.js';
import registerRoutes from './routes/index.js';

declare module 'fastify' {
  interface FastifyInstance {
    config: Env;
  }
}

export async function buildApp(env: Env = loadEnv()): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      // Statement lines and tokens must never reach the log stream.
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'req.body.password',
          'req.body.currentPassword',
        ],
        remove: true,
      },
    },
    bodyLimit: env.MAX_UPLOAD_BYTES,
    trustProxy: true,
  });

  app.decorate('config', env);
  app.setErrorHandler(errorHandler);

  await app.register(helmet, { contentSecurityPolicy: false });

  await app.register(cors, {
    origin: env.CORS_ORIGINS === '*' ? true : env.CORS_ORIGINS.split(',').map((o) => o.trim()),
    credentials: true,
  });

  await app.register(rateLimit, {
    max: 300,
    timeWindow: '1 minute',
    // Keyed by IP: the limiter runs before route handlers, so request.userId
    // is not populated yet. Per-user limiting would need the token decoded in
    // an onRequest hook ahead of this plugin.
    keyGenerator: (request) => request.ip,
  });

  await app.register(multipart, {
    limits: { fileSize: env.MAX_UPLOAD_BYTES, files: 1 },
  });

  await app.register(authPlugin);

  app.get('/health', async () => ({ status: 'ok', time: new Date().toISOString() }));

  await app.register(registerRoutes, { prefix: '/api/v1' });

  return app;
}
