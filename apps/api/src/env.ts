import { z } from 'zod';

/**
 * Environment is validated once at boot. A missing secret should stop the
 * process immediately rather than surface as a 500 on the first login.
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().url(),

  /** Signs access/refresh tokens. Min 32 chars. */
  JWT_SECRET: z.string().min(32),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).default(30),

  /**
   * 32-byte key, base64, used to encrypt stored bank provider tokens at rest.
   * Generate with: openssl rand -base64 32
   */
  ENCRYPTION_KEY: z.string().min(32),

  /** Comma-separated origins allowed to call the API. */
  CORS_ORIGINS: z.string().default('*'),

  /** Which banking adapter to use: 'mock' | 'gocardless'. */
  BANK_PROVIDER: z.string().default('mock'),
  GOCARDLESS_SECRET_ID: z.string().optional(),
  GOCARDLESS_SECRET_KEY: z.string().optional(),
  /** Where the bank sends the user back after consent. */
  BANK_REDIRECT_URL: z.string().url().default('householdeconomy://bank-callback'),

  /** Max upload size for statement files, bytes. */
  MAX_UPLOAD_BYTES: z.coerce.number().int().default(10 * 1024 * 1024),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

/** Test helper — lets a suite swap the environment between cases. */
export function resetEnvCache(): void {
  cached = null;
}
