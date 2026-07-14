// ledger.ts
// The domain types, and the pure functions over them. No IO, no React.
//
// Everything in `*Content` is what gets encrypted. If you add a field to one of
// these types, you are adding a field to the ciphertext — which is exactly where
// it belongs. Resist the urge to "just hoist this one little field" up to the
// plaintext record for convenience.

import {
  netWorth,
  valueOf,
  zero,
  type Money,
  type Quantity,
  type NetWorth,
  type Valued,
  type Price,
  type Goal,
} from "./money";
import { isSpend, type Transaction } from "./spend";

export type { Transaction, TransactionContent } from "./spend";

// ---- The trust ladder ----------------------------------------------------
// Every account carries the honest cost of having connected it. This is not a
// disclosure buried in a privacy policy — it is a property of the data model,
// rendered next to the account, every time you look at it.

export type Tier = 0 | 1 | 2 | 3;

export const TIERS: Record<Tier, { label: string; discloses: string }> = {
  0: {
    label: "Private",
    discloses: "Nobody sees this. Not the network, not us. It never leaves your device unencrypted.",
  },
  1: {
    label: "Public data",
    discloses:
      "A public data provider learns which asset or address you asked about — never how much you hold, and never who you are.",
  },
  2: {
    label: "Direct",
    discloses:
      "Your browser talks straight to the institution, which already holds this data. No third party is added.",
  },
  3: {
    label: "Third party",
    discloses:
      "An aggregator can read every transaction in this account, in the clear. This is the only rung where someone new learns something real about you.",
  },
};

// ---- Sources -------------------------------------------------------------

export type SourceRef =
  | { kind: "manual" }
  | { kind: "bitcoin"; address: string }
  | { kind: "ethereum"; address: string };

export type SourceKind = SourceRef["kind"];

// ---- Accounts ------------------------------------------------------------

export type AccountKind = "cash" | "investment" | "crypto" | "property" | "debt";

export const ACCOUNT_KINDS: Record<AccountKind, { label: string; liability: boolean }> = {
  cash: { label: "Cash", liability: false },
  investment: { label: "Investment", liability: false },
  crypto: { label: "Crypto", liability: false },
  property: { label: "Property", liability: false },
  debt: { label: "Debt", liability: true },
};

// The encrypted payload of an account.
export type AccountContent = {
  name: string;
  kind: AccountKind;
  source: SourceRef;
  note?: string;
};

export type Account = AccountContent & {
  id: string;
  createdAt: number;
  updatedAt: number;
};

// ---- Snapshots -----------------------------------------------------------
// An observation of what an account was worth at a moment. A `balance` is a
// number we were told; a `holding` is a quantity we must price. Keeping them
// distinct means historical net worth can be recomputed honestly: 0.5 BTC was
// 0.5 BTC last March regardless of what it was worth that day.

export type SnapshotContent =
  | { type: "balance"; value: Money } // signed: a debt is negative
  | { type: "holding"; quantity: Quantity };

export type Snapshot = SnapshotContent & {
  id: string;
  accountId: string;
  at: number;
};

// ---- Valuation -----------------------------------------------------------

export type Prices = Record<string, Price | undefined>; // by asset symbol

// The most recent snapshot per account.
export function latestSnapshots(snapshots: Snapshot[]): Map<string, Snapshot> {
  const latest = new Map<string, Snapshot>();
  for (const s of snapshots) {
    const prev = latest.get(s.accountId);
    if (!prev || s.at > prev.at) latest.set(s.accountId, s);
  }
  return latest;
}

// What is this account worth, right now, in money?
//
// Returns null — not zero — when a holding can't be priced. A missing price is
// not a zero balance, and showing it as one would understate your net worth
// while looking perfectly plausible. The UI must render the difference.
export function valueSnapshot(snap: Snapshot, prices: Prices): Money | null {
  if (snap.type === "balance") return snap.value;
  const price = prices[snap.quantity.symbol];
  if (!price) return null;
  return valueOf(snap.quantity, price);
}

export type AccountValue = {
  account: Account;
  snapshot?: Snapshot;
  value: Money | null; // null = we genuinely do not know right now
};

export function valueAccounts(
  accounts: Account[],
  snapshots: Snapshot[],
  prices: Prices
): AccountValue[] {
  const latest = latestSnapshots(snapshots);
  return accounts.map((account) => {
    const snapshot = latest.get(account.id);
    return {
      account,
      snapshot,
      value: snapshot ? valueSnapshot(snapshot, prices) : null,
    };
  });
}

