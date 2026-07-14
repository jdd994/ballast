import { describe, it, expect } from "vitest";
import {
  money,
  add,
  subtract,
  sum,
  parseMoney,
  formatMoney,
  quantity,
  formatQuantity,
  valueOf,
  netWorth,
  goalProgress,
  type Goal,
} from "./money";

const USD = "USD";

describe("money is exact", () => {
  it("does not drift the way floats do", () => {
    // The canonical float failure: 0.1 + 0.2 !== 0.3.
    expect(add(money(10, USD), money(20, USD)).minor).toBe(30);
    // A thousand ten-cent additions land exactly on $100.00, not $99.99999.
    let acc = money(0, USD);
    for (let i = 0; i < 1000; i++) acc = add(acc, money(10, USD));
    expect(acc.minor).toBe(10_000);
  });

  it("refuses to construct from a fractional minor unit", () => {
    expect(() => money(10.5, USD)).toThrow();
  });

  it("refuses to add mismatched currencies rather than guessing a rate", () => {
    expect(() => add(money(100, USD), money(100, "GBP"))).toThrow(/explicit rate/);
  });
});

describe("parseMoney", () => {
  it("reads what a human actually types", () => {
    expect(parseMoney("1234.56", USD)).toEqual({ minor: 123456, currency: USD });
    expect(parseMoney("$1,234.56", USD)).toEqual({ minor: 123456, currency: USD });
    expect(parseMoney("40", USD)).toEqual({ minor: 4000, currency: USD });
    expect(parseMoney("-40.5", USD)).toEqual({ minor: -4050, currency: USD });
    expect(parseMoney("0.07", USD)).toEqual({ minor: 7, currency: USD });
  });

  it("truncates excess precision instead of inventing a cent", () => {
    expect(parseMoney("1.999", USD)).toEqual({ minor: 199, currency: USD });
  });

  it("honours zero-minor-unit currencies", () => {
    expect(parseMoney("1234", "JPY")).toEqual({ minor: 1234, currency: "JPY" });
  });

  it("returns null on junk rather than a silent zero", () => {
    expect(parseMoney("", USD)).toBeNull();
    expect(parseMoney("abc", USD)).toBeNull();
    expect(parseMoney("1.2.3", USD)).toBeNull();
  });
});

describe("formatMoney", () => {
  it("renders currency", () => {
    expect(formatMoney(money(123456, USD))).toContain("1,234.56");
    expect(formatMoney(money(-4050, USD))).toContain("40.50");
  });
});

describe("quantities keep precision money cannot", () => {
  it("formats 8-decimal BTC exactly", () => {
    expect(formatQuantity(quantity("50000000", 8, "BTC"))).toBe("0.5 BTC");
    expect(formatQuantity(quantity("1", 8, "BTC"))).toBe("0.00000001 BTC");
    expect(formatQuantity(quantity("210000000000000", 8, "BTC"))).toBe("2,100,000 BTC");
  });

  it("formats 18-decimal wei without float corruption", () => {
    // 1.5 ETH in wei is 1.5e18 — far past float64's exact-integer range. The
    // string path must survive it intact.
    expect(formatQuantity(quantity("1500000000000000000", 18, "ETH"))).toBe("1.5 ETH");
    // One wei. A float would round this to zero.
    expect(formatQuantity(quantity("1", 18, "ETH"), 18)).toBe("0.000000000000000001 ETH");
  });

  it("prices a holding into money", () => {
    // 0.5 BTC at $95,000 = $47,500.
    const v = valueOf(quantity("50000000", 8, "BTC"), money(9_500_000, USD));
    expect(v).toEqual({ minor: 4_750_000, currency: USD });
    expect(formatMoney(v)).toContain("47,500.00");
  });
});

describe("netWorth", () => {
  it("is what you own minus what you owe", () => {
    const nw = netWorth(
      [
        { accountId: "checking", value: money(420_000, USD) }, // $4,200
        { accountId: "brokerage", value: money(2_500_000, USD) }, // $25,000
        { accountId: "card", value: money(-180_000, USD) }, // -$1,800
        { accountId: "mortgage", value: money(-20_000_000, USD) }, // -$200,000
      ],
      USD
    );
    expect(nw.assets.minor).toBe(2_920_000);
    expect(nw.liabilities.minor).toBe(20_180_000); // positive magnitude
    expect(nw.total.minor).toBe(-17_260_000); // underwater, and says so
  });

  it("is zero, not NaN, with no accounts", () => {
    expect(netWorth([], USD).total).toEqual({ minor: 0, currency: USD });
  });
});

