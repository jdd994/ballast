// spend.ts
// Pure spending logic. Where the money went, and how that compares to your own
// normal — never to anyone else's.
//
// The discipline here is entirely about what we DON'T compute. There is no
// "you're in the top 20% of spenders on dining" (a comparison, and a judgement).
// There is no "you should switch to X" (an advertisement). There is no budget you
// failed to hit and a red bar to make you feel it.
//
// What there is: what you spent, on what, and whether that's unusual FOR YOU.
// That's the fact. What to do about it is the user's business, and they are
// better placed to decide than we are.

import { add, isNegative, negate, zero, type Money } from "./money";
import { CATEGORIES, type Category } from "./categorize";

export type TransactionContent = {
  // Negative = money left. Positive = money arrived. Signed, so totals are a
  // plain sum and nothing downstream has to remember a convention.
  amount: Money;
  merchant: string;
  category: Category;
  note?: string;
  receiptId?: string; // -> the encrypted image in the media store
  accountId?: string;
};

export type Transaction = TransactionContent & {
  id: string;
  at: number;
};

// Only outgoing money in a spending category counts as spend. A transfer to your
// own savings is not spending, and an app that says otherwise is lying to you
// about your own life — it's the single most common way budgeting tools make
// people feel out of control when they aren't.
export function isSpend(t: Transaction): boolean {
  return isNegative(t.amount) && CATEGORIES[t.category].spend;
}

export function inWindow(t: Transaction, from: number, to: number): boolean {
  return t.at >= from && t.at < to;
}

export function spentIn(transactions: Transaction[], from: number, to: number, currency: string): Money {
  return transactions
    .filter((t) => isSpend(t) && inWindow(t, from, to))
    .reduce<Money>((acc, t) => add(acc, negate(t.amount)), zero(currency));
}

export function earnedIn(transactions: Transaction[], from: number, to: number, currency: string): Money {
  return transactions
    .filter((t) => !isNegative(t.amount) && t.category === "income" && inWindow(t, from, to))
    .reduce<Money>((acc, t) => add(acc, t.amount), zero(currency));
}

export type CategoryTotal = {
  category: Category;
  total: Money; // positive magnitude
  count: number;
  share: number; // 0..1 of total spend in the window
};

export function byCategory(
  transactions: Transaction[],
  from: number,
  to: number,
  currency: string
): CategoryTotal[] {
  const totals = new Map<Category, { minor: number; count: number }>();
  for (const t of transactions) {
    if (!isSpend(t) || !inWindow(t, from, to)) continue;
    const cur = totals.get(t.category) ?? { minor: 0, count: 0 };
    totals.set(t.category, { minor: cur.minor + Math.abs(t.amount.minor), count: cur.count + 1 });
  }
  const grand = [...totals.values()].reduce((a, b) => a + b.minor, 0);
  return [...totals.entries()]
    .map(([category, { minor, count }]) => ({
      category,
      total: { minor, currency },
      count,
      share: grand === 0 ? 0 : minor / grand,
    }))
    .sort((a, b) => b.total.minor - a.total.minor);
}

// ---- windows -------------------------------------------------------------

export type Window = { from: number; to: number; label: string };

export function monthWindow(now: number, offset = 0): Window {
  const d = new Date(now);
  const from = new Date(d.getFullYear(), d.getMonth() + offset, 1).getTime();
  const to = new Date(d.getFullYear(), d.getMonth() + offset + 1, 1).getTime();
  const label = new Date(from).toLocaleDateString(undefined, { month: "long", year: "numeric" });
  return { from, to, label };
}

// ---- noticing ------------------------------------------------------------
// The honest, non-judgemental version of an "insight".

export type Notice = {
  category: Category;
  this: Money;
  usual: Money;
  ratio: number; // 2.0 = double your normal
};

