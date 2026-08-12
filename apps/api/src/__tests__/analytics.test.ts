import { describe, it, expect } from 'vitest';
import { computeBudgetStatus, computeRolloverOut, suggestBudget, type BudgetLineInput } from '../services/budget.js';
import { projectGoal, monthsBetween, allocateMonthlySavings, type GoalInput } from '../services/goals.js';
import { detectTransfers } from '../services/transfers.js';
import { computeOverview, summarise } from '../services/overview.js';

const line = (over: Partial<BudgetLineInput>): BudgetLineInput => ({
  categorySlug: 'groceries',
  categoryName: 'Groceries',
  groupSlug: 'food',
  color: '#37B24D',
  limit: 500000,
  rollover: false,
  ...over,
});

describe('computeBudgetStatus', () => {
  const mid = new Date('2024-04-15T12:00:00Z');

  it('reports spend as a positive number against the limit', () => {
    const status = computeBudgetStatus({
      period: '2024-04',
      currency: 'SEK',
      lines: [line({})],
      netByCategory: new Map([['groceries', -420000]]),
      actualIncome: 3450000,
      unbudgetedSpend: 0,
      now: mid,
    });

    expect(status.lines[0]!.spent).toBe(420000);
    expect(status.lines[0]!.remaining).toBe(80000);
    expect(status.lines[0]!.utilisation).toBeCloseTo(0.84, 2);
    expect(status.totalSpent).toBe(420000);
  });

  it('nets refunds against the category rather than counting them as income', () => {
    const status = computeBudgetStatus({
      period: '2024-04',
      currency: 'SEK',
      lines: [line({ categorySlug: 'clothing', limit: 200000 })],
      // Bought for 1500 kr, returned 500 kr.
      netByCategory: new Map([['clothing', -150000 + 50000]]),
      actualIncome: 0,
      unbudgetedSpend: 0,
      now: mid,
    });

    expect(status.lines[0]!.spent).toBe(100000);
  });

  it('floors a net-positive category at zero spend', () => {
    const status = computeBudgetStatus({
      period: '2024-04',
      currency: 'SEK',
      lines: [line({ categorySlug: 'clothing', limit: 200000 })],
      netByCategory: new Map([['clothing', 25000]]), // refunds exceeded purchases
      actualIncome: 0,
      unbudgetedSpend: 0,
      now: mid,
    });

    expect(status.lines[0]!.spent).toBe(0);
    expect(status.lines[0]!.remaining).toBe(200000);
  });

  it('flags a line as off-pace when spending outruns the calendar', () => {
    // Half way through April, 90% of the grocery budget is gone.
    const status = computeBudgetStatus({
      period: '2024-04',
      currency: 'SEK',
      lines: [line({})],
      netByCategory: new Map([['groceries', -450000]]),
      actualIncome: 0,
      unbudgetedSpend: 0,
      now: mid,
    });

    expect(status.periodProgress).toBeCloseTo(0.5, 1);
    expect(status.lines[0]!.offPace).toBe(true);
  });

  it('does not flag spending that merely tracks the calendar', () => {
    const status = computeBudgetStatus({
      period: '2024-04',
      currency: 'SEK',
      lines: [line({})],
      netByCategory: new Map([['groceries', -255000]]), // ~51%
      actualIncome: 0,
      unbudgetedSpend: 0,
      now: mid,
    });

    expect(status.lines[0]!.offPace).toBe(false);
  });

  it('never flags off-pace once the period is over', () => {
    const status = computeBudgetStatus({
      period: '2024-03',
      currency: 'SEK',
      lines: [line({})],
      netByCategory: new Map([['groceries', -600000]]),
      actualIncome: 0,
      unbudgetedSpend: 0,
      now: mid,
    });

    expect(status.lines[0]!.offPace).toBe(false);
    expect(status.lines[0]!.remaining).toBeLessThan(0);
  });

  it('adds carried-over budget to what is available', () => {
    const status = computeBudgetStatus({
      period: '2024-04',
      currency: 'SEK',
      lines: [line({ rollover: true })],
      netByCategory: new Map([['groceries', -550000]]),
      rolloverIn: new Map([['groceries', 100000]]),
      actualIncome: 0,
      unbudgetedSpend: 0,
      now: mid,
    });

    expect(status.lines[0]!.remaining).toBe(50000);
    expect(status.totalRemaining).toBe(50000);
  });

  it('carries overspend forward as a negative', () => {
    const status = computeBudgetStatus({
      period: '2024-04',
      currency: 'SEK',
      lines: [line({})],
      netByCategory: new Map([['groceries', -620000]]),
      actualIncome: 0,
      unbudgetedSpend: 0,
      now: mid,
    });

    expect(computeRolloverOut(status).get('groceries')).toBe(-120000);
  });
});

