import { z } from 'zod';
import type { Currency } from './money';
import type { DateKey, PeriodKey } from './date';

/**
 * Wire types shared between the API and the mobile app. The API validates
 * inbound bodies with these schemas; the app imports the inferred types so a
 * field rename breaks the build on both sides at once.
 */

export const currencySchema = z.enum(['SEK', 'EUR', 'USD', 'NOK', 'DKK', 'GBP']);
export const periodKeySchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Expected YYYY-MM');
export const dateKeySchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, 'Expected YYYY-MM-DD');

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

export const accountTypeSchema = z.enum([
  'checking',
  'savings',
  'credit_card',
  'bnpl', // Klarna and similar buy-now-pay-later balances
  'loan',
  'investment',
  'cash',
]);
export type AccountType = z.infer<typeof accountTypeSchema>;

export interface AccountDTO {
  id: string;
  name: string;
  type: AccountType;
  currency: Currency;
  /** Minor units. Credit cards and loans are normally negative. */
  balance: number;
  /** Last four of the account/card number, when the source provides it. */
  mask: string | null;
  institutionName: string | null;
  /** null for manually created accounts and CSV imports. */
  connectionId: string | null;
  includeInNetWorth: boolean;
  lastSyncedAt: string | null;
  archivedAt: string | null;
}

export const createAccountSchema = z.object({
  name: z.string().min(1).max(120),
  type: accountTypeSchema,
  currency: currencySchema.default('SEK'),
  openingBalance: z.number().int().default(0),
  institutionName: z.string().max(120).nullish(),
  includeInNetWorth: z.boolean().default(true),
});
export type CreateAccountInput = z.infer<typeof createAccountSchema>;

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------

export type TransactionSource = 'bank_sync' | 'file_import' | 'manual';

export interface TransactionDTO {
  id: string;
  accountId: string;
  accountName: string;
  /** Booking date — the date the money actually moved. */
  date: DateKey;
  /** Value/transaction date when the bank distinguishes it. */
  valueDate: DateKey | null;
  /** Minor units. Negative = money out. */
  amount: number;
  currency: Currency;
  /** Raw text from the bank, kept verbatim for auditability. */
  description: string;
  /** Cleaned-up merchant name, when we could derive one. */
  merchant: string | null;
  categorySlug: string;
  /** True once a human has set the category — protects it from re-classification. */
  categoryLocked: boolean;
  notes: string | null;
  tags: string[];
  source: TransactionSource;
  /** Set when this transaction is one leg of a detected internal transfer. */
  transferPairId: string | null;
  /** True while the bank still reports it as pending/reserved. */
  pending: boolean;
  createdAt: string;
}

export const transactionQuerySchema = z.object({
  from: dateKeySchema.optional(),
  to: dateKeySchema.optional(),
  accountIds: z.array(z.string()).optional(),
  categorySlugs: z.array(z.string()).optional(),
  search: z.string().max(200).optional(),
  minAmount: z.number().int().optional(),
  maxAmount: z.number().int().optional(),
  includeTransfers: z.boolean().default(true),
  uncategorisedOnly: z.boolean().default(false),
  limit: z.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
});
export type TransactionQuery = z.infer<typeof transactionQuerySchema>;

export const createTransactionSchema = z.object({
  accountId: z.string(),
  date: dateKeySchema,
  amount: z.number().int(),
  description: z.string().min(1).max(500),
  categorySlug: z.string().optional(),
  notes: z.string().max(2000).nullish(),
  tags: z.array(z.string().max(40)).max(20).default([]),
});
export type CreateTransactionInput = z.infer<typeof createTransactionSchema>;

export const updateTransactionSchema = z.object({
  categorySlug: z.string().optional(),
  notes: z.string().max(2000).nullish(),
  tags: z.array(z.string().max(40)).max(20).optional(),
  merchant: z.string().max(200).nullish(),
  /** When true, also create a rule so future matches classify the same way. */
  applyToSimilar: z.boolean().default(false),
});
export type UpdateTransactionInput = z.infer<typeof updateTransactionSchema>;

// ---------------------------------------------------------------------------
// Categorisation rules
// ---------------------------------------------------------------------------

