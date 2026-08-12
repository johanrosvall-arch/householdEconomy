import { UNCATEGORISED_SLUG } from '@household/shared';
import { guessMerchantName, matchMerchant, normaliseDescription } from './merchants.js';

/**
 * Categorisation runs in four layers, highest confidence first:
 *
 *   1. Household rules  — explicit "always call this X" instructions.
 *   2. Merchant dictionary — the built-in Swedish merchant list.
 *   3. Heuristics — sign, keywords, and structural hints (Swish, transfers).
 *   4. Fallback — uncategorised, surfaced in the app for the user to fix.
 *
 * Every function here is pure: it takes rules and a transaction, returns a
 * decision. Persistence lives in the route layer, which keeps this fully
 * testable without a database.
 */

export type ClassificationSource = 'rule' | 'merchant' | 'heuristic' | 'fallback';

export interface ClassifiableTransaction {
  description: string;
  amount: number;
  accountId?: string;
  counterparty?: string | null;
  merchant?: string | null;
}

export interface RuleLike {
  id: string;
  field: string; // 'description' | 'merchant' | 'counterparty'
  matchType: string; // 'contains' | 'equals' | 'starts_with' | 'regex'
  pattern: string;
  categorySlug: string;
  minAmount?: number | null;
  maxAmount?: number | null;
  accountId?: string | null;
  priority: number;
}

export interface Classification {
  categorySlug: string;
  merchant: string | null;
  source: ClassificationSource;
  /** 0..1. Drives whether the app nudges the user to confirm. */
  confidence: number;
  /** Set when a household rule decided it, so we can bump its match count. */
  ruleId: string | null;
}

export function classify(
  tx: ClassifiableTransaction,
  rules: readonly RuleLike[] = [],
): Classification {
  const ruleHit = applyRules(tx, rules);
  if (ruleHit) {
    return {
      categorySlug: ruleHit.categorySlug,
      merchant: tx.merchant ?? matchMerchant(tx.description)?.merchant ?? guessMerchantName(tx.description),
      source: 'rule',
      confidence: 1,
      ruleId: ruleHit.id,
    };
  }

  const merchantHit = matchMerchant(tx.description);
  if (merchantHit) {
    // The dictionary maps a merchant to its usual category, but the sign of
    // the amount can override it: money *in* from Klarna is a refund, not a
    // card payment out.
    const adjusted = adjustForSign(merchantHit.category, tx.amount);
    return {
      categorySlug: adjusted,
      merchant: merchantHit.merchant,
      source: 'merchant',
      confidence: adjusted === merchantHit.category ? 0.9 : 0.7,
      ruleId: null,
    };
  }

  const heuristic = applyHeuristics(tx);
  if (heuristic) {
    return {
      categorySlug: heuristic,
      merchant: guessMerchantName(tx.description),
      source: 'heuristic',
      confidence: 0.5,
      ruleId: null,
    };
  }

  return {
    categorySlug: UNCATEGORISED_SLUG,
    merchant: guessMerchantName(tx.description),
    source: 'fallback',
    confidence: 0,
    ruleId: null,
  };
}

/**
 * Returns the highest-priority matching rule. Ties break towards the more
 * specific rule (one constrained by account or amount beats a bare pattern),
 * so a general "Swish -> transfers" rule does not shadow
 * "Swish over 8000 -> rent".
 */
export function applyRules(
  tx: ClassifiableTransaction,
  rules: readonly RuleLike[],
): RuleLike | null {
  const matches = rules.filter((rule) => ruleMatches(rule, tx));
  if (matches.length === 0) return null;

  matches.sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    return specificity(b) - specificity(a);
  });
  return matches[0]!;
}

function specificity(rule: RuleLike): number {
  let score = 0;
  if (rule.accountId) score += 2;
  if (rule.minAmount != null) score += 1;
  if (rule.maxAmount != null) score += 1;
  if (rule.matchType === 'equals') score += 2;
  if (rule.matchType === 'regex') score += 1;
  score += Math.min(rule.pattern.length / 20, 2);
  return score;
}

