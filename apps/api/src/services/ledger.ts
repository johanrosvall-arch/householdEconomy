import type { Prisma } from '@prisma/client';
import { UNCATEGORISED_SLUG, toPeriodKey, type DateKey } from '@household/shared';
import { prisma } from '../prisma.js';
import { transactionDedupeHash } from '../lib/crypto.js';
import { classify, type RuleLike } from './categorisation.js';
import { detectTransfers } from './transfers.js';

/**
 * The single write path into the ledger.
 *
 * Both file imports and bank syncs funnel through `insertTransactions`, so
 * deduplication, categorisation, balance maintenance and transfer pairing
 * behave identically no matter where the data came from. Anything that writes
 * a transaction outside this function will eventually produce a double-counted
 * month.
 */

export interface IncomingTransaction {
  date: DateKey;
  valueDate?: DateKey | null;
  amount: number;
  currency?: string;
  description: string;
  counterparty?: string | null;
  merchant?: string | null;
  externalId?: string | null;
  pending?: boolean;
}

export interface InsertOptions {
  householdId: string;
  accountId: string;
  source: 'bank_sync' | 'file_import' | 'manual';
  importBatchId?: string | null;
  /** Write rows even when they look like duplicates of existing ones. */
  includeDuplicates?: boolean;
}

export interface InsertResult {
  imported: number;
  skippedDuplicates: number;
  categorised: Record<string, number>;
  insertedIds: string[];
}

export async function insertTransactions(
  incoming: readonly IncomingTransaction[],
  options: InsertOptions,
): Promise<InsertResult> {
  if (incoming.length === 0) {
    return { imported: 0, skippedDuplicates: 0, categorised: {}, insertedIds: [] };
  }

  const [rules, categoryIdBySlug] = await Promise.all([
    loadRules(options.householdId),
    loadCategoryMap(options.householdId),
  ]);

  // Duplicate rows *within* one file are legitimate — two identical coffees on
  // the same day — so the hash includes an occurrence counter.
  const seenInBatch = new Map<string, number>();
  const prepared = incoming.map((tx) => {
    const base = { date: tx.date, amount: tx.amount, description: tx.description };
    const key = transactionDedupeHash({ ...base, sequence: 0 });
    const occurrence = seenInBatch.get(key) ?? 0;
    seenInBatch.set(key, occurrence + 1);

    const dedupeHash = transactionDedupeHash({ ...base, sequence: occurrence });
    const classification = classify(
      {
        description: tx.description,
        amount: tx.amount,
        accountId: options.accountId,
        counterparty: tx.counterparty ?? null,
        merchant: tx.merchant ?? null,
      },
      rules,
    );

    return { tx, dedupeHash, classification };
  });

  const existing = await prisma.transaction.findMany({
    where: {
      accountId: options.accountId,
      OR: [
        { dedupeHash: { in: prepared.map((p) => p.dedupeHash) } },
        {
          externalId: {
            in: prepared.map((p) => p.tx.externalId).filter((id): id is string => Boolean(id)),
          },
        },
      ],
    },
    select: { dedupeHash: true, externalId: true },
  });

  const existingHashes = new Set(existing.map((e) => e.dedupeHash));
  const existingExternalIds = new Set(
    existing.map((e) => e.externalId).filter((id): id is string => Boolean(id)),
  );

  const rows: Prisma.TransactionCreateManyInput[] = [];
  const categorised: Record<string, number> = {};
  let skippedDuplicates = 0;

  for (const { tx, dedupeHash, classification } of prepared) {
    const isDuplicate =
      (tx.externalId != null && existingExternalIds.has(tx.externalId)) ||
      existingHashes.has(dedupeHash);

    if (isDuplicate && !options.includeDuplicates) {
      skippedDuplicates += 1;
      continue;
    }

    const slug = classification.categorySlug;
    categorised[slug] = (categorised[slug] ?? 0) + 1;

    rows.push({
      householdId: options.householdId,
      accountId: options.accountId,
      categoryId: categoryIdBySlug.get(slug) ?? categoryIdBySlug.get(UNCATEGORISED_SLUG) ?? null,
      date: tx.date,
      valueDate: tx.valueDate ?? null,
      period: toPeriodKey(tx.date),
      amount: tx.amount,
      currency: tx.currency ?? 'SEK',
      description: tx.description,
      merchant: classification.merchant,
      counterparty: tx.counterparty ?? null,
      source: options.source,
      pending: tx.pending ?? false,
      dedupeHash,
      externalId: tx.externalId ?? null,
      importBatchId: options.importBatchId ?? null,
    });
  }

  if (rows.length === 0) {
    return { imported: 0, skippedDuplicates, categorised, insertedIds: [] };
  }

  // `skipDuplicates` guards the (accountId, dedupeHash) unique index against a
  // concurrent sync of the same account racing this insert.
  await prisma.transaction.createMany({ data: rows, skipDuplicates: true });

  const inserted = await prisma.transaction.findMany({
    where: { accountId: options.accountId, dedupeHash: { in: rows.map((r) => r.dedupeHash) } },
    select: { id: true },
  });

  await Promise.all([
    recalculateBalance(options.accountId),
    bumpRuleMatchCounts(prepared.map((p) => p.classification.ruleId)),
  ]);

  await linkTransfers(options.householdId);

  return {
    imported: rows.length,
    skippedDuplicates,
    categorised,
    insertedIds: inserted.map((t) => t.id),
  };
}

