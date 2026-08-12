import { describe, it, expect } from 'vitest';
import { classify, applyRules, reclassifyBatch, type RuleLike } from '../services/categorisation.js';
import {
  MERCHANT_RULES,
  matchMerchant,
  normaliseDescription,
  guessMerchantName,
} from '../services/merchants.js';

describe('normaliseDescription', () => {
  it('strips card terminal noise', () => {
    expect(normaliseDescription('KORT 1234 ICA NARA 240517')).toContain('ica nara');
    expect(normaliseDescription('KORT 1234 ICA NARA 240517')).not.toContain('1234');
  });

  it('strips long reference numbers', () => {
    expect(normaliseDescription('SWISH BETALNING 123456789012')).toBe('swish');
  });

  it('collapses whitespace and lowercases', () => {
    expect(normaliseDescription('  ICA   KVANTUM  ')).toBe('ica kvantum');
  });
});

/**
 * Regression guard for a bug that failed completely silently.
 *
 * Patterns are matched against `normaliseDescription` output, which is
 * ASCII-folded — "FÖRSÄKRING" reaches the matcher as "forsakring". So any
 * pattern containing a Swedish character can never match anything, ever.
 *
 * There is a second, sharper trap on top of that: JavaScript's `\b` is defined
 * over `[A-Za-z0-9_]`, so `/\böverföring\b/` fails even against raw text —
 * there is no word boundary before `ö`. (Note this only bites when the pattern
 * *starts or ends* with a non-ASCII letter: `/\bförsäkring\b/` happens to work
 * on raw text, which makes the trap easy to miss when spot-checking.)
 *
 * Either way the failure is silent — no error, no warning, the transaction just
 * quietly lands in "uncategorised". This test fails the moment someone adds a
 * pattern with a Swedish character.
 */
describe('merchant patterns stay ASCII', () => {
  it('has no non-ASCII character in any pattern source', () => {
    const offenders = MERCHANT_RULES.filter((rule) => !/^[\x00-\x7F]*$/.test(rule.match.source)).map(
      (rule) => `${rule.merchant}: /${rule.match.source}/`,
    );

    expect(offenders).toEqual([]);
  });

  it('still matches descriptions that contain Swedish characters', () => {
    // The behavioural half of the guard: ASCII patterns must actually reach
    // real bank text, which is not ASCII.
    expect(matchMerchant('ÖVERFÖRING SPARKONTO')?.category).toBe('internal-transfer');
    expect(matchMerchant('FÖRSKOLA STOCKHOLMS STAD')?.category).toBe('childcare');
    expect(matchMerchant('APOTEK HJÄRTAT 559')?.category).toBe('pharmacy');
    expect(matchMerchant('TRÄNGSELSKATT')?.category).toBe('parking-tolls');
  });
});

describe('merchant dictionary', () => {
  const cases: [string, string, string][] = [
    ['ICA KVANTUM VASASTAN', 'ICA', 'groceries'],
    ['COOP KONSUM 4412', 'Coop', 'groceries'],
    ['WILLYS HEMMA STHLM', 'Willys', 'groceries'],
    ['SYSTEMBOLAGET 0731', 'Systembolaget', 'alcohol-tobacco'],
    ['APOTEK HJÄRTAT 559', 'Apotek Hjärtat', 'pharmacy'],
    ['SPOTIFY AB', 'Spotify', 'subscriptions'],
    ['NETFLIX.COM', 'Netflix', 'subscriptions'],
    ['TELIA SVERIGE AB', 'Mobiloperatör', 'mobile'],
    ['SL BILJETT', 'Kollektivtrafik', 'public-transport'],
    ['CIRCLE K 1421', 'Drivmedel', 'fuel'],
    ['EASYPARK AB', 'Parkering', 'parking-tolls'],
    ['SATS SVERIGE AB', 'Gym', 'gym-sports'],
    ['VATTENFALL AB EL', 'Elbolag', 'electricity'],
    ['IKEA KUNGENS KURVA', 'IKEA', 'home-furnishing'],
    ['ELGIGANTEN 254', 'Elektronik', 'electronics'],
    ['FÖRSKOLA STOCKHOLMS STAD', 'Barnomsorg', 'childcare'],
    ['BARNBIDRAG', 'Barnbidrag', 'child-benefit'],
  ];

  for (const [description, merchant, category] of cases) {
    it(`maps "${description}" to ${category}`, () => {
      const match = matchMerchant(description);
      expect(match).not.toBeNull();
      expect(match!.merchant).toBe(merchant);
      expect(match!.category).toBe(category);
    });
  }

  it('returns null for an unknown merchant', () => {
    expect(matchMerchant('ZZZ OKÄND BUTIK AB')).toBeNull();
  });

  it('guesses a display name when nothing matches', () => {
    expect(guessMerchantName('ZZZ OKÄND BUTIK AB')).toBe('Zzz Okänd Butik');
  });
});

