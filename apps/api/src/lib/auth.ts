import argon2 from 'argon2';
import { SignJWT, jwtVerify } from 'jose';
import type { Env } from '../env.js';
import { unauthorized } from './errors.js';

/**
 * Password hashing and token issuing.
 *
 * Argon2id with parameters above the OWASP floor — this database holds a
 * household's complete financial history, so an offline crack of a stolen
 * hash needs to stay expensive.
 */
const ARGON_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
};

export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, ARGON_OPTIONS);
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    // A malformed hash must read as "wrong password", never as a 500 that
    // tells an attacker this account is special.
    return false;
  }
}

export interface AccessTokenClaims {
  sub: string; // user id
  email: string;
}

function secretKey(env: Env): Uint8Array {
  return new TextEncoder().encode(env.JWT_SECRET);
}

export async function signAccessToken(claims: AccessTokenClaims, env: Env): Promise<string> {
  return new SignJWT({ email: claims.email })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setIssuer('household-economy')
    .setAudience('household-economy-app')
    .setExpirationTime(env.ACCESS_TOKEN_TTL)
    .sign(secretKey(env));
}

export async function verifyAccessToken(token: string, env: Env): Promise<AccessTokenClaims> {
  try {
    const { payload } = await jwtVerify(token, secretKey(env), {
      issuer: 'household-economy',
      audience: 'household-economy-app',
    });
    if (!payload.sub) throw new Error('Token has no subject');
    return { sub: payload.sub, email: String(payload.email ?? '') };
  } catch {
    throw unauthorized('Your session has expired. Sign in again.');
  }
}

/** Rejects the passwords that show up in every credential-stuffing list. */
export function validatePasswordStrength(password: string): string | null {
  if (password.length < 10) return 'Password must be at least 10 characters';
  if (password.length > 200) return 'Password must be at most 200 characters';
  if (/^\d+$/.test(password)) return 'Password cannot be only digits';

  const common = ['password', 'passw0rd', 'qwerty', '123456', 'losenord', 'welcome'];
  const lower = password.toLowerCase();
  if (common.some((c) => lower.includes(c))) return 'Password is too easy to guess';

  return null;
}