export function ruleMatches(rule: RuleLike, tx: ClassifiableTransaction): boolean {
  if (rule.accountId && tx.accountId && rule.accountId !== tx.accountId) return false;

  // Amount bounds are compared on the absolute value: a household thinks in
  // "over 1000 kr", not "under -1000 öre".
  const magnitude = Math.abs(tx.amount);
  if (rule.minAmount != null && magnitude < Math.abs(rule.minAmount)) return false;
  if (rule.maxAmount != null && magnitude > Math.abs(rule.maxAmount)) return false;

  const haystack = fieldValue(rule.field, tx);
  if (haystack == null || haystack === '') return false;

  const target = normaliseDescription(haystack);
  const pattern = rule.pattern.trim();
  if (pattern === '') return false;

  switch (rule.matchType) {
    case 'equals':
      return target === normaliseDescription(pattern);
    case 'starts_with':
      return target.startsWith(normaliseDescription(pattern));
    case 'regex':
      return safeRegexTest(pattern, haystack);
    case 'contains':
    default:
      return target.includes(normaliseDescription(pattern));
  }
}

function fieldValue(field: string, tx: ClassifiableTransaction): string | null {
  switch (field) {
    case 'merchant':
      return tx.merchant ?? null;
    case 'counterparty':
      return tx.counterparty ?? null;
    case 'description':
    default:
      return tx.description;
  }
}

/**
 * User-authored regexes are untrusted input. A bad pattern must not take the
 * import down, and it must not hang the process — patterns are length-capped
 * and failures are swallowed as "no match".
 */
const MAX_PATTERN_LENGTH = 200;

function safeRegexTest(pattern: string, value: string): boolean {
  if (pattern.length > MAX_PATTERN_LENGTH) return false;
  try {
    return new RegExp(pattern, 'i').test(value);
  } catch {
    return false;
  }
}

/**
 * The dictionary assumes the common direction of travel for a merchant. When
 * the sign contradicts it, remap: money arriving from a shop is a refund,
 * money leaving towards a salary payer is not income.
 */
function adjustForSign(categorySlug: string, amount: number): string {
  const incomeSlugs = new Set([
    'salary',
    'benefits',
    'child-benefit',
    'pension',
    'investment-income',
    'refund',
    'other-income',
  ]);

  if (amount > 0) {
    // Money in, but the category is an expense one -> treat as a refund.
    if (!incomeSlugs.has(categorySlug) && !isNeutral(categorySlug)) return 'refund';
    return categorySlug;
  }

  if (amount < 0 && incomeSlugs.has(categorySlug)) {
    // Money out to something normally classed as income — a repayment.
    return categorySlug === 'tax' ? 'tax' : UNCATEGORISED_SLUG;
  }

  return categorySlug;
}

/** Transfer-ish categories are direction-agnostic. */
function isNeutral(categorySlug: string): boolean {
  return (
    categorySlug === 'internal-transfer' ||
    categorySlug === 'person-transfer' ||
    categorySlug === 'card-payment' ||
    categorySlug === 'cash' ||
    categorySlug === 'savings-transfer' ||
    categorySlug === 'investment' ||
    categorySlug === 'tax'
  );
}

/**
 * Last resort before giving up: structural signals that do not depend on
 * knowing the merchant.
 */
function applyHeuristics(tx: ClassifiableTransaction): string | null {
  const text = normaliseDescription(tx.description);
  if (!text) return null;

  if (/\b(autogiro|e-?faktura|bankgiro|plusgiro|bg |pg )\b/.test(text)) {
    // A direct debit we cannot name — still clearly a bill, not a shop.
    return tx.amount < 0 ? UNCATEGORISED_SLUG : 'other-income';
  }

  // Patterns are ASCII-folded to match `normaliseDescription` output.
  if (tx.amount > 0) {
    if (/\b(insattning|inbetalning|aterbetalning|kredit)\b/.test(text)) {
      return 'refund';
    }
    return 'other-income';
  }

  return null;
}

/**
 * Bulk re-classification, used after a rule is created or edited.
 * Transactions the user has explicitly categorised are never touched.
 */
export function reclassifyBatch<T extends ClassifiableTransaction & { id: string; categoryLocked: boolean }>(
  transactions: readonly T[],
  rules: readonly RuleLike[],
): { id: string; categorySlug: string; merchant: string | null; ruleId: string | null }[] {
  const updates: { id: string; categorySlug: string; merchant: string | null; ruleId: string | null }[] = [];
  for (const tx of transactions) {
    if (tx.categoryLocked) continue;
    const result = classify(tx, rules);
    updates.push({
      id: tx.id,
      categorySlug: result.categorySlug,
      merchant: result.merchant,
      ruleId: result.ruleId,
    });
  }
  return updates;
}
