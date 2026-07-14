import { describe, it, expect } from "vitest";
import { money } from "./money";
import { normalizeMerchant, suggestCategory, remember, type MerchantMemory } from "./categorize";
import { byCategory, spentIn, earnedIn, monthWindow, notable, recurring, type Transaction } from "./spend";

const USD = "USD";
let seq = 0;
function tx(at: string, amount: number, merchant: string, category: Transaction["category"]): Transaction {
  return {
    id: `t${seq++}`,
    at: new Date(at).getTime(),
    amount: money(amount, USD),
    merchant,
    category,
  };
}

describe("normalizeMerchant", () => {
  it("strips the noise card descriptors are full of", () => {
    expect(normalizeMerchant("TRADER JOE'S #412")).toBe("TRADER JOE'S");
    expect(normalizeMerchant("SQ *BLUE BOTTLE 4412")).toBe("BLUE BOTTLE");
    expect(normalizeMerchant("TST* PIZZERIA 03/14")).toBe("PIZZERIA");
    expect(normalizeMerchant("PAYPAL SPOTIFY")).toBe("SPOTIFY");
  });

  it("collapses the same shop written two ways to one key", () => {
    expect(normalizeMerchant("SQ *BLUE BOTTLE 4412")).toBe(normalizeMerchant("SQ *BLUE BOTTLE #9"));
  });
});

describe("the categoriser learns from you", () => {
  it("knows nothing about an unknown merchant, and says so", () => {
    expect(suggestCategory("KWIK-E-MART", {})).toBeNull();
  });

  it("remembers what you taught it", () => {
    let memory: MerchantMemory = {};
    memory = remember("KWIK-E-MART #7", "groceries", memory);
    const s = suggestCategory("KWIK-E-MART #12", memory);
    expect(s).toEqual({ category: "groceries", from: "learned" });
  });

  it("matches a merchant it has seen inside a longer descriptor", () => {
    const memory = remember("BLUE BOTTLE", "dining", {});
    expect(suggestCategory("BLUE BOTTLE COFFEE OAKLAND", memory)?.category).toBe("dining");
  });

  it("offers a built-in hint, but marks it as a guess", () => {
    expect(suggestCategory("NETFLIX.COM", {})).toEqual({ category: "subscriptions", from: "hint" });
  });

  it("lets your correction beat the built-in hint, permanently", () => {
    // You file Netflix under entertainment, not subscriptions. You are right,
    // because it's your money.
    const memory = remember("NETFLIX.COM", "entertainment", {});
    expect(suggestCategory("NETFLIX.COM", memory)).toEqual({
      category: "entertainment",
      from: "learned",
    });
  });
});

describe("spend totals", () => {
  const txns: Transaction[] = [
    tx("2026-07-02", -4500, "TRADER JOES", "groceries"),
    tx("2026-07-05", -1200, "BLUE BOTTLE", "dining"),
    tx("2026-07-09", -8000, "TRADER JOES", "groceries"),
    tx("2026-07-10", 500000, "ACME PAYROLL", "income"),
    // Moving money to your own savings is NOT spending.
    tx("2026-07-11", -200000, "TRANSFER TO SAVINGS", "transfer"),
    // Last month, outside the window.
    tx("2026-06-15", -9900, "TRADER JOES", "groceries"),
  ];
  const w = monthWindow(new Date("2026-07-13").getTime());

  it("counts money out, in spending categories only", () => {
    // 4500 + 1200 + 8000 = 13700. The transfer and the salary are excluded.
    expect(spentIn(txns, w.from, w.to, USD).minor).toBe(13700);
  });

  it("does not count a transfer as spending", () => {
    const cats = byCategory(txns, w.from, w.to, USD);
    expect(cats.find((c) => c.category === "transfer")).toBeUndefined();
  });

  it("counts income separately", () => {
    expect(earnedIn(txns, w.from, w.to, USD).minor).toBe(500000);
  });

  it("breaks spend down by category, biggest first", () => {
    const cats = byCategory(txns, w.from, w.to, USD);
    expect(cats[0].category).toBe("groceries");
    expect(cats[0].total.minor).toBe(12500);
    expect(cats[0].count).toBe(2);
    expect(cats[0].share).toBeCloseTo(12500 / 13700, 4);
    expect(cats[1].category).toBe("dining");
  });

  it("excludes last month's spend from this month's window", () => {
    expect(byCategory(txns, w.from, w.to, USD).find((c) => c.category === "groceries")!.total.minor).toBe(
      12500
    );
  });
});

