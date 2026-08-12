import type { DateKey, InstitutionDTO } from '@household/shared';

/**
 * The contract every bank-aggregation adapter implements.
 *
 * Sweden's banks cannot be integrated directly: reading someone's account
 * under PSD2 requires an AISP licence, so in practice you go through a
 * licensed aggregator (GoCardless Bank Account Data, Tink, Enable Banking).
 * They all expose the same four-step shape, which is what this interface
 * captures:
 *
 *   1. list institutions the user can pick from
 *   2. create a link/consent and send the user to the bank to authorise it
 *   3. once authorised, enumerate the accounts the consent covers
 *   4. pull transactions per account, incrementally, forever after
 *
 * Keeping the app behind this interface means swapping provider — or running
 * two in parallel, e.g. one for banks and one for card issuers — is a config
 * change rather than a rewrite. See docs/bank-integrations.md.
 */

export interface ProviderAccount {
  /** Provider-side id, stable across syncs. */
  externalId: string;
  name: string;
  /** IBAN or masked account number, when exposed. */
  iban: string | null;
  mask: string | null;
  currency: string;
  /** Minor units. Null when the provider does not expose a balance. */
  balance: number | null;
  /** Free-text product name, e.g. "Allkort", "Privatkonto". */
  product: string | null;
  ownerName: string | null;
}

export interface ProviderTransaction {
  /** Provider-side id. The strongest dedupe key when present. */
  externalId: string | null;
  bookingDate: DateKey;
  valueDate: DateKey | null;
  /** Minor units, negative = money out. */
  amount: number;
  currency: string;
  description: string;
  /** Counterparty name or account, when the provider resolves one. */
  counterparty: string | null;
  /** Provider-supplied merchant name, used in preference to our own guess. */
  merchant: string | null;
  /** Still reserved rather than booked — re-fetched until it settles. */
  pending: boolean;
}

export interface CreateLinkParams {
  institutionId: string;
  /** Where the bank returns the user after consent. */
  redirectUrl: string;
  /** Our connection id, echoed back so we can correlate the callback. */
  reference: string;
}

export interface CreateLinkResult {
  /** Provider-side consent/requisition id, stored on the connection. */
  externalRef: string;
  /** Open this to start the bank's authentication flow. */
  authUrl: string;
  /** When the unfinished link expires (minutes, typically). */
  expiresAt: Date;
  /** When the granted consent lapses — 90 days under PSD2. */
  consentExpiresAt: Date;
}

export type LinkStatus = 'pending' | 'active' | 'expired' | 'error' | 'revoked';

export interface LinkState {
  status: LinkStatus;
  /** Provider account ids covered by the consent, once authorised. */
  accountRefs: string[];
  error?: string;
}

export interface FetchTransactionsOptions {
  /** Only fetch bookings on or after this date. */
  from?: DateKey;
  to?: DateKey;
}

export interface BankProvider {
  readonly id: string;
  /** Human-readable, shown in the app when several providers are configured. */
  readonly label: string;

  listInstitutions(country: string): Promise<InstitutionDTO[]>;
  createLink(params: CreateLinkParams): Promise<CreateLinkResult>;
  getLinkState(externalRef: string): Promise<LinkState>;
  fetchAccounts(externalRef: string): Promise<ProviderAccount[]>;
  fetchTransactions(
    externalRef: string,
    accountRef: string,
    options?: FetchTransactionsOptions,
  ): Promise<ProviderTransaction[]>;
  /** Best-effort revocation at the provider when the user disconnects. */
  deleteLink?(externalRef: string): Promise<void>;
}

/** Raised by adapters so the sync layer can mark a connection rather than 500. */
export class ProviderError extends Error {
  constructor(
    message: string,
    readonly kind: 'consent_expired' | 'rate_limited' | 'unavailable' | 'unknown' = 'unknown',
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}
