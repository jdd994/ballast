// sources/prices.ts
// Tier 1. Public market prices.
//
// The leak here is worth being precise about, because it is subtle and it is
// the kind of thing a less honest app would leave unsaid: asking "what is BTC
// worth?" tells the price provider that you care about BTC. It does NOT tell
// them how much you hold, what your net worth is, or who you are. The query is
// identical whether you own 0.001 BTC or 1,000.
//
// The cache is in-memory only, on purpose. Persisting "symbols this user asks
// about" to disk in the clear would quietly undo the vault: an attacker with
// your laptop couldn't read your balances, but could read that you hold BTC and
// ETH. Everything that says something about you belongs inside the encryption
// boundary or nowhere. A cache is not worth a leak.

import { money, minorDigits, type Price } from "../money";
import type { Prices } from "../ledger";

const COINGECKO = "https://api.coingecko.com/api/v3/simple/price";

// Only the assets we can actually hold today. Grows with the connectors.
const COINGECKO_IDS: Record<string, string> = {
  BTC: "bitcoin",
  ETH: "ethereum",
};

type CacheEntry = { price: Price; at: number };
const cache = new Map<string, CacheEntry>(); // memory only. See note above.
const TTL_MS = 60_000;

function cacheKey(symbol: string, currency: string): string {
  return `${symbol}:${currency}`;
}

// Fetch prices for the given symbols. Symbols we don't know how to price are
// simply absent from the result — the caller then reports the account as
// unpriced rather than as worth zero (see ledger.valueSnapshot).
export async function fetchPrices(symbols: string[], currency: string): Promise<Prices> {
  const out: Prices = {};
  const now = Date.now();

  const wanted = [...new Set(symbols)].filter((s) => COINGECKO_IDS[s]);
  const stale: string[] = [];

  for (const symbol of wanted) {
    const hit = cache.get(cacheKey(symbol, currency));
    if (hit && now - hit.at < TTL_MS) out[symbol] = hit.price;
    else stale.push(symbol);
  }
  if (stale.length === 0) return out;

  const ids = stale.map((s) => COINGECKO_IDS[s]).join(",");
  const vs = currency.toLowerCase();
  const url = `${COINGECKO}?ids=${ids}&vs_currencies=${vs}`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Couldn't reach the price feed (${res.status}). Balances shown may be stale.`);
  }
  const data = (await res.json()) as Record<string, Record<string, number>>;

  for (const symbol of stale) {
    const raw = data[COINGECKO_IDS[symbol]]?.[vs];
    if (typeof raw !== "number" || !Number.isFinite(raw)) continue;

    // The feed hands us a float. Convert to exact minor units once, here, at the
    // boundary — and then never let a float touch money again.
    const price = money(Math.round(raw * 10 ** minorDigits(currency)), currency);
    cache.set(cacheKey(symbol, currency), { price, at: now });
    out[symbol] = price;
  }
  return out;
}

// Dropped on lock, so a locked app holds nothing about you in memory.
export function clearPriceCache(): void {
  cache.clear();
}
