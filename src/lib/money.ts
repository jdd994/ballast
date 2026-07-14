// money.ts
// Pure, IO-free money logic. No storage, no network, no React. Everything here
// is a function of its arguments, which is what makes it testable — and money
// math is the one part of this app that must never be quietly wrong.
//
// Two hard rules:
//
//   1. Currency is NEVER a float. `0.1 + 0.2 !== 0.3`, and a dashboard that is
//      off by a cent is a dashboard you stop trusting. Money is an integer count
//      of minor units (cents, pence) plus a currency code.
//
//   2. Asset quantities are NOT money. 0.5 BTC is not a number of cents; it is a
//      quantity with its own precision (8 decimals for BTC, 18 for ETH). Wei
//      overflows float64's exact-integer range entirely, so quantities are held
//      as integer strings in base units and only converted to a float at the
//      moment they meet a price — where the price itself is an estimate anyway.

export type Money = {
  minor: number; // integer count of minor units. 1234 == $12.34
  currency: string; // ISO-4217, e.g. "USD"
};

// A quantity of a non-currency asset: 0.5 BTC is { base: "50000000", decimals: 8 }.
export type Quantity = {
  base: string; // integer string in the asset's smallest unit (sats, wei)
  decimals: number;
  symbol: string; // "BTC", "ETH"
};

// The price of ONE WHOLE unit of an asset, in money. 1 BTC at $95,000 is
// { minor: 9_500_000, currency: "USD" }.
export type Price = Money;

export function money(minor: number, currency: string): Money {
  if (!Number.isInteger(minor)) {
    throw new Error(`Money must be an integer count of minor units, got ${minor}`);
  }
  return { minor, currency };
}

export const zero = (currency: string): Money => ({ minor: 0, currency });

// Adding money in different currencies is a bug, not something to paper over
// with a guessed exchange rate. Ballast holds a single base currency (chosen at
// setup) precisely so this can't happen silently. If FX lands later, it will be
// an explicit, dated, visible conversion — never an invisible one.
export function add(a: Money, b: Money): Money {
  if (a.currency !== b.currency) {
    throw new Error(`Refusing to add ${a.currency} to ${b.currency} without an explicit rate`);
  }
  return { minor: a.minor + b.minor, currency: a.currency };
}

export function subtract(a: Money, b: Money): Money {
  return add(a, negate(b));
}

export function negate(a: Money): Money {
  return { minor: -a.minor, currency: a.currency };
}

export function sum(items: Money[], currency: string): Money {
  return items.reduce(add, zero(currency));
}

export function isNegative(m: Money): boolean {
  return m.minor < 0;
}

// ---- Parsing and formatting --------------------------------------------

const MINOR_DIGITS: Record<string, number> = { JPY: 0, KRW: 0, ISK: 0 };

export function minorDigits(currency: string): number {
  return MINOR_DIGITS[currency] ?? 2;
}

// Parse human input ("1,234.56", "$1234.56", "-40") into exact minor units.
// Returns null on anything it can't read — the caller shows an honest error
// rather than silently storing a zero.
export function parseMoney(input: string, currency: string): Money | null {
  const cleaned = input.replace(/[^0-9.\-]/g, "");
  if (cleaned === "" || cleaned === "-" || cleaned === ".") return null;
  if ((cleaned.match(/\./g) ?? []).length > 1) return null;

  const negative = cleaned.startsWith("-");
  const [whole = "0", frac = ""] = cleaned.replace("-", "").split(".");
  const digits = minorDigits(currency);

  // Pad or truncate the fraction to the currency's precision. Truncating rather
  // than rounding is deliberate: if someone types more precision than the
  // currency has, inventing a rounded-up cent would be making data up.
  const fracPadded = frac.padEnd(digits, "0").slice(0, digits);
  const minorStr = (whole || "0") + fracPadded;
  const minor = Number(minorStr);
  if (!Number.isSafeInteger(minor)) return null;

  return { minor: negative ? -minor : minor, currency };
}

export function formatMoney(m: Money, opts: { compact?: boolean; sign?: boolean } = {}): string {
  const digits = minorDigits(m.currency);
  const value = m.minor / 10 ** digits;
  const formatted = new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: m.currency,
    minimumFractionDigits: opts.compact ? 0 : digits,
    maximumFractionDigits: opts.compact ? 0 : digits,
    signDisplay: opts.sign ? "exceptZero" : "auto",
  }).format(value);
  return formatted;
}

// ---- Quantities and pricing ---------------------------------------------

export function quantity(base: string, decimals: number, symbol: string): Quantity {
  return { base, decimals, symbol };
}

// Exact decimal-string rendering of a quantity — no float anywhere, so this is
// safe to show the user even for 18-decimal wei.
export function formatQuantity(q: Quantity, maxFractionDigits = 8): string {
  const negative = q.base.startsWith("-");
  const digits = (negative ? q.base.slice(1) : q.base).padStart(q.decimals + 1, "0");
  const whole = digits.slice(0, digits.length - q.decimals);
  const frac = digits.slice(digits.length - q.decimals).slice(0, maxFractionDigits).replace(/0+$/, "");
  const wholeGrouped = Number(whole).toLocaleString();
  return `${negative ? "-" : ""}${wholeGrouped}${frac ? "." + frac : ""} ${q.symbol}`;
}