describe('suggestBudget', () => {
  it('uses the median so one unusual month does not inflate the suggestion', () => {
    const suggestions = suggestBudget({
      historyByCategory: new Map([['groceries', [-400000, -420000, -410000, -1500000]]]),
      fixedCategories: new Set(),
    });
    // Median of 4000/4200/4100/15000 is 4150 kr, rounded up to 4200 kr.
    expect(suggestions.get('groceries')).toBe(420000);
  });

  it('uses the latest value for fixed costs', () => {
    const suggestions = suggestBudget({
      historyByCategory: new Map([['rent', [-1200000, -1200000, -1250000]]]),
      fixedCategories: new Set(['rent']),
    });
    expect(suggestions.get('rent')).toBe(1250000);
  });

  it('ignores categories with no spending history', () => {
    const suggestions = suggestBudget({
      historyByCategory: new Map([['travel', [0, 0]]]),
      fixedCategories: new Set(),
    });
    expect(suggestions.has('travel')).toBe(false);
  });
});

describe('goal projections', () => {
  const base: GoalInput = {
    id: 'g1',
    name: 'Buffert',
    targetAmount: 5000000,
    currency: 'SEK',
    targetDate: null,
    monthlyContribution: 500000,
    fundingAccountId: null,
    color: null,
    icon: null,
    completedAt: null,
    contributedAmount: 1000000,
    fundingAccountBalance: null,
  };

  const now = new Date('2024-04-15T00:00:00Z');

  it('tracks progress from logged contributions', () => {
    const dto = projectGoal(base, now);
    expect(dto.savedAmount).toBe(1000000);
    expect(dto.progress).toBeCloseTo(0.2, 5);
  });

  it('tracks the funding account balance when the goal has one', () => {
    const dto = projectGoal(
      { ...base, fundingAccountId: 'acc-1', fundingAccountBalance: 3000000 },
      now,
    );
    expect(dto.savedAmount).toBe(3000000);
  });

  it('computes what must be saved monthly to hit the target date', () => {
    const dto = projectGoal({ ...base, targetDate: '2024-10-15' }, now);
    // 40 000 kr remaining over 6 months.
    expect(dto.requiredMonthly).toBe(Math.ceil(4000000 / 6));
  });

  it('projects a completion date from the contribution rate', () => {
    const dto = projectGoal(base, now);
    // 40 000 kr remaining at 5 000 kr/month = 8 months.
    expect(dto.projectedDate).toBe('2024-12-15');
  });

  it('has no projected date without a contribution rate', () => {
    expect(projectGoal({ ...base, monthlyContribution: null }, now).projectedDate).toBeNull();
  });

  it('marks a goal off-track when contributions fall short of the deadline', () => {
    const dto = projectGoal(
      { ...base, targetDate: '2024-06-15', monthlyContribution: 100000 },
      now,
    );
    expect(dto.onTrack).toBe(false);
  });

  it('treats a fully funded goal as complete and on track', () => {
    const dto = projectGoal({ ...base, contributedAmount: 5000000 }, now);
    expect(dto.progress).toBe(1);
    expect(dto.onTrack).toBe(true);
    expect(dto.requiredMonthly).toBeNull();
  });

  it('caps progress at 1 when the goal is overfunded', () => {
    expect(projectGoal({ ...base, contributedAmount: 6000000 }, now).progress).toBe(1);
  });
});

