import { createHash } from 'node:crypto';
import type { InstitutionDTO } from '@household/shared';
import { toDateKey } from '@household/shared';
import type {
  BankProvider,
  CreateLinkParams,
  CreateLinkResult,
  FetchTransactionsOptions,
  LinkState,
  ProviderAccount,
  ProviderTransaction,
} from './provider.js';

/**
 * Development adapter.
 *
 * Deliberately shaped like GoCardless Bank Account Data (institutions ->
 * requisition -> accounts -> transactions) so the real adapter is a drop-in.
 * It generates a plausible Swedish household's spending — salary on the 25th,
 * rent on the 1st, an ICA run most weeks — which makes the budget, overview
 * and categorisation screens usable end-to-end before any provider contract
 * is signed.
 *
 * Output is deterministic: the same connection id always produces the same
 * ledger, so a re-sync dedupes to zero new rows exactly as a real bank would.
 */

const INSTITUTIONS: InstitutionDTO[] = [
  { id: 'HANDELSBANKEN_HANDSESS', name: 'Handelsbanken', bic: 'HANDSESS', logoUrl: null, countries: ['SE'], transactionTotalDays: 730 },
  { id: 'LANSFORSAKRINGAR_ELLFSESS', name: 'Länsförsäkringar Bank', bic: 'ELLFSESS', logoUrl: null, countries: ['SE'], transactionTotalDays: 730 },
  { id: 'SWEDBANK_SWEDSESS', name: 'Swedbank', bic: 'SWEDSESS', logoUrl: null, countries: ['SE'], transactionTotalDays: 730 },
  { id: 'SEB_ESSESESS', name: 'SEB', bic: 'ESSESESS', logoUrl: null, countries: ['SE'], transactionTotalDays: 730 },
  { id: 'NORDEA_NDEASESS', name: 'Nordea', bic: 'NDEASESS', logoUrl: null, countries: ['SE'], transactionTotalDays: 730 },
  { id: 'ICA_BANKEN_IBCASES', name: 'ICA Banken', bic: 'IBCASES1', logoUrl: null, countries: ['SE'], transactionTotalDays: 365 },
  { id: 'AMEX_AESUSE33', name: 'American Express', bic: 'AESUSE33', logoUrl: null, countries: ['SE'], transactionTotalDays: 365 },
  { id: 'KLARNA_KLRNSESS', name: 'Klarna', bic: 'KLRNSESS', logoUrl: null, countries: ['SE'], transactionTotalDays: 365 },
];

/** Deterministic 0..1 pseudo-random derived from a seed string. */
function rand(seed: string): number {
  const hash = createHash('sha256').update(seed).digest();
  return hash.readUInt32BE(0) / 0xffffffff;
}

function pick<T>(items: readonly T[], seed: string): T {
  return items[Math.floor(rand(seed) * items.length) % items.length]!;
}

const GROCERY_MERCHANTS = ['ICA KVANTUM VASASTAN', 'COOP KONSUM', 'WILLYS HEMMA', 'HEMKÖP CITY', 'LIDL SVERIGE'];
const CAFE_MERCHANTS = ['ESPRESSO HOUSE 214', 'WAYNES COFFEE', 'CONDECO', 'BAGERI PETRUS'];
const RESTAURANT_MERCHANTS = ['MAX BURGERS', 'PIZZERIA ROMA', 'VAPIANO STHLM', 'O LEARYS', 'FOODORA AB'];
const TRANSPORT_MERCHANTS = ['SL BILJETT', 'SJ AB', 'EASYPARK AB', 'CIRCLE K 1421', 'UBER BV'];
const RETAIL_MERCHANTS = ['H&M SE0142', 'IKEA KUNGENS KURVA', 'CLAS OHLSON', 'APOTEK HJÄRTAT', 'SYSTEMBOLAGET 0731', 'ELGIGANTEN'];
const SUBSCRIPTIONS: { name: string; amount: number; day: number }[] = [
  { name: 'SPOTIFY AB', amount: -13900, day: 4 },
  { name: 'NETFLIX.COM', amount: -14900, day: 8 },
  { name: 'TELIA SVERIGE AB', amount: -39900, day: 12 },
  { name: 'SATS SVERIGE', amount: -54900, day: 2 },
  { name: 'BAHNHOF AB BREDBAND', amount: -42900, day: 15 },
];

export class MockBankProvider implements BankProvider {
  readonly id = 'mock';
  readonly label = 'Mock bank (development)';

