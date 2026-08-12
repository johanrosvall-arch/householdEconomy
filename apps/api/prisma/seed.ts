/**
 * Seeds a demo household with a connected mock bank, a budget and two savings
 * goals, so a fresh checkout has something to look at immediately.
 *
 * Safe to re-run: it upserts the demo user and relies on transaction dedupe.
 */
import { PrismaClient } from '@prisma/client';
import { addMonths, toDateKey } from '@household/shared';
import { hashPassword } from '../src/lib/auth.js';
import { seedCategories } from '../src/services/household-setup.js';
import { MockBankProvider } from '../src/services/banking/mock.js';
import { insertTransactions } from '../src/services/ledger.js';

const prisma = new PrismaClient();

const DEMO_EMAIL = 'demo@household.local';
const DEMO_PASSWORD = 'demo-household-2024';

async function main(): Promise<void> {
  console.log('Seeding demo data...');

  const user = await prisma.user.upsert({
    where: { email: DEMO_EMAIL },
    update: {},
    create: {
      email: DEMO_EMAIL,
      passwordHash: await hashPassword(DEMO_PASSWORD),
      displayName: 'Demo',
    },
  });

  let household = await prisma.household.findFirst({
    where: { members: { some: { userId: user.id } } },
  });

  if (!household) {
    household = await prisma.household.create({
      data: {
        name: 'Familjen Demo',
        baseCurrency: 'SEK',
        budgetStartDay: 25,
        members: { create: { userId: user.id, role: 'owner' } },
      },
    });
  }
  await seedCategories(household.id);
  console.log(`  household: ${household.name} (${household.id})`);

  // --- A connected bank, via the mock provider ----------------------------
  const provider = new MockBankProvider();
  let connection = await prisma.connection.findFirst({
    where: { householdId: household.id, provider: 'mock' },
  });

  if (!connection) {
    connection = await prisma.connection.create({
      data: {
        householdId: household.id,
        provider: 'mock',
        institutionId: 'HANDELSBANKEN_HANDSESS',
        institutionName: 'Handelsbanken',
        status: 'active',
        consentExpiresAt: new Date(Date.now() + 90 * 24 * 3600 * 1000),
      },
    });

    const link = await provider.createLink({
      institutionId: 'HANDELSBANKEN_HANDSESS',
      redirectUrl: 'householdeconomy://bank-callback',
      reference: connection.id,
    });
    connection = await prisma.connection.update({
      where: { id: connection.id },
      data: { externalRef: link.externalRef },
    });
  }

  const providerAccounts = await provider.fetchAccounts(connection.externalRef!);

  for (const providerAccount of providerAccounts) {
    const account = await prisma.account.upsert({
      where: {
        connectionId_externalId: {
          connectionId: connection.id,
          externalId: providerAccount.externalId,
        },
      },
      update: {},
      create: {
        householdId: household.id,
        connectionId: connection.id,
        externalId: providerAccount.externalId,
        name: providerAccount.name,
        type: providerAccount.externalId.endsWith(':savings') ? 'savings' : 'checking',
        currency: providerAccount.currency,
        mask: providerAccount.mask,
        institutionName: 'Handelsbanken',
      },
    });

    const transactions = await provider.fetchTransactions(
      connection.externalRef!,
      providerAccount.externalId,
    );

    const result = await insertTransactions(
      transactions.map((t) => ({
        date: t.bookingDate,
        valueDate: t.valueDate,
        amount: t.amount,
        currency: t.currency,
        description: t.description,
        counterparty: t.counterparty,
        externalId: t.externalId,
      })),
      { householdId: household.id, accountId: account.id, source: 'bank_sync' },
    );

    // Book an opening balance ahead of the history window.
    //
    // Balances are derived from the ledger, so without this an account's
    // balance is just the sum of six months of activity — which for a current
    // account is roughly "income minus outgoings" and lands deeply negative.
    // Anchoring to the balance the provider reports makes the seeded data
    // resemble a real household.
    //
    // Categorised as an internal transfer and locked, so it never registers as
    // income or spending in any total.
    const target = providerAccount.balance ?? 0;
    const ledger = await prisma.transaction.aggregate({
      where: { accountId: account.id },
      _sum: { amount: true },
    });
    const opening = target - (ledger._sum.amount ?? 0);

    if (opening !== 0) {
      const openingDate = new Date();
      openingDate.setUTCMonth(openingDate.getUTCMonth() - 7);

      const openingResult = await insertTransactions(
        [{ date: toDateKey(openingDate), amount: opening, description: 'Ingående saldo' }],
        { householdId: household.id, accountId: account.id, source: 'manual' },
      );

      const openingId = openingResult.insertedIds[0];
      if (openingId) {
        const transferCategory = await prisma.category.findUnique({
          where: { householdId_slug: { householdId: household.id, slug: 'internal-transfer' } },
          select: { id: true },
        });
        if (transferCategory) {
          await prisma.transaction.update({
            where: { id: openingId },
            data: { categoryId: transferCategory.id, categoryLocked: true },
          });
        }
      }
    }

    console.log(`  ${account.name}: ${result.imported} transactions imported`);
  }

  // --- A credit card, added manually --------------------------------------
  const card = await prisma.account.upsert({
    where: { id: `${household.id}-amex` },
    update: {},
    create: {
      id: `${household.id}-amex`,
      householdId: household.id,
      name: 'Amex',
      type: 'credit_card',
      currency: 'SEK',
      institutionName: 'American Express',
      mask: '1007',
    },
  });

  // --- Budget for the current month ---------------------------------------
  const period = toDateKey(new Date()).slice(0, 7);
  const categories = await prisma.category.findMany({
    where: { householdId: household.id },
    select: { id: true, slug: true },
  });
  const idBySlug = new Map(categories.map((c) => [c.slug, c.id]));

  const limits: [string, number, boolean][] = [
    ['groceries', 900000, false],
    ['restaurants', 250000, false],
    ['rent', 1250000, false],
    ['electricity', 150000, false],
    ['public-transport', 100000, false],
    ['fuel', 150000, false],
    ['subscriptions', 120000, false],
    ['clothing', 150000, true],
    ['childcare', 152000, false],
    ['travel', 300000, true],
  ];

  const budget = await prisma.budget.upsert({
    where: { householdId_period: { householdId: household.id, period } },
    update: { expectedIncome: 5200000 },
    create: { householdId: household.id, period, expectedIncome: 5200000 },
  });

  await prisma.budgetLine.deleteMany({ where: { budgetId: budget.id } });
  await prisma.budgetLine.createMany({
    data: limits
      .filter(([slug]) => idBySlug.has(slug))
      .map(([slug, limit, rollover]) => ({
        budgetId: budget.id,
        categoryId: idBySlug.get(slug)!,
        limit,
        rollover,
      })),
  });
  console.log(`  budget for ${period}: ${limits.length} lines`);

  // --- Savings goals -------------------------------------------------------
  const savingsAccount = await prisma.account.findFirst({
    where: { householdId: household.id, type: 'savings' },
    select: { id: true },
  });

  const existingGoals = await prisma.savingsGoal.count({ where: { householdId: household.id } });
  if (existingGoals === 0) {
    await prisma.savingsGoal.create({
      data: {
        householdId: household.id,
        name: 'Buffert',
        targetAmount: 10000000, // 100 000 kr
        monthlyContribution: 500000,
        fundingAccountId: savingsAccount?.id ?? null,
        color: '#3BC9DB',
        icon: 'shield',
      },
    });

    const summerTrip = await prisma.savingsGoal.create({
      data: {
        householdId: household.id,
        name: 'Sommarresa',
        targetAmount: 3500000,
        targetDate: `${addMonths(period, 8)}-01`,
        monthlyContribution: 400000,
        color: '#F76707',
        icon: 'plane',
      },
    });

    await prisma.goalContribution.createMany({
      data: [0, 1, 2].map((i) => ({
        goalId: summerTrip.id,
        amount: 400000,
        date: `${addMonths(period, -i)}-05`,
        note: 'Månadssparande',
      })),
    });
    console.log('  goals: Buffert, Sommarresa');
  }

  // --- A categorisation rule ----------------------------------------------
  const lunchCategory = idBySlug.get('work-lunch');
  if (lunchCategory) {
    const existing = await prisma.categoryRule.findFirst({
      where: { householdId: household.id, pattern: 'espresso house' },
    });
    if (!existing) {
      await prisma.categoryRule.create({
        data: {
          householdId: household.id,
          categoryId: lunchCategory,
          field: 'description',
          matchType: 'contains',
          pattern: 'espresso house',
          priority: 200,
        },
      });
    }
  }

  console.log('\nDone. Sign in with:');
  console.log(`  email:    ${DEMO_EMAIL}`);
  console.log(`  password: ${DEMO_PASSWORD}`);
  console.log(`  card account created: ${card.name}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