async function loadRules(householdId: string): Promise<RuleLike[]> {
  const rules = await prisma.categoryRule.findMany({
    where: { householdId },
    include: { category: { select: { slug: true } } },
    orderBy: { priority: 'desc' },
  });

  return rules.map((r) => ({
    id: r.id,
    field: r.field,
    matchType: r.matchType,
    pattern: r.pattern,
    categorySlug: r.category.slug,
    minAmount: r.minAmount,
    maxAmount: r.maxAmount,
    accountId: r.accountId,
    priority: r.priority,
  }));
}

export async function loadCategoryMap(householdId: string): Promise<Map<string, string>> {
  const categories = await prisma.category.findMany({
    where: { householdId },
    select: { id: true, slug: true },
  });
  return new Map(categories.map((c) => [c.slug, c.id]));
}

async function bumpRuleMatchCounts(ruleIds: readonly (string | null)[]): Promise<void> {
  const counts = new Map<string, number>();
  for (const id of ruleIds) {
    if (!id) continue;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  if (counts.size === 0) return;

  await prisma.$transaction(
    [...counts].map(([id, increment]) =>
      prisma.categoryRule.update({ where: { id }, data: { matchCount: { increment } } }),
    ),
  );
}

/**
 * Recomputes an account balance from its ledger rather than adjusting it
 * incrementally. Slower, but an incremental balance drifts the first time an
 * insert half-fails, and a wrong balance is the one number a user will notice.
 */
export async function recalculateBalance(accountId: string): Promise<number> {
  const aggregate = await prisma.transaction.aggregate({
    where: { accountId },
    _sum: { amount: true },
  });
  const balance = aggregate._sum.amount ?? 0;

  await prisma.account.update({
    where: { id: accountId },
    data: { balance, lastSyncedAt: new Date() },
  });
  return balance;
}

/**
 * Finds internal transfers among recent transactions and marks both legs.
 *
 * Scoped to a trailing window because a transfer's legs are always booked
 * within days of each other, and rescanning the whole ledger on every import
 * would get slower every month.
 */
export async function linkTransfers(householdId: string, windowDays = 45): Promise<number> {
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - windowDays);
  const sinceKey = since.toISOString().slice(0, 10);

  const candidates = await prisma.transaction.findMany({
    where: { householdId, date: { gte: sinceKey }, transferPairId: null },
    select: { id: true, accountId: true, date: true, amount: true, description: true },
  });

  const pairs = detectTransfers(candidates);
  if (pairs.length === 0) return 0;

  const transferCategoryId = (await loadCategoryMap(householdId)).get('internal-transfer') ?? null;

  await prisma.$transaction(
    pairs.flatMap((pair) => {
      const pairId = `tp_${pair.outgoingId}`;
      const data = transferCategoryId
        ? { transferPairId: pairId, categoryId: transferCategoryId }
        : { transferPairId: pairId };
      return [
        prisma.transaction.updateMany({
          where: { id: pair.outgoingId, categoryLocked: false },
          data,
        }),
        prisma.transaction.updateMany({
          where: { id: pair.incomingId, categoryLocked: false },
          data,
        }),
      ];
    }),
  );

  return pairs.length;
}