  private readonly links = new Map<string, { institutionId: string; createdAt: Date }>();

  async listInstitutions(country: string): Promise<InstitutionDTO[]> {
    const upper = country.toUpperCase();
    return INSTITUTIONS.filter((i) => i.countries.includes(upper));
  }

  async createLink(params: CreateLinkParams): Promise<CreateLinkResult> {
    const externalRef = `mock-req-${params.reference}`;
    this.links.set(externalRef, { institutionId: params.institutionId, createdAt: new Date() });

    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
    const consentExpiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);

    // A real provider returns the bank's own authentication URL. The mock
    // points back at our callback so the flow completes without a browser.
    const authUrl = `${params.redirectUrl}?ref=${encodeURIComponent(externalRef)}&mock=1`;

    return { externalRef, authUrl, expiresAt, consentExpiresAt };
  }

  async getLinkState(externalRef: string): Promise<LinkState> {
    const link = this.links.get(externalRef);
    const institutionId = link?.institutionId ?? 'HANDELSBANKEN_HANDSESS';
    return {
      status: 'active',
      accountRefs: this.accountRefsFor(externalRef, institutionId),
    };
  }

  async fetchAccounts(externalRef: string): Promise<ProviderAccount[]> {
    const link = this.links.get(externalRef);
    const institutionId = link?.institutionId ?? 'HANDELSBANKEN_HANDSESS';
    const institution = INSTITUTIONS.find((i) => i.id === institutionId);

    if (institutionId.startsWith('AMEX') || institutionId.startsWith('KLARNA')) {
      return [
        {
          externalId: `${externalRef}:card`,
          name: institution?.name ?? 'Card',
          iban: null,
          mask: String(Math.floor(rand(externalRef + 'mask') * 9000) + 1000),
          currency: 'SEK',
          balance: -Math.floor(rand(externalRef + 'bal') * 800000),
          product: institutionId.startsWith('KLARNA') ? 'Klarna konto' : 'Amex Card',
          ownerName: null,
        },
      ];
    }

    return [
      {
        externalId: `${externalRef}:checking`,
        name: 'Privatkonto',
        iban: `SE45${Math.floor(rand(externalRef + 'iban') * 1e12)}`,
        mask: String(Math.floor(rand(externalRef + 'm1') * 9000) + 1000),
        currency: 'SEK',
        balance: Math.floor(rand(externalRef + 'b1') * 4000000) + 500000,
        product: 'Privatkonto',
        ownerName: null,
      },
      {
        externalId: `${externalRef}:savings`,
        name: 'Sparkonto',
        iban: null,
        mask: String(Math.floor(rand(externalRef + 'm2') * 9000) + 1000),
        currency: 'SEK',
        balance: Math.floor(rand(externalRef + 'b2') * 15000000),
        product: 'Sparkonto',
        ownerName: null,
      },
    ];
  }

  async fetchTransactions(
    externalRef: string,
    accountRef: string,
    options: FetchTransactionsOptions = {},
  ): Promise<ProviderTransaction[]> {
    const from = options.from ? new Date(`${options.from}T00:00:00Z`) : monthsAgo(6);
    const to = options.to ? new Date(`${options.to}T00:00:00Z`) : new Date();

    if (accountRef.endsWith(':savings')) {
      return this.savingsTransactions(accountRef, from, to);
    }
    if (accountRef.endsWith(':card')) {
      return this.cardTransactions(accountRef, from, to);
    }
    return this.checkingTransactions(accountRef, from, to);
  }

  async deleteLink(externalRef: string): Promise<void> {
    this.links.delete(externalRef);
  }

  private accountRefsFor(externalRef: string, institutionId: string): string[] {
    if (institutionId.startsWith('AMEX') || institutionId.startsWith('KLARNA')) {
      return [`${externalRef}:card`];
    }
    return [`${externalRef}:checking`, `${externalRef}:savings`];
  }

  private checkingTransactions(accountRef: string, from: Date, to: Date): ProviderTransaction[] {
    const out: ProviderTransaction[] = [];

    for (const day of eachDay(from, to)) {
      const key = toDateKey(day);
      const dom = day.getUTCDate();
      const seed = `${accountRef}:${key}`;

      if (dom === 25) {
        out.push(tx(seed + ':salary', key, 3450000 + Math.floor(rand(seed + 's') * 200000), 'LÖN ACME AB', 'Acme AB'));
      }
      if (dom === 1) {
        out.push(tx(seed + ':rent', key, -1250000, 'HYRA BRF SOLGÅRDEN', 'BRF Solgården'));
        out.push(tx(seed + ':save', key, -500000, 'ÖVERFÖRING SPARKONTO', null));
      }
      if (dom === 20) {
        out.push(tx(seed + ':el', key, -(89000 + Math.floor(rand(seed + 'e') * 90000)), 'VATTENFALL AB EL', 'Vattenfall'));
      }
      if (dom === 28) {
        out.push(tx(seed + ':childcare', key, -152000, 'FÖRSKOLA STOCKHOLMS STAD', null));
      }

      for (const sub of SUBSCRIPTIONS) {
        if (dom === sub.day) out.push(tx(`${seed}:${sub.name}`, key, sub.amount, sub.name, null));
      }

      // Groceries a few times a week.
      if (rand(seed + 'g') < 0.45) {
        const amount = -(15000 + Math.floor(rand(seed + 'ga') * 90000));
        out.push(tx(seed + ':grocery', key, amount, pick(GROCERY_MERCHANTS, seed + 'gm'), null));
      }
      // Coffee and lunch on weekdays.
      const weekday = day.getUTCDay();
      if (weekday >= 1 && weekday <= 5 && rand(seed + 'c') < 0.5) {
        out.push(tx(seed + ':cafe', key, -(3500 + Math.floor(rand(seed + 'ca') * 8000)), pick(CAFE_MERCHANTS, seed + 'cm'), null));
      }
      if (rand(seed + 'r') < 0.2) {
        out.push(tx(seed + ':rest', key, -(18000 + Math.floor(rand(seed + 'ra') * 60000)), pick(RESTAURANT_MERCHANTS, seed + 'rm'), null));
      }
      if (rand(seed + 't') < 0.25) {
        out.push(tx(seed + ':transport', key, -(3900 + Math.floor(rand(seed + 'ta') * 70000)), pick(TRANSPORT_MERCHANTS, seed + 'tm'), null));
      }
      if (rand(seed + 'x') < 0.12) {
        out.push(tx(seed + ':retail', key, -(9900 + Math.floor(rand(seed + 'xa') * 150000)), pick(RETAIL_MERCHANTS, seed + 'xm'), null));
      }
      if (rand(seed + 'sw') < 0.1) {
        out.push(tx(seed + ':swish', key, -(5000 + Math.floor(rand(seed + 'swa') * 40000)), 'SWISH BETALNING', 'Swish'));
      }
    }

    return out;
  }

  private savingsTransactions(accountRef: string, from: Date, to: Date): ProviderTransaction[] {
    const out: ProviderTransaction[] = [];
    for (const day of eachDay(from, to)) {
      if (day.getUTCDate() !== 1) continue;
      const key = toDateKey(day);
      out.push(tx(`${accountRef}:${key}:in`, key, 500000, 'ÖVERFÖRING FRÅN PRIVATKONTO', null));
      if (day.getUTCMonth() % 3 === 0) {
        out.push(tx(`${accountRef}:${key}:int`, key, 1200 + Math.floor(rand(key) * 4000), 'RÄNTA', null));
      }
    }
    return out;
  }

  private cardTransactions(accountRef: string, from: Date, to: Date): ProviderTransaction[] {
    const out: ProviderTransaction[] = [];
    for (const day of eachDay(from, to)) {
      const key = toDateKey(day);
      const seed = `${accountRef}:${key}`;
      if (rand(seed + 'p') < 0.3) {
        out.push(tx(seed + ':purchase', key, -(19900 + Math.floor(rand(seed + 'pa') * 250000)), pick(RETAIL_MERCHANTS, seed + 'pm'), null));
      }
      if (day.getUTCDate() === 27) {
        out.push(tx(seed + ':settle', key, 450000, 'INBETALNING TACK', null));
      }
    }
    return out;
  }
}

function tx(
  seed: string,
  date: string,
  amount: number,
  description: string,
  counterparty: string | null,
): ProviderTransaction {
  return {
    externalId: createHash('sha1').update(seed).digest('hex').slice(0, 24),
    bookingDate: date,
    valueDate: date,
    amount,
    currency: 'SEK',
    description,
    counterparty,
    merchant: null,
    pending: false,
  };
}

function monthsAgo(months: number): Date {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - months);
  return d;
}

function* eachDay(from: Date, to: Date): Generator<Date> {
  const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  const end = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()));
  while (cursor <= end) {
    yield new Date(cursor);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
}