describe("goalProgress", () => {
  const DAY = 24 * 60 * 60 * 1000;
  const base = {
    id: "g1",
    accountIds: ["savings"],
    startAt: 0,
  };

  it("stays quiet on day one instead of guessing", () => {
    const goal: Goal = {
      ...base,
      name: "Emergency fund",
      kind: "save",
      target: money(1_000_000, USD),
      startValue: money(0, USD),
    };
    const p = goalProgress(goal, money(10_000, USD), DAY / 2);
    expect(p.perMonthObserved).toBeUndefined();
    expect(p.projectedAt).toBeUndefined();
  });

  it("projects an honest arrival date from real pace", () => {
    // Saving toward $10,000, started at zero, 90 days in with $3,000 saved.
    // Pace is $1,000/mo (roughly), so the remaining $7,000 takes ~7 more months.
    const goal: Goal = {
      ...base,
      name: "Emergency fund",
      kind: "save",
      target: money(1_000_000, USD),
      startValue: money(0, USD),
    };
    const now = 90 * DAY;
    const p = goalProgress(goal, money(300_000, USD), now);

    expect(p.fraction).toBeCloseTo(0.3, 5);
    expect(p.done).toBe(false);
    expect(p.perMonthObserved!.minor).toBeCloseTo(101_456, -3); // ~$1,014/mo
    // Remaining $7,000 at $3,000/90d => 210 more days.
    expect(p.projectedAt).toBeCloseTo(now + 210 * DAY, -6);
  });

  it("tracks a debt payoff as progress toward zero", () => {
    // Started $5,000 in the hole, now $3,000 in the hole: $2,000 of the
    // $5,000 target is done.
    const goal: Goal = {
      ...base,
      name: "Kill the card",
      kind: "payoff",
      target: money(500_000, USD),
      startValue: money(-500_000, USD),
    };
    const p = goalProgress(goal, money(-300_000, USD), 60 * DAY);
    expect(p.current.minor).toBe(200_000);
    expect(p.fraction).toBeCloseTo(0.4, 5);
  });

  it("says whether a signup bonus is reachable without changing behaviour", () => {
    // The travel-hacking case, and it needs no special machinery: spend $4,000
    // in 90 days. 30 days in, $1,400 has gone out the door.
    const goal: Goal = {
      ...base,
      name: "Sapphire bonus",
      kind: "spend",
      target: money(400_000, USD),
      startValue: money(0, USD),
      deadline: 90 * DAY,
    };
    const p = goalProgress(goal, money(-140_000, USD), 30 * DAY);

    expect(p.current.minor).toBe(140_000); // $1,400 spent
    // At $1,400/30d you reach $4,000 in ~86 days — inside the 90-day window.
    expect(p.onPace).toBe(true);
    expect(p.projectedAt!).toBeLessThan(90 * DAY);
  });

  it("says plainly when you are NOT on pace", () => {
    const goal: Goal = {
      ...base,
      name: "Sapphire bonus",
      kind: "spend",
      target: money(400_000, USD),
      startValue: money(0, USD),
      deadline: 90 * DAY,
    };
    // Only $600 spent in 30 days — that pace lands at $1,800, well short.
    const p = goalProgress(goal, money(-60_000, USD), 30 * DAY);
    expect(p.onPace).toBe(false);
    // And it says exactly what closing the gap would take, per month.
    expect(p.perMonthNeeded!.minor).toBeGreaterThan(0);
  });

  it("clamps a smashed goal to 100% and marks it done", () => {
    const goal: Goal = {
      ...base,
      name: "Emergency fund",
      kind: "save",
      target: money(1_000_000, USD),
      startValue: money(0, USD),
    };
    const p = goalProgress(goal, money(1_500_000, USD), 90 * DAY);
    expect(p.done).toBe(true);
    expect(p.fraction).toBe(1);
  });
});

describe("sum", () => {
  it("totals a list", () => {
    expect(sum([money(100, USD), money(250, USD), money(-50, USD)], USD).minor).toBe(300);
  });
  it("subtracts", () => {
    expect(subtract(money(500, USD), money(150, USD)).minor).toBe(350);
  });
});