describe('monthsBetween', () => {
  const now = new Date('2024-04-15T00:00:00Z');

  it('counts whole months forward', () => {
    expect(monthsBetween(now, '2024-10-15')).toBe(6);
  });

  it('does not count a month that ends before the same day', () => {
    expect(monthsBetween(now, '2024-10-01')).toBe(5);
  });

  it('returns zero for a date in the past', () => {
    expect(monthsBetween(now, '2023-01-01')).toBe(0);
  });
});

describe('allocateMonthlySavings', () => {
  it('funds dated goals first, in deadline order', () => {
    const goals = [
      { id: 'far', requiredMonthly: 200000, targetDate: '2025-12-01', completedAt: null, progress: 0.1 },
      { id: 'near', requiredMonthly: 300000, targetDate: '2024-08-01', completedAt: null, progress: 0.2 },
    ] as never;

    const allocation = allocateMonthlySavings(goals, 400000);
    expect(allocation.get('near')).toBe(300000);
    expect(allocation.get('far')).toBe(100000);
  });

  it('spreads what is left over open-ended goals without losing öre', () => {
    const goals = [
      { id: 'a', requiredMonthly: null, targetDate: null, completedAt: null, progress: 0 },
      { id: 'b', requiredMonthly: null, targetDate: null, completedAt: null, progress: 0 },
      { id: 'c', requiredMonthly: null, targetDate: null, completedAt: null, progress: 0 },
    ] as never;

    const allocation = allocateMonthlySavings(goals, 100);
    expect([...allocation.values()].reduce((a, b) => a + b, 0)).toBe(100);
  });

  it('allocates nothing when there is nothing to save', () => {
    expect(allocateMonthlySavings([], 0).size).toBe(0);
  });
});

describe('detectTransfers', () => {
  it('pairs equal and opposite legs across two accounts', () => {
    const pairs = detectTransfers([
      { id: 'out', accountId: 'a', date: '2024-05-01', amount: -500000, description: 'ÖVERFÖRING SPARKONTO' },
      { id: 'in', accountId: 'b', date: '2024-05-01', amount: 500000, description: 'ÖVERFÖRING FRÅN PRIVATKONTO' },
    ]);

    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({ outgoingId: 'out', incomingId: 'in', amount: 500000, lagDays: 0 });
  });

  it('tolerates a booking lag between the legs', () => {
    const pairs = detectTransfers([
      { id: 'out', accountId: 'a', date: '2024-05-01', amount: -500000, description: 'ÖVERFÖRING' },
      { id: 'in', accountId: 'b', date: '2024-05-03', amount: 500000, description: 'ÖVERFÖRING' },
    ]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]!.lagDays).toBe(2);
  });

  it('does not pair legs booked too far apart', () => {
    const pairs = detectTransfers([
      { id: 'out', accountId: 'a', date: '2024-05-01', amount: -500000, description: 'ÖVERFÖRING' },
      { id: 'in', accountId: 'b', date: '2024-05-20', amount: 500000, description: 'ÖVERFÖRING' },
    ]);
    expect(pairs).toHaveLength(0);
  });

  it('never pairs two rows on the same account', () => {
    const pairs = detectTransfers([
      { id: 'out', accountId: 'a', date: '2024-05-01', amount: -500000, description: 'KÖP' },
      { id: 'in', accountId: 'a', date: '2024-05-01', amount: 500000, description: 'ÅTERKÖP' },
    ]);
    expect(pairs).toHaveLength(0);
  });

  it('claims each incoming leg at most once', () => {
    const pairs = detectTransfers([
      { id: 'out1', accountId: 'a', date: '2024-05-01', amount: -500000, description: 'ÖVERFÖRING' },
      { id: 'out2', accountId: 'a', date: '2024-05-01', amount: -500000, description: 'ÖVERFÖRING' },
      { id: 'in1', accountId: 'b', date: '2024-05-01', amount: 500000, description: 'ÖVERFÖRING' },
    ]);
    expect(pairs).toHaveLength(1);
  });

  it('ignores small amounts that could pair by coincidence', () => {
    const pairs = detectTransfers([
      { id: 'out', accountId: 'a', date: '2024-05-01', amount: -2000, description: 'KAFFE' },
      { id: 'in', accountId: 'b', date: '2024-05-01', amount: 2000, description: 'ÅTERBETALNING' },
    ]);
    expect(pairs).toHaveLength(0);
  });

  it('pairs a credit-card settlement', () => {
    const pairs = detectTransfers([
      { id: 'pay', accountId: 'checking', date: '2024-05-27', amount: -450000, description: 'KORTBETALNING AMEX' },
      { id: 'credit', accountId: 'amex', date: '2024-05-27', amount: 450000, description: 'INBETALNING TACK' },
    ]);
    expect(pairs).toHaveLength(1);
  });
});

