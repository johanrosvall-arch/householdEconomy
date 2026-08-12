import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';

/**
 * Errors the API raises deliberately. Anything else that reaches the handler
 * is treated as a bug: logged with a stack, reported as a bare 500.
 */
export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new AppError(400, 'bad_request', message, details);

export const unauthorized = (message = 'Authentication required') =>
  new AppError(401, 'unauthorized', message);

export const forbidden = (message = 'You do not have access to this household') =>
  new AppError(403, 'forbidden', message);

export const notFound = (what = 'Resource') => new AppError(404, 'not_found', `${what} not found`);

export const conflict = (message: string, details?: unknown) =>
  new AppError(409, 'conflict', message, details);

export const unprocessable = (message: string, details?: unknown) =>
  new AppError(422, 'unprocessable', message, details);

export function errorHandler(
  error: FastifyError | AppError | ZodError,
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  if (error instanceof AppError) {
    reply.status(error.statusCode).send({
      error: { code: error.code, message: error.message, details: error.details ?? undefined },
    });
    return;
  }

  if (error instanceof ZodError) {
    reply.status(400).send({
      error: {
        code: 'validation_failed',
        message: 'Request failed validation',
        details: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      },
    });
    return;
  }

  const fastifyError = error as FastifyError;

  // Body-parse and payload-size failures arrive as Fastify errors with a status.
  if (fastifyError.statusCode && fastifyError.statusCode < 500) {
    reply.status(fastifyError.statusCode).send({
      error: { code: fastifyError.code ?? 'bad_request', message: fastifyError.message },
    });
    return;
  }

  // Prisma unique-constraint violations that escaped a service-level check.
  if ((error as { code?: string }).code === 'P2002') {
    reply.status(409).send({
      error: { code: 'conflict', message: 'That record already exists' },
    });
    return;
  }

  request.log.error({ err: error }, 'Unhandled error');
  reply.status(500).send({
    error: { code: 'internal_error', message: 'Something went wrong' },
  });
}
