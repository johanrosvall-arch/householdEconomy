import type { AccountType } from '@prisma/client';
import { toDateKey } from '@household/shared';
import { prisma } from '../prisma.js';
import type { Env } from '../env.js';
import { getProvider, ProviderError, type ProviderAccount } from './banking/index.js';
import { insertTransactions } from './ledger.js';

/**
 * Pulls fresh data for a connection.
 *
 * "Close to real time" in PSD2 terms means polling: banks do not push. The
 * app syncs on open and in the background, and the aggregators rate-limit to
 * roughly four unattended calls per account per day — so the overlap window
 * below is deliberately generous and dedupe does the rest.
 */

/**
 * How far back to re-fetch on an incremental sync. Banks retroactively adjust
 * bookings for several days after the fact, so a window shorter than this
 * silently misses corrections.
 */
const OVERLAP_DAYS = 10;

/** Full history to pull the first time an account is linked. */
const INITIAL_HISTORY_DAYS = 365;

export interface SyncResult {
  connectionId: string;
  accountsSynced: number;
  imported: number;
  skippedDuplicates: number;
  errors: string[];
}

export async function syncConnection(connectionId: string, env: Env): Promise<SyncResult> {
  const connection = await prisma.connection.findUnique({
    where: { id: connectionId },
    include: { accounts: true },
  });
  if (!connection) throw new Error(`Connection ${connectionId} not found`);

  const provider = getProvider(connection.provider);
  const result: SyncResult = {
    connectionId,
    accountsSynced: 0,
    imported: 0,
    skippedDuplicates: 0,
    errors: [],
  };

  if (!connection.externalRef) {
    result.errors.push('Connection has not completed its bank authorisation');
    return result;
  }

  try {
    const state = await provider.getLinkState(connection.externalRef);

    if (state.status !== 'active') {
      await prisma.connection.update({
        where: { id: connectionId },
        data: {
          status: state.status,
          lastError: state.error ?? `Bank reports consent is ${state.status}`,
        },
      });
      result.errors.push(state.error ?? `Consent is ${state.status}`);
      return result;
    }

    const providerAccounts = await provider.fetchAccounts(connection.externalRef);

    for (const providerAccount of providerAccounts) {
      const account = await upsertAccount(connection.id, connection.householdId, connection.institutionName, providerAccount);

      const from = account.lastSyncedAt
        ? daysBefore(account.lastSyncedAt, OVERLAP_DAYS)
        : daysBefore(new Date(), INITIAL_HISTORY_DAYS);

      const transactions = await provider.fetchTransactions(
        connection.externalRef,
        providerAccount.externalId,
        { from },
      );

      const inserted = await insertTransactions(
        transactions.map((t) => ({
          date: t.bookingDate,
          valueDate: t.valueDate,
          amount: t.amount,
          currency: t.currency,
          description: t.description,
          counterparty: t.counterparty,
          merchant: t.merchant,
          externalId: t.externalId,
          pending: t.pending,
        })),
        {
          householdId: connection.householdId,
          accountId: account.id,
          source: 'bank_sync',
        },
      );

      result.accountsSynced += 1;
      result.imported += inserted.imported;
      result.skippedDuplicates += inserted.skippedDuplicates;
    }

    await prisma.connection.update({
      where: { id: connectionId },
      data: { status: 'active', lastSyncedAt: new Date(), lastError: null },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status =
      err instanceof ProviderError && err.kind === 'consent_expired' ? 'expired' : 'error';

    await prisma.connection.update({
      where: { id: connectionId },
      data: { status, lastError: message },
    });
    result.errors.push(message);
  }

  return result;
}

/**
 * Matches a provider account to ours by its stable external id, creating one
 * on first sight. Matching on name would rename-collide the moment a user
 * relabels an account in their bank.
 */
async function upsertAccount(
  connectionId: string,
  householdId: string,
  institutionName: string,
  providerAccount: ProviderAccount,
): Promise<{ id: string; lastSyncedAt: Date | null }> {
  const existing = await prisma.account.findUnique({
    where: { connectionId_externalId: { connectionId, externalId: providerAccount.externalId } },
    select: { id: true, lastSyncedAt: true },
  });

  if (existing) return existing;

  const created = await prisma.account.create({
    data: {
      householdId,
      connectionId,
      externalId: providerAccount.externalId,
      name: providerAccount.name || providerAccount.product || 'Konto',
      type: inferAccountType(providerAccount),
      currency: providerAccount.currency,
      balance: providerAccount.balance ?? 0,
      mask: providerAccount.mask,
      institutionName,
    },
    select: { id: true, lastSyncedAt: true },
  });

  return created;
}

function inferAccountType(account: ProviderAccount): AccountType {
  const text = `${account.name} ${account.product ?? ''}`.toLowerCase();
  if (/klarna|delbetal/.test(text)) return 'bnpl';
  if (/kredit|credit|amex|card|kort/.test(text)) return 'credit_card';
  if (/spar|savings|buffert/.test(text)) return 'savings';
  if (/lån|loan|bolan|bolån/.test(text)) return 'loan';
  if (/isk|fond|depå|depa|invest/.test(text)) return 'investment';
  return 'checking';
}

function daysBefore(date: Date, days: number): string {
  const d = new Date(date.getTime());
  d.setUTCDate(d.getUTCDate() - days);
  return toDateKey(d);
}

/**
 * Connections whose PSD2 consent has lapsed or is about to. The app nags the
 * user to re-authenticate before the data silently goes stale.
 */
export async function findConnectionsNeedingAttention(
  householdId: string,
  withinDays = 7,
): Promise<string[]> {
  const threshold = new Date();
  threshold.setUTCDate(threshold.getUTCDate() + withinDays);

  const connections = await prisma.connection.findMany({
    where: {
      householdId,
      OR: [
        { status: { in: ['expired', 'error'] } },
        { consentExpiresAt: { lte: threshold } },
      ],
    },
    select: { id: true },
  });

  return connections.map((c) => c.id);
}