export const ruleMatchFieldSchema = z.enum(['description', 'merchant', 'counterparty']);
export const ruleMatchTypeSchema = z.enum(['contains', 'equals', 'starts_with', 'regex']);

export const createRuleSchema = z.object({
  field: ruleMatchFieldSchema.default('description'),
  matchType: ruleMatchTypeSchema.default('contains'),
  pattern: z.string().min(1).max(200),
  categorySlug: z.string(),
  /** Optional amount window, for rules like "Swish over 1000 kr is rent". */
  minAmount: z.number().int().nullish(),
  maxAmount: z.number().int().nullish(),
  accountId: z.string().nullish(),
  /** Higher wins when several rules match. */
  priority: z.number().int().min(0).max(1000).default(100),
});
export type CreateRuleInput = z.infer<typeof createRuleSchema>;

export interface RuleDTO extends CreateRuleInput {
  id: string;
  /** How many transactions this rule has classified — surfaces dead rules. */
  matchCount: number;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Budgets
// ---------------------------------------------------------------------------

export const budgetLineSchema = z.object({
  categorySlug: z.string(),
  /** Positive minor units — the amount allowed to be spent. */
  limit: z.number().int().min(0),
  /** Carry an unspent remainder into next month (envelope style). */
  rollover: z.boolean().default(false),
});
export type BudgetLineInput = z.infer<typeof budgetLineSchema>;

export const upsertBudgetSchema = z.object({
  period: periodKeySchema,
  lines: z.array(budgetLineSchema).max(200),
  /** Expected total household income for the period, minor units. */
  expectedIncome: z.number().int().min(0).nullish(),
});
export type UpsertBudgetInput = z.infer<typeof upsertBudgetSchema>;

export interface BudgetLineStatus {
  categorySlug: string;
  categoryName: string;
  groupSlug: string;
  color: string;
  limit: number;
  /** Whether this line carries its remainder into the next period. */
  rollover: boolean;
  /** Positive minor units actually spent. */
  spent: number;
  /** Unspent amount carried in from previous periods. */
  rolloverIn: number;
  /** limit + rolloverIn - spent. Negative means overspent. */
  remaining: number;
  /** spent / (limit + rolloverIn), clamped at 0 when there is no limit. */
  utilisation: number;
  /** True when spending is ahead of where the calendar says it should be. */
  offPace: boolean;
}

export interface BudgetStatusDTO {
  period: PeriodKey;
  currency: Currency;
  totalLimit: number;
  totalSpent: number;
  totalRemaining: number;
  expectedIncome: number | null;
  actualIncome: number;
  /** Fraction of the month elapsed, 0..1. */
  periodProgress: number;
  lines: BudgetLineStatus[];
  /** Spending in categories with no budget line set. */
  unbudgetedSpend: number;
}

// ---------------------------------------------------------------------------
// Savings goals
// ---------------------------------------------------------------------------

export const createGoalSchema = z.object({
  name: z.string().min(1).max(120),
  targetAmount: z.number().int().min(1),
  currency: currencySchema.default('SEK'),
  targetDate: dateKeySchema.nullish(),
  /** Account whose balance funds this goal, if it is a dedicated account. */
  fundingAccountId: z.string().nullish(),
  /** Planned monthly contribution, minor units. */
  monthlyContribution: z.number().int().min(0).nullish(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullish(),
  icon: z.string().max(40).nullish(),
});
export type CreateGoalInput = z.infer<typeof createGoalSchema>;

export interface GoalDTO {
  id: string;
  name: string;
  targetAmount: number;
  savedAmount: number;
  currency: Currency;
  targetDate: DateKey | null;
  monthlyContribution: number | null;
  fundingAccountId: string | null;
  color: string | null;
  icon: string | null;
  /** savedAmount / targetAmount, clamped to 0..1. */
  progress: number;
  /** What you must put aside monthly to hit targetDate. null without a date. */
  requiredMonthly: number | null;
  /** Projected completion at the current contribution rate. */
  projectedDate: DateKey | null;
  onTrack: boolean;
  completedAt: string | null;
}

export const contributeGoalSchema = z.object({
  amount: z.number().int(),
  date: dateKeySchema.optional(),
  note: z.string().max(500).nullish(),
});
export type ContributeGoalInput = z.infer<typeof contributeGoalSchema>;

// ---------------------------------------------------------------------------
// Overview / insights
// ---------------------------------------------------------------------------

export interface CategorySpendSlice {
  categorySlug: string;
  categoryName: string;
  groupSlug: string;
  groupName: string;
  color: string;
  amount: number; // positive minor units
  transactionCount: number;
  /** Change vs the same window one period earlier, as a fraction. */
  changeVsPrevious: number | null;
}

export interface OverviewDTO {
  period: PeriodKey;
  currency: Currency;
  income: number;
  spend: number;
  net: number;
  savedToGoals: number;
  /** Net worth across accounts flagged includeInNetWorth. */
  netWorth: number;
  /** Average daily spend so far this period. */
  dailyBurnRate: number;
  /** Projected month-end spend if the current rate holds. */
  projectedSpend: number;
  byGroup: CategorySpendSlice[];
  topCategories: CategorySpendSlice[];
  /** Same-period totals for the previous N months, oldest first. */
  trend: { period: PeriodKey; income: number; spend: number }[];
  uncategorisedCount: number;
  /** Accounts whose bank consent has expired or failed to sync. */
  staleAccountIds: string[];
}

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

export interface ImportPreviewDTO {
  batchId: string;
  detectedFormat: string | null;
  /** Column mapping the detector chose; the user can override before commit. */
  mapping: ColumnMapping;
  /** Header row as found in the file. */
  headers: string[];
  rowCount: number;
  sample: ParsedRowDTO[];
  /** Rows that could not be parsed, with the reason. */
  errors: { row: number; reason: string }[];
  /** Rows matching an existing transaction — skipped unless forced. */
  duplicateCount: number;
}

export interface ParsedRowDTO {
  row: number;
  date: DateKey | null;
  amount: number | null;
  description: string;
  balanceAfter: number | null;
  suggestedCategorySlug: string;
  isDuplicate: boolean;
}

export const columnMappingSchema = z.object({
  date: z.string().nullish(),
  valueDate: z.string().nullish(),
  description: z.string().nullish(),
  amount: z.string().nullish(),
  /** Some banks use separate debit/credit columns instead of one signed one. */
  debit: z.string().nullish(),
  credit: z.string().nullish(),
  balance: z.string().nullish(),
  currency: z.string().nullish(),
  /** Flip the sign — for card statements where a purchase is written positive. */
  invertAmount: z.boolean().default(false),
});
export type ColumnMapping = z.infer<typeof columnMappingSchema>;

export const commitImportSchema = z.object({
  batchId: z.string(),
  accountId: z.string(),
  mapping: columnMappingSchema.optional(),
  /** Import rows flagged as duplicates anyway. */
  includeDuplicates: z.boolean().default(false),
});
export type CommitImportInput = z.infer<typeof commitImportSchema>;

export interface ImportResultDTO {
  batchId: string;
  imported: number;
  skippedDuplicates: number;
  failed: number;
  /** Slug -> count, so the app can show "42 groceries, 8 uncategorised". */
  categorised: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Bank connections
// ---------------------------------------------------------------------------

export type ConnectionStatus =
  | 'pending' // link started, user has not finished the bank's consent flow
  | 'active'
  | 'expired' // PSD2 consent lapsed (90 days), needs re-auth
  | 'error'
  | 'revoked';

export interface InstitutionDTO {
  id: string;
  name: string;
  bic: string | null;
  logoUrl: string | null;
  countries: string[];
  /** Days of history the institution exposes. */
  transactionTotalDays: number;
}

export interface ConnectionDTO {
  id: string;
  provider: string;
  institutionId: string;
  institutionName: string;
  logoUrl: string | null;
  status: ConnectionStatus;
  /** When the PSD2 consent lapses and the user must re-authenticate. */
  consentExpiresAt: string | null;
  lastSyncedAt: string | null;
  lastError: string | null;
  accountIds: string[];
}

export interface StartLinkDTO {
  connectionId: string;
  /** Open this in a browser/webview; the bank redirects back when done. */
  authUrl: string;
  expiresAt: string;
}

export type { Currency, DateKey, PeriodKey };
