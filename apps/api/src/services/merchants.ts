/**
 * Built-in merchant dictionary for the Swedish market.
 *
 * This is the fallback layer of categorisation: it runs after the household's
 * own rules and before the generic heuristics. Patterns are matched against a
 * normalised (lowercased, noise-stripped) description, most specific first —
 * `willys hemma` must be tested before `hemköp`-style shorter tokens, and
 * `apotek hjärtat` before a bare `apotek`.
 *
 * `merchant` is the display name shown in the app; `category` is a slug from
 * the shared taxonomy.
 */

export interface MerchantRule {
  match: RegExp;
  merchant: string;
  category: string;
}

/**
 * Patterns are written ASCII-folded (`kop`, not `köp`) because
 * `normaliseDescription` strips diacritics before matching.
 *
 * This is not cosmetic. JavaScript's `\b` is defined over `[A-Za-z0-9_]`, so
 * `/\böverföring\b/` can never match — there is no word boundary before `ö`.
 * Folding both sides keeps every pattern inside the ASCII range where `\b`
 * behaves, and makes matching accent-insensitive for free, which matters when
 * bank exports disagree about whether to send `FORSAKRING` or `FÖRSÄKRING`.
 */
export const MERCHANT_RULES: readonly MerchantRule[] = [
  // --- Groceries ---------------------------------------------------------
  { match: /\bwillys\b/i, merchant: 'Willys', category: 'groceries' },
  { match: /\b(ica|maxi ica|ica kvantum|ica supermarket|ica nara)\b/i, merchant: 'ICA', category: 'groceries' },
  { match: /\b(coop|stora coop)\b/i, merchant: 'Coop', category: 'groceries' },
  { match: /\bhem ?kop\b|\bhemkop\b/i, merchant: 'Hemköp', category: 'groceries' },
  { match: /\blidl\b/i, merchant: 'Lidl', category: 'groceries' },
  { match: /\bcity ?gross\b/i, merchant: 'City Gross', category: 'groceries' },
  { match: /\b(mathem|matsmart|linas matkasse|hellofresh)\b/i, merchant: 'Matkasse', category: 'groceries' },
  { match: /\b(tempo|narlivs|pressbyran|7-eleven)\b/i, merchant: 'Närbutik', category: 'groceries' },

  // --- Alcohol -----------------------------------------------------------
  { match: /\bsystembolaget\b/i, merchant: 'Systembolaget', category: 'alcohol-tobacco' },

  // --- Restaurants & takeaway -------------------------------------------
  { match: /\b(foodora|uber ?eats|wolt)\b/i, merchant: 'Matleverans', category: 'takeaway' },
  { match: /\b(mcdonalds|mc donalds|burger king|max burgers|maxburgare|sibylla|subway|taco bar)\b/i, merchant: 'Snabbmat', category: 'restaurants' },
  { match: /\b(espresso house|waynes coffee|barista|starbucks|condeco|fika)\b/i, merchant: 'Café', category: 'restaurants' },
  { match: /\b(o'?learys|vapiano|pizzeria|restaurang|restaurant|sushi|bistro|brasseri|krog)\b/i, merchant: 'Restaurang', category: 'restaurants' },

  // --- Pharmacy & health -------------------------------------------------
  { match: /\bapotek ?hjartat\b/i, merchant: 'Apotek Hjärtat', category: 'pharmacy' },
  { match: /\bkronans? apotek\b/i, merchant: 'Kronans Apotek', category: 'pharmacy' },
  { match: /\b(apoteket|apotea|lloyds ?apotek|apotek)\b/i, merchant: 'Apotek', category: 'pharmacy' },
  { match: /\b(folktandvarden|tandlakare|tandvard)\b/i, merchant: 'Tandvård', category: 'healthcare' },
  { match: /\b(vardcentral|1177|capio|aleris|praktikertjanst|kry|min doktor)\b/i, merchant: 'Vård', category: 'healthcare' },

  // --- Transport ---------------------------------------------------------
  { match: /\b(sl |storstockholms|vasttrafik|skanetrafiken|ul |lanstrafiken|jonkopings lanstrafik)\b/i, merchant: 'Kollektivtrafik', category: 'public-transport' },
  { match: /\b(sj ab|sj resor|\bsj\b|mtr ?express|snalltaget|flixbus|vy tag)\b/i, merchant: 'Tåg', category: 'public-transport' },
  { match: /\b(circle ?k|okq8|preem|ingo|st1|shell|tanka)\b/i, merchant: 'Drivmedel', category: 'fuel' },
  { match: /\b(tesla supercharger|recharge|vattenfall inc?harge|mer sverige|laddning)\b/i, merchant: 'Laddning', category: 'fuel' },
  { match: /\b(easypark|parkster|aimo ?park|q-?park|apcoa|parkering)\b/i, merchant: 'Parkering', category: 'parking-tolls' },
  { match: /\b(trangselskatt|infrastrukturavgift|transportstyrelsen)\b/i, merchant: 'Trängselskatt', category: 'parking-tolls' },
  { match: /\b(uber|bolt\.eu|taxi ?stockholm|cabonline|taxi ?kurir|sverigetaxi)\b/i, merchant: 'Taxi', category: 'taxi-rideshare' },

  // --- Subscriptions & media --------------------------------------------
  { match: /\bnetflix\b/i, merchant: 'Netflix', category: 'subscriptions' },
  { match: /\bspotify\b/i, merchant: 'Spotify', category: 'subscriptions' },
  { match: /\b(hbo|max\.com|discovery\+)\b/i, merchant: 'HBO Max', category: 'subscriptions' },
  { match: /\b(viaplay|tv4 ?play|c ?more|sf ?anytime|disney\+?|prime ?video)\b/i, merchant: 'Streaming', category: 'subscriptions' },
  { match: /\b(storytel|nextory|audible|bookbeat)\b/i, merchant: 'Ljudböcker', category: 'subscriptions' },
  { match: /\b(apple\.com\/bill|itunes|google ?\*|google ?play|microsoft|adobe|dropbox|openai|anthropic)\b/i, merchant: 'Digitala tjänster', category: 'software' },

  // --- Gym & sport -------------------------------------------------------
  { match: /\b(sats|nordic ?wellness|friskis|actic|fitness ?24 ?seven|puls ?& ?traning|world class)\b/i, merchant: 'Gym', category: 'gym-sports' },

  // --- Telecom & internet ------------------------------------------------
  { match: /\b(telia|telenor|tele2|comviq|halebop|hallon|vimla|fello|tre ab|hi3g)\b/i, merchant: 'Mobiloperatör', category: 'mobile' },
  { match: /\b(bahnhof|bredbandsbolaget|ownit|com ?hem|boxer|tele ?2 bredband)\b/i, merchant: 'Bredband', category: 'broadband' },

  // --- Utilities ---------------------------------------------------------
  { match: /\b(vattenfall|e\.?on|fortum|ellevio|goteborg energi|tibber|greenely|cheap energy|skelleftea kraft|jamtkraft|bixia|kraftringen)\b/i, merchant: 'Elbolag', category: 'electricity' },
  { match: /\b(stockholm vatten|kommunalforbund|renhallning|sophamtning|fjarrvarme)\b/i, merchant: 'Värme & vatten', category: 'heating-water' },

  // --- Retail ------------------------------------------------------------
  { match: /\b(h ?& ?m|hm\.com|zara|lindex|kappahl|gina ?tricot|ahlens|nelly|zalando|boozt|monki|weekday|cos )\b/i, merchant: 'Kläder', category: 'clothing' },
  { match: /\b(stadium|intersport|xxl|sportamore|team ?sportia)\b/i, merchant: 'Sport', category: 'clothing' },
  { match: /\bikea\b/i, merchant: 'IKEA', category: 'home-furnishing' },
  { match: /\b(jysk|mio |em ?home|rusta|clas ?ohlson|granit|lagerhaus)\b/i, merchant: 'Heminredning', category: 'home-furnishing' },
  { match: /\b(bauhaus|byggmax|hornbach|k-?rauta|beijer|optimera|jula|biltema)\b/i, merchant: 'Bygghandel', category: 'home-maintenance' },
  { match: /\b(plantagen|blomsterlandet|granngarden)\b/i, merchant: 'Trädgård', category: 'home-maintenance' },
  { match: /\b(elgiganten|media ?markt|netonnet|webhallen|kjell ?& ?company|kjell ?och ?company|inet|komplett|power\.se)\b/i, merchant: 'Elektronik', category: 'electronics' },
  { match: /\b(adlibris|bokus|akademibokhandeln|pocketshop|science ?fiction ?bokhandeln)\b/i, merchant: 'Bokhandel', category: 'books-media' },
  { match: /\b(kicks|lyko|normal|the body shop|parfym)\b/i, merchant: 'Skönhet', category: 'personal-care' },
  { match: /\b(frisor|barberare|salong)\b/i, merchant: 'Frisör', category: 'personal-care' },

  // --- Pets --------------------------------------------------------------
  { match: /\b(arken ?zoo|zooplus|djurmagazinet|vetzoo|musti)\b/i, merchant: 'Djuraffär', category: 'pets' },
  { match: /\b(anicura|evidensia|djursjukhus|veterinar|agria)\b/i, merchant: 'Veterinär', category: 'pets' },

  // --- Travel & leisure --------------------------------------------------
  { match: /\b(sas |scandinavian airlines|norwegian|ryanair|lufthansa|klm|finnair)\b/i, merchant: 'Flyg', category: 'travel' },
  { match: /\b(booking\.com|airbnb|hotels\.com|expedia|scandic|elite hotel|first hotel|nordic choice|strawberry)\b/i, merchant: 'Boende resa', category: 'travel' },
  { match: /\b(ving|tui|apollo|resia|stena ?line|viking ?line|tallink|destination ?gotland)\b/i, merchant: 'Resebolag', category: 'travel' },
  { match: /\b(filmstaden|sf ?bio|ticketmaster|live ?nation|axs|tickster|nojesfabriken|liseberg|grona lund|kolmarden)\b/i, merchant: 'Nöje', category: 'entertainment' },

  // --- Insurance ---------------------------------------------------------
  { match: /\b(folksam|trygg-?hansa|if skadeforsakring|moderna forsakringar|dina forsakringar|hedvig|ica forsakring|lansforsakringar sak)\b/i, merchant: 'Försäkring', category: 'home-insurance' },

  // --- Union & professional ---------------------------------------------
  { match: /\b(unionen|kommunal|if ?metall|vision|akavia|sveriges ingenjorer|saco|st forbundet|a-?kassa|akademikernas)\b/i, merchant: 'Fack & a-kassa', category: 'union-fees' },

  // --- Childcare ---------------------------------------------------------
  { match: /\b(forskola|fritids|barnomsorg|dagis|maxtaxa)\b/i, merchant: 'Barnomsorg', category: 'childcare' },

  // --- Income ------------------------------------------------------------
  { match: /\b(lon|lon |salary|utbetalning lon|loneutbetalning)\b/i, merchant: 'Lön', category: 'salary' },
  { match: /\bbarnbidrag\b|\bflerbarnstillagg\b/i, merchant: 'Barnbidrag', category: 'child-benefit' },
  { match: /\b(forsakringskassan|foraldrapenning|sjukpenning|bostadsbidrag)\b/i, merchant: 'Försäkringskassan', category: 'benefits' },
  { match: /\b(pensionsmyndigheten|alecta|amf pension|pension utbetalning)\b/i, merchant: 'Pension', category: 'pension' },
  { match: /\b(skatteverket|skatteaterbaring)\b/i, merchant: 'Skatteverket', category: 'tax' },
  { match: /\bcsn\b/i, merchant: 'CSN', category: 'benefits' },

  // --- Financial ---------------------------------------------------------
  { match: /\bklarna\b/i, merchant: 'Klarna', category: 'card-payment' },
  { match: /\b(qliro|walley|afterpay|resurs ?bank)\b/i, merchant: 'Delbetalning', category: 'card-payment' },
  { match: /\b(american express|amex)\b/i, merchant: 'American Express', category: 'card-payment' },
  { match: /\b(arsavgift|aviavgift|kortavgift|bankavgift|expeditionsavgift|paminnelseavgift)\b/i, merchant: 'Bankavgift', category: 'bank-fees' },
  { match: /\b(ranta|rantekostnad)\b/i, merchant: 'Ränta', category: 'interest' },
  { match: /\bamortering\b/i, merchant: 'Amortering', category: 'mortgage-amortisation' },
  { match: /\b(avanza|nordnet|fondkonto|isk |kapitalforsakring|aktieinvest)\b/i, merchant: 'Investering', category: 'investment' },

  // --- Housing -----------------------------------------------------------
  { match: /\b(hyra|hyresavi|bostadsrattsforening|brf |hsb |riksbyggen|heimstaden|willhem|akelius|stena fastigheter)\b/i, merchant: 'Boende', category: 'rent' },

  // --- Transfers & cash --------------------------------------------------
  { match: /\b(uttag|bankomat|kontantuttag|atm)\b/i, merchant: 'Kontantuttag', category: 'cash' },
  { match: /\bswish\b/i, merchant: 'Swish', category: 'person-transfer' },
  { match: /\b(overforing|egen overforing|internoverforing)\b/i, merchant: 'Överföring', category: 'internal-transfer' },
];

/**
 * Card-terminal noise that carries no signal about what was bought:
 * card masks, terminal ids, dates baked into the description, city suffixes.
 * Stripped before merchant matching so `ICA NARA 12345 STOCKHOLM 240517`
 * and `ICA NARA` collapse to the same merchant.
 */
const NOISE_PATTERNS: readonly RegExp[] = [
  /\bkort(nr)?[\s.:]*\d{4,}\b/gi,
  /\b\d{4}[\s*x]{2,}\d{4}\b/gi, // masked card numbers
  /\*{2,}\d{2,}/g,
  /\b\d{2}[-/.]\d{2}([-/.]\d{2,4})?\b/g, // embedded dates
  /\b\d{6,}\b/g, // long reference numbers
  /\bref(erens)?[\s.:]*\S+/gi,
  /\bkl[\s.:]*\d{1,2}[:.]\d{2}\b/gi,
  /\b(betalning|kortköp|kortkop|inköp|inkop|debitering)\b/gi,
];

/**
 * Lowercase and strip terminal noise, keeping Swedish characters intact.
 * This is the form used for anything a user will read.
 */
export function cleanDescription(raw: string): string {
  let s = String(raw ?? '').toLowerCase();
  for (const pattern of NOISE_PATTERNS) {
    s = s.replace(pattern, ' ');
  }
  return s
    .replace(/[^\p{L}\p{N}\s&'.+-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * `cleanDescription` plus ASCII folding \u2014 the form used for *matching*.
 *
 * Folding `\u00e5 \u00e4 \u00f6 \u00e9` to `a a o e` is what lets every pattern in this file stay
 * ASCII, which in turn is what makes `\b` work (see MERCHANT_RULES above). It
 * also means a household rule typed as "forsakring" matches a statement line
 * spelled "F\u00d6RS\u00c4KRING", which is the behaviour users expect.
 *
 * Display names are derived from `cleanDescription` instead, so the app never
 * shows a user "Okand Butik" when the bank said "Ok\u00e4nd Butik".
 */
export function normaliseDescription(raw: string): string {
  return cleanDescription(raw)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

export interface MerchantMatch {
  merchant: string;
  category: string;
}

export function matchMerchant(description: string): MerchantMatch | null {
  const normalised = normaliseDescription(description);
  if (!normalised) return null;
  for (const rule of MERCHANT_RULES) {
    if (rule.match.test(normalised)) {
      return { merchant: rule.merchant, category: rule.category };
    }
  }
  return null;
}

/**
 * Best-effort display name when no dictionary entry matched: the leading
 * words of the cleaned description, title-cased. Better than showing the
 * user a raw terminal string, and it gives "apply to similar" something to
 * group on.
 */
export function guessMerchantName(description: string): string | null {
  const normalised = cleanDescription(description);
  if (!normalised) return null;
  const words = normalised.split(' ').filter((w) => w.length > 1 && !/^\d+$/.test(w));
  if (words.length === 0) return null;
  return words
    .slice(0, 3)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
