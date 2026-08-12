import type { Env } from '../../env.js';
import { MockBankProvider } from './mock.js';
import type { BankProvider } from './provider.js';

export * from './provider.js';
export { MockBankProvider } from './mock.js';

/**
 * Adapter registry.
 *
 * Only the mock adapter ships today. Adding a real one means implementing
 * BankProvider and registering it here — the routes, sync loop and mobile app
 * are all written against the interface and need no changes.
 * See docs/bank-integrations.md for the provider comparison and the exact
 * endpoints a GoCardless/Tink/Enable Banking adapter has to call.
 */
const registry = new Map<string, () => BankProvider>([['mock', () => new MockBankProvider()]]);

const instances = new Map<string, BankProvider>();

export function getProvider(id: string): BankProvider {
  const existing = instances.get(id);
  if (existing) return existing;

  const factory = registry.get(id);
  if (!factory) {
    throw new Error(
      `Unknown bank provider "${id}". Registered: ${[...registry.keys()].join(', ')}`,
    );
  }
  const provider = factory();
  instances.set(id, provider);
  return provider;
}

export function defaultProvider(env: Env): BankProvider {
  return getProvider(env.BANK_PROVIDER);
}

export function registerProvider(id: string, factory: () => BankProvider): void {
  registry.set(id, factory);
  instances.delete(id);
}

export function listProviderIds(): string[] {
  return [...registry.keys()];
}
