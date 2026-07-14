// categorize.ts
// A categoriser that learns from you, and only from you.
//
// The industry approach is to ship a merchant database, or to send your
// transaction descriptions to a model in the cloud. Both mean someone else's
// idea of what "SQ *BLUE BOTTLE" is, and at least one of them means handing over
// your spending history.
//
// This does neither. It remembers the corrections YOU make, encrypted, on your
// device. You tag "TRADER JOE'S #412" as Groceries once; next month it fills
// that in for you. It gets better the more you use it, it works offline, it
// works on the first day for merchants nobody has ever heard of, and the memory
// it builds is yours — it syncs inside your vault as ciphertext and is
// meaningless to anyone else.
//
// There are a few built-in keyword HINTS below, used only when your own memory
// has nothing to say. They are a courtesy for day one, not a model. Your own
// corrections always win, and one correction overrides a hint permanently.

export type Category =
  | "groceries"
  | "dining"
  | "transport"
  | "housing"
  | "utilities"
  | "health"
  | "shopping"
  | "entertainment"
  | "travel"
  | "subscriptions"
  | "income"
  | "transfer"
  | "other";

export const CATEGORIES: Record<Category, { label: string; spend: boolean }> = {
  groceries: { label: "Groceries", spend: true },
  dining: { label: "Dining", spend: true },
  transport: { label: "Transport", spend: true },
  housing: { label: "Housing", spend: true },
  utilities: { label: "Utilities", spend: true },
  health: { label: "Health", spend: true },
  shopping: { label: "Shopping", spend: true },
  entertainment: { label: "Entertainment", spend: true },
  travel: { label: "Travel", spend: true },
  subscriptions: { label: "Subscriptions", spend: true },
  income: { label: "Income", spend: false },
  // A transfer between your own accounts is not spending. Counting it as such is
  // the classic budgeting-app lie that makes people think they spent £4,000 in a
  // month when they moved £3,500 into savings.
  transfer: { label: "Transfer", spend: false },
  other: { label: "Other", spend: true },
};

export const SPEND_CATEGORIES = (Object.keys(CATEGORIES) as Category[]).filter(
  (c) => CATEGORIES[c].spend
);

// What you learned, merchant -> category. Encrypted in the vault like everything
// else.
export type MerchantMemory = Record<string, Category>;

// Reduce a raw merchant string to a stable key.
//
// Card descriptors are noisy in specific, predictable ways: store numbers, dates,
// terminal ids, payment-processor prefixes. "SQ *BLUE BOTTLE 4412" and
// "SQ *BLUE BOTTLE #9" are the same coffee shop, and if the memory can't see
// that, it never learns anything.
export function normalizeMerchant(raw: string): string {
  return raw
    .toUpperCase()
    // Payment-processor prefixes: SQ*, TST*, PP*, SP*, PAYPAL *, POS, VISA...
    .replace(/^(SQ|TST|PP|SP|PY|IN|WWW)\s*\*+\s*/g, "")
    .replace(/^(PAYPAL|POS|VISA|MASTERCARD|DEBIT|CREDIT|PURCHASE|PMT|PAYMENT)\s+/g, "")
    // Store/terminal numbers and dates.
    .replace(/#\s*\d+/g, " ")
    .replace(/\b\d{1,2}[\/-]\d{1,2}([\/-]\d{2,4})?\b/g, " ")
    .replace(/\b\d{3,}\b/g, " ")
    // Trailing location noise is common but load-bearing rarely; keep letters.
    .replace(/[^A-Z\s&']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Day-one courtesy only. Your own memory always beats these.
const HINTS: Array<[RegExp, Category]> = [
  [/\b(UBER|LYFT|TAXI|TRANSIT|METRO|SUBWAY MTA|BART|SHELL|CHEVRON|BP|EXXON|GAS)\b/, "transport"],
  [/\b(NETFLIX|SPOTIFY|HULU|DISNEY|PATREON|ICLOUD|DROPBOX|ADOBE|GITHUB)\b/, "subscriptions"],
  [/\b(TRADER JOE|WHOLE FOODS|SAFEWAY|KROGER|ALDI|LIDL|TESCO|SAINSBURY|COSTCO|GROCER)\b/, "groceries"],
  [/\b(STARBUCKS|COFFEE|CAFE|RESTAURANT|PIZZA|CHIPOTLE|MCDONALD|DOORDASH|GRUBHUB|UBER EATS)\b/, "dining"],
  [/\b(AMAZON|TARGET|WALMART|EBAY|ETSY|IKEA)\b/, "shopping"],
  [/\b(RENT|MORTGAGE|LANDLORD|HOA)\b/, "housing"],
  [/\b(ELECTRIC|WATER|COMCAST|VERIZON|AT&T|T-MOBILE|INTERNET|UTILITY)\b/, "utilities"],
  [/\b(PHARMACY|CVS|WALGREENS|DENTAL|DOCTOR|CLINIC|MEDICAL)\b/, "health"],
  [/\b(AIRLINE|AIRLINES|HOTEL|AIRBNB|EXPEDIA|DELTA|UNITED|BOOKING)\b/, "travel"],
  [/\b(CINEMA|THEATER|THEATRE|STEAM|PLAYSTATION|XBOX|CONCERT)\b/, "entertainment"],
  [/\b(PAYROLL|SALARY|DIRECT DEP|DEPOSIT)\b/, "income"],
  [/\b(TRANSFER|XFER|ZELLE|VENMO)\b/, "transfer"],
];

export type Suggestion = {
  category: Category;
  // Where it came from, so the UI can be honest about how confident it is.
  // "learned" means YOU taught it this. "hint" is a built-in guess.
  from: "learned" | "hint";
};

export function suggestCategory(merchant: string, memory: MerchantMemory): Suggestion | null {
  const key = normalizeMerchant(merchant);
  if (!key) return null;

  // 1. Exactly this merchant, learned from you.
  const learned = memory[key];
  if (learned) return { category: learned, from: "learned" };

  // 2. A merchant you've taught us that this one contains (or vice versa) —
  //    catches "BLUE BOTTLE" vs "BLUE BOTTLE COFFEE OAKLAND".
  for (const [known, category] of Object.entries(memory)) {
    if (known.length >= 4 && (key.includes(known) || known.includes(key))) {
      return { category, from: "learned" };
    }
  }

  // 3. A built-in hint, clearly marked as a guess.
  for (const [pattern, category] of HINTS) {
    if (pattern.test(key)) return { category, from: "hint" };
  }

  return null;
}

// Teach it. Called every time the user confirms or corrects a category — so
// confirming a hint promotes it to something learned, and it stops being a guess.
export function remember(
  merchant: string,
  category: Category,
  memory: MerchantMemory
): MerchantMemory {
  const key = normalizeMerchant(merchant);
  if (!key) return memory;
  return { ...memory, [key]: category };
}