describe("notable — unusual for YOU, in both directions", () => {
  const now = new Date("2026-07-13").getTime();

  it("says nothing without enough history to have a 'usual'", () => {
    const txns = [tx("2026-07-02", -50000, "X", "dining")];
    expect(notable(txns, now, USD)).toEqual([]);
  });

  it("notices a category well above your own normal", () => {
    const txns: Transaction[] = [
      tx("2026-04-05", -10000, "X", "dining"),
      tx("2026-05-05", -10000, "X", "dining"),
      tx("2026-06-05", -10000, "X", "dining"),
      tx("2026-07-05", -40000, "X", "dining"), // 4x
    ];
    const n = notable(txns, now, USD);
    expect(n).toHaveLength(1);
    expect(n[0].category).toBe("dining");
    expect(n[0].ratio).toBeCloseTo(4, 1);
    expect(n[0].usual.minor).toBe(10000);
  });

  it("also notices when you spent markedly LESS — that fact belongs to you too", () => {
    const txns: Transaction[] = [
      tx("2026-05-05", -40000, "X", "dining"),
      tx("2026-06-05", -40000, "X", "dining"),
      tx("2026-07-05", -10000, "X", "dining"), // a quarter
    ];
    const n = notable(txns, now, USD);
    expect(n).toHaveLength(1);
    expect(n[0].ratio).toBeCloseTo(0.25, 2);
  });

  it("never produces NaN when a prior month had none of that category", () => {
    const txns: Transaction[] = [
      tx("2026-05-05", -10000, "X", "dining"),
      tx("2026-06-05", -10000, "X", "dining"),
      tx("2026-06-06", -10000, "Y", "travel"), // travel exists in June only
      tx("2026-07-05", -50000, "Y", "travel"),
    ];
    for (const n of notable(txns, now, USD)) {
      expect(Number.isFinite(n.ratio)).toBe(true);
      expect(Number.isFinite(n.usual.minor)).toBe(true);
    }
  });
});

describe("recurring — the subscriptions you forgot about", () => {
  const now = new Date("2026-07-13").getTime();

  it("finds a steady monthly charge", () => {
    const txns: Transaction[] = [
      tx("2026-05-03", -1599, "NETFLIX", "subscriptions"),
      tx("2026-06-03", -1599, "NETFLIX", "subscriptions"),
      tx("2026-07-03", -1599, "NETFLIX", "subscriptions"),
    ];
    const r = recurring(txns, now, USD);
    expect(r).toHaveLength(1);
    expect(r[0].merchant).toBe("NETFLIX");
    expect(r[0].amount.minor).toBe(1599);
    expect(r[0].months).toBe(3);
  });

  it("does not mistake a coffee habit for a subscription", () => {
    // Same merchant every month, wildly different amounts — that's a habit, not
    // a recurring charge, and calling it one would be noise.
    const txns: Transaction[] = [
      tx("2026-05-03", -450, "BLUE BOTTLE", "dining"),
      tx("2026-06-03", -1800, "BLUE BOTTLE", "dining"),
      tx("2026-07-03", -900, "BLUE BOTTLE", "dining"),
    ];
    expect(recurring(txns, now, USD)).toEqual([]);
  });

  it("ignores a one-off", () => {
    const txns = [tx("2026-07-03", -1599, "NETFLIX", "subscriptions")];
    expect(recurring(txns, now, USD)).toEqual([]);
  });
});
