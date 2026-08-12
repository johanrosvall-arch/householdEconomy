/**
 * The default category taxonomy, tuned for a Swedish household.
 *
 * Two levels: a small set of stable groups, each with concrete categories.
 * Groups are what the overview screen charts; categories are what a single
 * transaction gets tagged with and what a budget line targets.
 *
 * `slug` is the stable identifier — it is seeded into the database and
 * referenced by categorisation rules, so renaming a `name` is safe but
 * changing a `slug` is a migration.
 */

export type CategoryKind = 'expense' | 'income' | 'transfer';

export interface CategoryGroupDef {
  slug: string;
  name: string;
  nameSv: string;
  kind: CategoryKind;
  /** Hex colour used by charts. Chosen to stay distinguishable in both themes. */
  color: string;
  icon: string;
  categories: CategoryDef[];
}

export interface CategoryDef {
  slug: string;
  name: string;
  nameSv: string;
  /** Categories a household is expected to spend on every month. Drives the
   *  "fixed vs variable" split on the overview and budget suggestions. */
  fixed?: boolean;
}

export const CATEGORY_GROUPS: readonly CategoryGroupDef[] = [
  {
    slug: 'housing',
    name: 'Housing',
    nameSv: 'Boende',
    kind: 'expense',
    color: '#4C6EF5',
    icon: 'home',
    categories: [
      { slug: 'rent', name: 'Rent', nameSv: 'Hyra', fixed: true },
      { slug: 'mortgage', name: 'Mortgage', nameSv: 'Bolån', fixed: true },
      { slug: 'mortgage-amortisation', name: 'Amortisation', nameSv: 'Amortering', fixed: true },
      { slug: 'housing-fee', name: 'Housing association fee', nameSv: 'Avgift bostadsrätt', fixed: true },
      { slug: 'electricity', name: 'Electricity', nameSv: 'El', fixed: true },
      { slug: 'heating-water', name: 'Heating & water', nameSv: 'Värme & vatten', fixed: true },
      { slug: 'home-insurance', name: 'Home insurance', nameSv: 'Hemförsäkring', fixed: true },
      { slug: 'home-maintenance', name: 'Maintenance & repairs', nameSv: 'Underhåll & reparation' },
      { slug: 'home-furnishing', name: 'Furnishing', nameSv: 'Möbler & inredning' },
    ],
  },
  {
    slug: 'food',
    name: 'Food',
    nameSv: 'Mat',
    kind: 'expense',
    color: '#37B24D',
    icon: 'shopping-cart',
    categories: [
      { slug: 'groceries', name: 'Groceries', nameSv: 'Livsmedel' },
      { slug: 'restaurants', name: 'Restaurants & cafés', nameSv: 'Restaurang & café' },
      { slug: 'takeaway', name: 'Takeaway & delivery', nameSv: 'Hämtmat & leverans' },
      { slug: 'work-lunch', name: 'Lunch', nameSv: 'Lunch' },
    ],
  },
  {
    slug: 'transport',
    name: 'Transport',
    nameSv: 'Transport',
    kind: 'expense',
    color: '#F76707',
    icon: 'car',
    categories: [
      { slug: 'public-transport', name: 'Public transport', nameSv: 'Kollektivtrafik', fixed: true },
      { slug: 'fuel', name: 'Fuel & charging', nameSv: 'Drivmedel & laddning' },
      { slug: 'car-loan', name: 'Car loan / lease', nameSv: 'Billån & leasing', fixed: true },
      { slug: 'car-insurance-tax', name: 'Car insurance & tax', nameSv: 'Bilförsäkring & skatt', fixed: true },
      { slug: 'car-service', name: 'Service & repairs', nameSv: 'Service & reparation' },
      { slug: 'parking-tolls', name: 'Parking & congestion tax', nameSv: 'Parkering & trängselskatt' },
      { slug: 'taxi-rideshare', name: 'Taxi & rideshare', nameSv: 'Taxi' },
    ],
  },
  {
    slug: 'household',
    name: 'Household',
    nameSv: 'Hushåll',
    kind: 'expense',
    color: '#0CA678',
    icon: 'package',
    categories: [
      { slug: 'pharmacy', name: 'Pharmacy', nameSv: 'Apotek' },
      { slug: 'healthcare', name: 'Healthcare & dental', nameSv: 'Vård & tandvård' },
      { slug: 'personal-care', name: 'Personal care', nameSv: 'Personlig vård' },
      { slug: 'clothing', name: 'Clothing & shoes', nameSv: 'Kläder & skor' },
      { slug: 'pets', name: 'Pets', nameSv: 'Husdjur' },
      { slug: 'household-supplies', name: 'Household supplies', nameSv: 'Hushållsartiklar' },
    ],
  },
  {
    slug: 'children',
    name: 'Children',
    nameSv: 'Barn',
    kind: 'expense',
    color: '#F06595',
    icon: 'users',
    categories: [
      { slug: 'childcare', name: 'Childcare (förskola)', nameSv: 'Förskola & fritids', fixed: true },
      { slug: 'child-activities', name: 'Activities & clubs', nameSv: 'Aktiviteter & föreningar' },
      { slug: 'child-supplies', name: 'Clothes & supplies', nameSv: 'Barnkläder & utrustning' },
      { slug: 'allowance', name: 'Allowance', nameSv: 'Veckopeng' },
    ],
  },
  {
    slug: 'leisure',
    name: 'Leisure',
    nameSv: 'Fritid',
    kind: 'expense',
    color: '#AE3EC9',
    icon: 'music',
    categories: [
      { slug: 'subscriptions', name: 'Streaming & subscriptions', nameSv: 'Streaming & abonnemang', fixed: true },
      { slug: 'gym-sports', name: 'Gym & sports', nameSv: 'Gym & sport', fixed: true },
      { slug: 'hobbies', name: 'Hobbies', nameSv: 'Hobby' },
      { slug: 'travel', name: 'Travel & holidays', nameSv: 'Resor & semester' },
      { slug: 'entertainment', name: 'Entertainment & events', nameSv: 'Nöje & evenemang' },
      { slug: 'books-media', name: 'Books & media', nameSv: 'Böcker & media' },
      { slug: 'alcohol-tobacco', name: 'Alcohol & tobacco', nameSv: 'Alkohol & tobak' },
    ],
  },
  {
    slug: 'digital',
    name: 'Phone & internet',
    nameSv: 'Telefoni & internet',
    kind: 'expense',
    color: '#1098AD',
    icon: 'wifi',
    categories: [
      { slug: 'mobile', name: 'Mobile', nameSv: 'Mobiltelefoni', fixed: true },
      { slug: 'broadband', name: 'Broadband & TV', nameSv: 'Bredband & TV', fixed: true },
      { slug: 'electronics', name: 'Electronics', nameSv: 'Elektronik' },
      { slug: 'software', name: 'Apps & software', nameSv: 'Appar & mjukvara' },
    ],
  },
  {
    slug: 'financial',
    name: 'Financial',
    nameSv: 'Ekonomi',
    kind: 'expense',
    color: '#868E96',
    icon: 'briefcase',
    categories: [
      { slug: 'bank-fees', name: 'Bank & card fees', nameSv: 'Bankavgifter' },
      { slug: 'interest', name: 'Interest paid', nameSv: 'Räntekostnad', fixed: true },
      { slug: 'loan-repayment', name: 'Loan repayment', nameSv: 'Låneåterbetalning', fixed: true },
      { slug: 'insurance-other', name: 'Other insurance', nameSv: 'Övriga försäkringar', fixed: true },
      { slug: 'tax', name: 'Tax', nameSv: 'Skatt' },
      { slug: 'charity', name: 'Charity & gifts', nameSv: 'Gåvor & välgörenhet' },
      { slug: 'union-fees', name: 'Union & a-kassa', nameSv: 'Fack & a-kassa', fixed: true },
    ],
  },
  {
    slug: 'income',
    name: 'Income',
    nameSv: 'Inkomst',
    kind: 'income',
    color: '#2F9E44',
    icon: 'trending-up',
    categories: [
      { slug: 'salary', name: 'Salary', nameSv: 'Lön' },
      { slug: 'benefits', name: 'Benefits (Försäkringskassan)', nameSv: 'Bidrag & ersättning' },
      { slug: 'child-benefit', name: 'Child allowance', nameSv: 'Barnbidrag' },
      { slug: 'pension', name: 'Pension', nameSv: 'Pension' },
      { slug: 'investment-income', name: 'Interest & dividends', nameSv: 'Ränta & utdelning' },
      { slug: 'refund', name: 'Refunds', nameSv: 'Återbetalning' },
      { slug: 'other-income', name: 'Other income', nameSv: 'Övrig inkomst' },
    ],
  },
  {
    slug: 'savings',
    name: 'Savings & investments',
    nameSv: 'Sparande',
    kind: 'transfer',
    color: '#3BC9DB',
    icon: 'piggy-bank',
    categories: [
      { slug: 'savings-transfer', name: 'To savings', nameSv: 'Till sparkonto' },
      { slug: 'investment', name: 'Investments (ISK/KF)', nameSv: 'Investeringar' },
      { slug: 'pension-saving', name: 'Private pension saving', nameSv: 'Privat pensionssparande' },
    ],
  },
  {
    slug: 'transfers',
    name: 'Transfers',
    nameSv: 'Överföringar',
    kind: 'transfer',
    color: '#ADB5BD',
    icon: 'repeat',
    categories: [
      { slug: 'internal-transfer', name: 'Between own accounts', nameSv: 'Mellan egna konton' },
      { slug: 'card-payment', name: 'Credit card payment', nameSv: 'Kortbetalning' },
      { slug: 'person-transfer', name: 'To / from a person', nameSv: 'Till & från person' },
      { slug: 'cash', name: 'Cash withdrawal', nameSv: 'Kontantuttag' },
    ],
  },
  {
    slug: 'other',
    name: 'Other',
    nameSv: 'Övrigt',
    kind: 'expense',
    color: '#CED4DA',
    icon: 'help-circle',
    categories: [{ slug: 'uncategorised', name: 'Uncategorised', nameSv: 'Okategoriserat' }],
  },
];