describe('overview totals', () => {
  it('excludes transfers from both spend and income', () => {
    const totals = summarise([
      { categorySlug: 'groceries', amount: -45900 },
      { categorySlug: 'salary', amount: 3450000 },
      { categorySlug: 'internal-transfer', amount: -500000 },
      { categorySlug: 'internal-transfer', amount: 500000 },
      { categorySlug: 'savings-transfer', amount: -500000 },
    ]);

    expect(totals.spend).toBe(45900);
    expect(totals.income).toBe(3450000);
  });

  it('nets a refund against its own category instead of adding income', () => {
    const totals = summarise([
      { categorySlug: 'clothing', amount: -150000 },
      { categorySlug: 'clothing', amount: 50000 },
    ]);

    expect(totals.spend).toBe(100000);
    expect(totals.income).toBe(0);
  });

  it('projects month-end spend from the rate so far', () => {
    const overview = computeOverview({
      period: '2024-04',
      currency: 'SEK',
      entries: [{ categorySlug: 'groceries', amount: -300000 }],
      netWorth: 10000000,
      savedToGoals: 0,
      uncategorisedCount: 0,
      staleAccountIds: [],
      now: new Date('2024-04-15T12:00:00Z'),
    });

    // 3 000 kr over ~15 days = 200 kr/day, projected over 30 days = 6 000 kr.
    expect(overview.dailyBurnRate).toBe(20000);
    expect(overview.projectedSpend).toBe(600000);
  });

  it('rolls categories up into groups for the chart', () => {
    const overview = computeOverview({
      period: '2024-04',
      currency: 'SEK',
      entries: [
        { categorySlug: 'groceries', amount: -400000 },
        { categorySlug: 'restaurants', amount: -100000 },
        { categorySlug: 'fuel', amount: -80000 },
      ],
      netWorth: 0,
      savedToGoals: 0,
      uncategorisedCount: 0,
      staleAccountIds: [],
      now: new Date('2024-04-15T12:00:00Z'),
    });

    const food = overview.byGroup.find((g) => g.groupSlug === 'food');
    expect(food?.amount).toBe(500000);
    expect(overview.byGroup[0]!.groupSlug).toBe('food');
  });

  it('reports change against the previous period', () => {
    const overview = computeOverview({
      period: '2024-04',
      currency: 'SEK',
      entries: [{ categorySlug: 'groceries', amount: -600000 }],
      previousEntries: [{ categorySlug: 'groceries', amount: -400000 }],
      netWorth: 0,
      savedToGoals: 0,
      uncategorisedCount: 0,
      staleAccountIds: [],
      now: new Date('2024-04-15T12:00:00Z'),
    });

    expect(overview.topCategories[0]!.changeVsPrevious).toBeCloseTo(0.5, 5);
  });
});