describe('classify', () => {
  it('classifies a known merchant expense', () => {
    const result = classify({ description: 'ICA KVANTUM VASASTAN', amount: -45900 });
    expect(result.categorySlug).toBe('groceries');
    expect(result.source).toBe('merchant');
    expect(result.merchant).toBe('ICA');
  });

  it('classifies salary as income', () => {
    const result = classify({ description: 'LÖN ACME AB', amount: 3450000 });
    expect(result.categorySlug).toBe('salary');
  });

  it('treats money arriving from a shop as a refund, not a purchase', () => {
    const result = classify({ description: 'H&M SE0142', amount: 49900 });
    expect(result.categorySlug).toBe('refund');
  });

  it('leaves neutral transfer categories alone regardless of direction', () => {
    const inbound = classify({ description: 'ÖVERFÖRING SPARKONTO', amount: 500000 });
    const outbound = classify({ description: 'ÖVERFÖRING SPARKONTO', amount: -500000 });
    expect(inbound.categorySlug).toBe('internal-transfer');
    expect(outbound.categorySlug).toBe('internal-transfer');
  });

  it('falls back to uncategorised for unknown spending', () => {
    const result = classify({ description: 'ZZZ OKÄND BUTIK AB', amount: -12300 });
    expect(result.categorySlug).toBe('uncategorised');
    expect(result.source).toBe('fallback');
    expect(result.confidence).toBe(0);
  });

  it('uses a heuristic for unknown incoming money', () => {
    const result = classify({ description: 'INSÄTTNING', amount: 100000 });
    expect(result.categorySlug).toBe('refund');
    expect(result.source).toBe('heuristic');
  });
});

describe('household rules', () => {
  const rule = (over: Partial<RuleLike>): RuleLike => ({
    id: 'r1',
    field: 'description',
    matchType: 'contains',
    pattern: 'test',
    categorySlug: 'groceries',
    priority: 100,
    ...over,
  });

  it('beats the merchant dictionary', () => {
    const rules = [rule({ pattern: 'ICA', categorySlug: 'work-lunch' })];
    const result = classify({ description: 'ICA KVANTUM VASASTAN', amount: -8900 }, rules);
    expect(result.categorySlug).toBe('work-lunch');
    expect(result.source).toBe('rule');
    expect(result.ruleId).toBe('r1');
    expect(result.confidence).toBe(1);
  });

  it('respects priority', () => {
    const rules = [
      rule({ id: 'low', pattern: 'swish', categorySlug: 'person-transfer', priority: 10 }),
      rule({ id: 'high', pattern: 'swish', categorySlug: 'rent', priority: 900 }),
    ];
    expect(applyRules({ description: 'SWISH BETALNING', amount: -100000 }, rules)?.id).toBe('high');
  });

  it('breaks priority ties towards the more specific rule', () => {
    const rules = [
      rule({ id: 'general', pattern: 'swish', categorySlug: 'person-transfer' }),
      rule({ id: 'specific', pattern: 'swish', categorySlug: 'rent', minAmount: 800000 }),
    ];
    // Large Swish payment matches both; the amount-constrained rule wins.
    expect(applyRules({ description: 'SWISH BETALNING', amount: -900000 }, rules)?.id).toBe('specific');
    // Small one falls outside the constrained rule's window.
    expect(applyRules({ description: 'SWISH BETALNING', amount: -20000 }, rules)?.id).toBe('general');
  });

  it('compares amount bounds on magnitude, not sign', () => {
    const rules = [rule({ pattern: 'hyra', categorySlug: 'rent', minAmount: 500000 })];
    expect(applyRules({ description: 'HYRA BRF', amount: -1250000 }, rules)).not.toBeNull();
  });

  it('scopes a rule to one account', () => {
    const rules = [rule({ pattern: 'betalning', categorySlug: 'card-payment', accountId: 'acc-1' })];
    expect(applyRules({ description: 'BETALNING', amount: -1000, accountId: 'acc-1' }, rules)).not.toBeNull();
    expect(applyRules({ description: 'BETALNING', amount: -1000, accountId: 'acc-2' }, rules)).toBeNull();
  });

  it('supports regex rules', () => {
    const rules = [rule({ matchType: 'regex', pattern: '^LÖN\\s+\\w+', categorySlug: 'salary' })];
    expect(applyRules({ description: 'LÖN ACME AB', amount: 100 }, rules)).not.toBeNull();
  });

  it('ignores a malformed regex instead of throwing', () => {
    const rules = [rule({ matchType: 'regex', pattern: '([unclosed', categorySlug: 'salary' })];
    expect(() => applyRules({ description: 'anything', amount: 1 }, rules)).not.toThrow();
    expect(applyRules({ description: 'anything', amount: 1 }, rules)).toBeNull();
  });

  it('matches accent-insensitively, so an ASCII pattern finds a Swedish description', () => {
    const rules = [rule({ pattern: 'forsakring', categorySlug: 'home-insurance' })];
    expect(applyRules({ description: 'FÖRSÄKRING BETALNING', amount: -50000 }, rules)).not.toBeNull();
    // "contains" is a substring test, so a compound word matches too.
    expect(applyRules({ description: 'LÄNSFÖRSÄKRINGAR SAK', amount: -50000 }, rules)).not.toBeNull();
    // ...and an accented pattern still matches an unaccented description.
    const accented = [rule({ pattern: 'försäkring', categorySlug: 'home-insurance' })];
    expect(applyRules({ description: 'FORSAKRING BETALNING', amount: -50000 }, accented)).not.toBeNull();
  });
});

describe('reclassifyBatch', () => {
  it('never overwrites a category the user set', () => {
    const rules: RuleLike[] = [
      { id: 'r', field: 'description', matchType: 'contains', pattern: 'ica', categorySlug: 'restaurants', priority: 100 },
    ];
    const updates = reclassifyBatch(
      [
        { id: 't1', description: 'ICA KVANTUM', amount: -100, categoryLocked: false },
        { id: 't2', description: 'ICA KVANTUM', amount: -100, categoryLocked: true },
      ],
      rules,
    );
    expect(updates).toHaveLength(1);
    expect(updates[0]!.id).toBe('t1');
    expect(updates[0]!.categorySlug).toBe('restaurants');
  });
});