/** The category every transaction lands in until something classifies it. */
export const UNCATEGORISED_SLUG = 'uncategorised';

export interface FlatCategory extends CategoryDef {
  groupSlug: string;
  groupName: string;
  kind: CategoryKind;
  color: string;
}

let flatCache: FlatCategory[] | null = null;

export function allCategories(): FlatCategory[] {
  if (!flatCache) {
    flatCache = CATEGORY_GROUPS.flatMap((group) =>
      group.categories.map((c) => ({
        ...c,
        groupSlug: group.slug,
        groupName: group.name,
        kind: group.kind,
        color: group.color,
      })),
    );
  }
  return flatCache;
}

const bySlug = new Map<string, FlatCategory>();

export function findCategory(slug: string): FlatCategory | undefined {
  if (bySlug.size === 0) {
    for (const c of allCategories()) bySlug.set(c.slug, c);
  }
  return bySlug.get(slug);
}

export function groupFor(categorySlug: string): CategoryGroupDef | undefined {
  const cat = findCategory(categorySlug);
  if (!cat) return undefined;
  return CATEGORY_GROUPS.find((g) => g.slug === cat.groupSlug);
}

/**
 * Transfers and savings moves are real transactions but they are not spending —
 * counting them would double-count money that never left the household. Every
 * spend total in the app filters on this.
 */
export function isSpendingCategory(categorySlug: string): boolean {
  const cat = findCategory(categorySlug);
  return cat?.kind === 'expense';
}