// Net worth over only the accounts we can currently value. `unpriced` is handed
// back so the UI can say "…plus 2 accounts we couldn't price" instead of
// quietly pretending they're worth nothing.
export function currentNetWorth(
  valuedAccounts: AccountValue[],
  currency: string
): NetWorth & { unpriced: Account[] } {
  const known: Valued[] = [];
  const unpriced: Account[] = [];
  for (const av of valuedAccounts) {
    if (av.value === null) unpriced.push(av.account);
    else known.push({ accountId: av.account.id, value: av.value });
  }
  return { ...netWorth(known, currency), unpriced };
}

// ---- Net worth history ---------------------------------------------------
// Value every account at each point where ANY account was observed, carrying
// the last known value forward. Prices are today's — so this is honestly "what
// my current holdings were worth as they changed", not a full historical
// price replay. Say that plainly in the UI rather than implying more.

export type Point = { at: number; total: Money };

export function netWorthSeries(
  accounts: Account[],
  snapshots: Snapshot[],
  prices: Prices,
  currency: string
): Point[] {
  if (snapshots.length === 0) return [];
  const sorted = [...snapshots].sort((a, b) => a.at - b.at);
  const times = [...new Set(sorted.map((s) => s.at))];
  const known = new Map<string, Snapshot>();
  const byTime = new Map<number, Snapshot[]>();
  for (const s of sorted) {
    const list = byTime.get(s.at) ?? [];
    list.push(s);
    byTime.set(s.at, list);
  }

  const ids = new Set(accounts.map((a) => a.id));
  const points: Point[] = [];
  for (const at of times) {
    for (const s of byTime.get(at) ?? []) {
      if (ids.has(s.accountId)) known.set(s.accountId, s);
    }
    const valued: Valued[] = [];
    for (const [accountId, snap] of known) {
      const v = valueSnapshot(snap, prices);
      if (v) valued.push({ accountId, value: v });
    }
    points.push({ at, total: valued.length ? netWorth(valued, currency).total : zero(currency) });
  }
  return points;
}

// ---- Goals ---------------------------------------------------------------

export type GoalContent = Omit<Goal, "id">;

// The present value of the accounts a goal watches. Accounts that can't be
// priced are skipped, same honesty rule as above.
export function goalAccountValue(
  goal: Goal,
  valuedAccounts: AccountValue[],
  currency: string
): Money {
  const watched = valuedAccounts.filter(
    (av) => goal.accountIds.includes(av.account.id) && av.value !== null
  );
  return watched.reduce<Money>(
    (acc, av) => ({ minor: acc.minor + av.value!.minor, currency }),
    zero(currency)
  );
}

// What a goal has actually moved, in the terms `goalProgress` expects.
//
// Save and payoff goals read the account balance — the number went up, and by
// how much. A SPEND goal reads the transactions instead, which is a real
// improvement over inferring it from a balance swing: your card balance drops
// when you pay it off, and a balance-derived spend goal would cheerfully count
// that payment as "progress" toward a signup bonus. It isn't. Only actual
// outgoing transactions count.
export function goalCurrentValue(
  goal: Goal,
  valuedAccounts: AccountValue[],
  transactions: Transaction[],
  currency: string
): Money {
  if (goal.kind !== "spend") return goalAccountValue(goal, valuedAccounts, currency);

  const spent = transactions
    .filter(
      (t) =>
        t.at >= goal.startAt &&
        isSpend(t) &&
        (t.accountId === undefined || goal.accountIds.includes(t.accountId))
    )
    .reduce((acc, t) => acc + t.amount.minor, 0); // negative

  return { minor: spent, currency };
}

// A spend goal's baseline is always zero: it measures money that goes out from
// the moment the goal starts, and cannot take credit for spending you did before.
export function goalStartValue(
  goal: Pick<Goal, "kind" | "accountIds">,
  valuedAccounts: AccountValue[],
  currency: string
): Money {
  if (goal.kind === "spend") return zero(currency);
  return goalAccountValue(
    { ...(goal as Goal), id: "", name: "", target: zero(currency), startValue: zero(currency), startAt: 0 },
    valuedAccounts,
    currency
  );
}