// Convert a base-unit quantity to a float for pricing ONLY.
//
// This is the single sanctioned float conversion in the file. It is safe here
// because a price is itself an estimate that moves every second — a relative
// error of 1e-16 on the quantity is many orders of magnitude below the error
// already present in the price. It would NOT be safe for storage or for
// currency, which is why neither of those goes through here.
export function quantityToFloat(q: Quantity): number {
  return Number(q.base) / 10 ** q.decimals;
}

// Value a holding: quantity x price-per-whole-unit -> money, rounded to the
// nearest minor unit.
export function valueOf(q: Quantity, price: Price): Money {
  return { minor: Math.round(quantityToFloat(q) * price.minor), currency: price.currency };
}

// ---- Net worth -----------------------------------------------------------
// The spine. Net worth is what you own minus what you owe, at a point in time.

export type Valued = {
  accountId: string;
  value: Money; // already signed: liabilities are negative
};

export type NetWorth = {
  total: Money;
  assets: Money;
  liabilities: Money; // reported as a positive magnitude, for display
};

export function netWorth(valued: Valued[], currency: string): NetWorth {
  const assets = sum(
    valued.filter((v) => !isNegative(v.value)).map((v) => v.value),
    currency
  );
  const liabilities = sum(
    valued.filter((v) => isNegative(v.value)).map((v) => negate(v.value)),
    currency
  );
  return { total: subtract(assets, liabilities), assets, liabilities };
}

// ---- Goals ---------------------------------------------------------------
// One primitive, three shapes. "Save $10k", "pay this card off", and "spend
// $4,000 to hit a signup bonus" are the same question wearing different hats:
// given where I started, where I am, and how fast I'm actually moving — do I
// get there in time?
//
// Note what this deliberately does NOT do: it never recommends a product. You
// name the target; Ballast only tells you the truth about your own trajectory.

export type GoalKind = "save" | "payoff" | "spend";

export type Goal = {
  id: string;
  name: string;
  kind: GoalKind;
  target: Money; // the number you're trying to reach
  startValue: Money; // where the tracked accounts stood when the goal began
  startAt: number; // ms
  deadline?: number; // ms; optional — a goal without a deadline still shows pace
  accountIds: string[];
};

export type Progress = {
  current: Money; // distance travelled, in the goal's own terms
  target: Money;
  fraction: number; // 0..1, clamped
  done: boolean;
  // Honest projection. Undefined when there isn't enough history to say anything
  // truthful yet — in which case the UI must stay quiet rather than guess.
  perMonthObserved?: Money;
  perMonthNeeded?: Money;
  projectedAt?: number; // ms; when you arrive at the observed pace
  onPace?: boolean;
};

const MONTH_MS = 30.436875 * 24 * 60 * 60 * 1000; // mean Gregorian month

// `currentValue` is the present combined value of the goal's accounts.
export function goalProgress(goal: Goal, currentValue: Money, now: number): Progress {
  // Reduce every kind to "distance travelled from the starting line".
  //
  // Saving and paying off debt are the SAME direction, which is worth stating
  // because it looks like it shouldn't be: both mean the balance goes UP. Saving
  // walks 0 -> +3,000. Paying off a card walks -5,000 -> -3,000. Both travelled
  // +2,000-ish. Only spending walks the other way (0 -> -1,400), so only
  // spending flips the sign.
  const travelled =
    goal.kind === "spend"
      ? subtract(goal.startValue, currentValue)
      : subtract(currentValue, goal.startValue);

  const target = goal.target;
  const fraction = target.minor === 0 ? 1 : clamp(travelled.minor / target.minor, 0, 1);
  const done = travelled.minor >= target.minor;

  const p: Progress = { current: travelled, target, fraction, done };

  const elapsed = now - goal.startAt;
  // Under a day of history, or no movement at all, is not enough to project
  // from. Saying "you'll never get there" to someone on day one would be both
  // wrong and cruel.
  if (elapsed < 24 * 60 * 60 * 1000 || travelled.minor <= 0) {
    if (goal.deadline && goal.deadline > now) {
      p.perMonthNeeded = perMonth(subtract(target, travelled), goal.deadline - now);
    }
    return p;
  }

  const rate = travelled.minor / elapsed; // minor units per ms
  p.perMonthObserved = money(Math.round(rate * MONTH_MS), target.currency);

  const remaining = target.minor - travelled.minor;
  if (remaining > 0 && rate > 0) {
    p.projectedAt = now + remaining / rate;
  }

  if (goal.deadline) {
    const timeLeft = goal.deadline - now;
    if (timeLeft > 0) {
      p.perMonthNeeded = perMonth(money(remaining, target.currency), timeLeft);
    }
    p.onPace = done || (p.projectedAt !== undefined && p.projectedAt <= goal.deadline);
  }

  return p;
}

function perMonth(amount: Money, overMs: number): Money {
  if (overMs <= 0) return amount;
  return money(Math.round((amount.minor / overMs) * MONTH_MS), amount.currency);
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}
