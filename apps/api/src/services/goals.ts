import type { Currency, DateKey, GoalDTO } from '@household/shared';
import { toDateKey } from '@household/shared';

/**
 * Savings-goal projections.
 *
 * A goal is either *contribution-tracked* (the user records what they set
 * aside) or *account-tracked* (progress mirrors the balance of a dedicated
 * savings account). Account-tracked goals are the honest option for most
 * households — the number moves whether or not anyone remembers to log it.
 */

export interface GoalInput {
  id: string;
  name: string;
  targetAmount: number;
  currency: Currency;
  targetDate: DateKey | null;
  monthlyContribution: number | null;
  fundingAccountId: string | null;
  color: string | null;
  icon: string | null;
  completedAt: Date | null;
  /** Sum of logged contributions, minor units. */
  contributedAmount: number;
  /** Balance of the funding account, when the goal tracks one. */
  fundingAccountBalance: number | null;
}

export function projectGoal(goal: GoalInput, now: Date = new Date()): GoalDTO {
  const saved = goal.fundingAccountId != null && goal.fundingAccountBalance != null
    ? Math.max(goal.fundingAccountBalance, 0)
    : goal.contributedAmount;

  const remaining = Math.max(goal.targetAmount - saved, 0);
  const progress = goal.targetAmount > 0 ? Math.min(saved / goal.targetAmount, 1) : 0;

  const monthsLeft = goal.targetDate ? monthsBetween(now, goal.targetDate) : null;

  // Required monthly to hit the date. A target date already past, or reached
  // early, needs nothing further.
  let requiredMonthly: number | null = null;
  if (monthsLeft != null && remaining > 0) {
    requiredMonthly = monthsLeft <= 0 ? remaining : Math.ceil(remaining / monthsLeft);
  } else if (monthsLeft != null) {
    requiredMonthly = 0;
  }

  const rate = goal.monthlyContribution ?? 0;
  const projectedDate =
    remaining === 0
      ? toDateKey(now)
      : rate > 0
        ? toDateKey(addMonths(now, Math.ceil(remaining / rate)))
        : null;

  const onTrack =
    remaining === 0 ||
    (requiredMonthly != null ? rate >= requiredMonthly : rate > 0);

  return {
    id: goal.id,
    name: goal.name,
    targetAmount: goal.targetAmount,
    savedAmount: saved,
    currency: goal.currency,
    targetDate: goal.targetDate,
    monthlyContribution: goal.monthlyContribution,
    fundingAccountId: goal.fundingAccountId,
    color: goal.color,
    icon: goal.icon,
    progress,
    requiredMonthly,
    projectedDate,
    onTrack,
    completedAt: goal.completedAt ? goal.completedAt.toISOString() : null,
  };
}

/**
 * Whole months from `now` until the target date, rounded up so a goal due at
 * the end of next month counts as two contributions, not one.
 * Returns 0 for a date in the past.
 */
export function monthsBetween(now: Date, target: DateKey): number {
  const targetDate = new Date(`${target}T00:00:00Z`);
  if (Number.isNaN(targetDate.getTime())) return 0;

  const months =
    (targetDate.getUTCFullYear() - now.getUTCFullYear()) * 12 +
    (targetDate.getUTCMonth() - now.getUTCMonth());

  // Partial month counts as one more chance to contribute.
  const dayAdjustment = targetDate.getUTCDate() >= now.getUTCDate() ? 0 : -1;
  return Math.max(months + dayAdjustment, 0);
}

function addMonths(date: Date, months: number): Date {
  const d = new Date(date.getTime());
  d.setUTCMonth(d.getUTCMonth() + months);
  return d;
}

/**
 * Splits an amount a household can save each month across goals.
 *
 * Goals with a deadline are funded first, in order of urgency, up to what each
 * needs; whatever is left is spread over the open-ended goals. This is what
 * the "how should we split our saving?" suggestion on the goals screen uses.
 */
export function allocateMonthlySavings(
  goals: readonly GoalDTO[],
  available: number,
): Map<string, number> {
  const allocation = new Map<string, number>();
  if (available <= 0) return allocation;

  const active = goals.filter((g) => g.completedAt == null && g.progress < 1);
  const dated = active
    .filter((g) => g.requiredMonthly != null && g.requiredMonthly > 0)
    .sort((a, b) => (a.targetDate ?? '').localeCompare(b.targetDate ?? ''));
  const undated = active.filter((g) => g.requiredMonthly == null || g.requiredMonthly === 0);

  let left = available;
  for (const goal of dated) {
    if (left <= 0) break;
    const take = Math.min(goal.requiredMonthly!, left);
    allocation.set(goal.id, take);
    left -= take;
  }

  if (left > 0 && undated.length > 0) {
    const share = Math.floor(left / undated.length);
    let remainder = left - share * undated.length;
    for (const goal of undated) {
      const extra = remainder > 0 ? 1 : 0;
      remainder -= extra;
      allocation.set(goal.id, (allocation.get(goal.id) ?? 0) + share + extra);
    }
  }

  return allocation;
}