// Categories where this window is markedly different from YOUR OWN recent normal.
//
// It reports both directions. An app that only ever tells you when you overspent
// is a nagging app; telling someone their dining spend halved is the same fact,
// and it is the one that makes them feel capable.
//
// `months` is how much history to average over. With less than two prior months
// of data there is no "usual" yet, so this returns nothing rather than
// manufacturing a baseline from a single data point.
export function notable(
  transactions: Transaction[],
  now: number,
  currency: string,
  opts: { months?: number; threshold?: number; minMinor?: number } = {}
): Notice[] {
  const months = opts.months ?? 3;
  const threshold = opts.threshold ?? 1.5;
  const minMinor = opts.minMinor ?? 2000; // ignore noise under ~$20

  const current = monthWindow(now);
  const priors: Window[] = [];
  for (let i = 1; i <= months; i++) priors.push(monthWindow(now, -i));

  // Only count prior months that actually contain data — a month you weren't
  // using the app is not a month you spent nothing.
  const active = priors.filter((w) =>
    transactions.some((t) => isSpend(t) && inWindow(t, w.from, w.to))
  );
  if (active.length < 2) return [];

  const out: Notice[] = [];
  for (const { category, total } of byCategory(transactions, current.from, current.to, currency)) {
    const sum = active.reduce((acc, w) => {
      const hit = byCategory(transactions, w.from, w.to, currency).find(
        (c) => c.category === category
      );
      // A month with no spend in this category contributes zero, not NaN. (The
      // parens matter: `acc + x ?? 0` parses as `(acc + x) ?? 0`, which happily
      // propagates NaN forever.)
      return acc + (hit?.total.minor ?? 0);
    }, 0);
    const usual = Math.round(sum / active.length);
    if (usual === 0 || total.minor < minMinor) continue;

    const ratio = total.minor / usual;
    if (ratio >= threshold || ratio <= 1 / threshold) {
      out.push({
        category,
        this: total,
        usual: { minor: usual, currency },
        ratio,
      });
    }
  }
  return out.sort((a, b) => Math.abs(Math.log(b.ratio)) - Math.abs(Math.log(a.ratio)));
}

// Recurring charges — the thing people genuinely forget and genuinely want to
// know. Same merchant, roughly the same amount, in most of the recent months.
//
// This is the honest half of "suggest alternatives": telling you that you're
// paying for three streaming services is a true fact about your own money.
// Telling you which one to cancel would be us deciding what you value, and
// telling you what to buy instead would be an advertisement.
export type Recurring = {
  merchant: string;
  category: Category;
  amount: Money; // typical, positive magnitude
  months: number; // how many of the last N it appeared in
};

export function recurring(
  transactions: Transaction[],
  now: number,
  currency: string,
  lookback = 3
): Recurring[] {
  const windows: Window[] = [];
  for (let i = 0; i < lookback; i++) windows.push(monthWindow(now, -i));

  const seen = new Map<string, { amounts: number[]; months: Set<number>; category: Category }>();
  for (const t of transactions) {
    if (!isSpend(t)) continue;
    const w = windows.findIndex((win) => inWindow(t, win.from, win.to));
    if (w === -1) continue;
    const key = t.merchant.trim().toUpperCase();
    if (!key) continue;
    const e = seen.get(key) ?? { amounts: [], months: new Set<number>(), category: t.category };
    e.amounts.push(Math.abs(t.amount.minor));
    e.months.add(w);
    seen.set(key, e);
  }

  const out: Recurring[] = [];
  for (const [merchant, e] of seen) {
    // In at least 2 distinct months, and stable in size (a coffee habit is
    // recurring but not a subscription; the amount tells them apart).
    if (e.months.size < 2) continue;
    const avg = e.amounts.reduce((a, b) => a + b, 0) / e.amounts.length;
    const spread = Math.max(...e.amounts) - Math.min(...e.amounts);
    if (avg > 0 && spread / avg > 0.15) continue;
    out.push({
      merchant,
      category: e.category,
      amount: { minor: Math.round(avg), currency },
      months: e.months.size,
    });
  }
  return out.sort((a, b) => b.amount.minor - a.amount.minor);
}
