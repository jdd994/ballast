// sources/chain.ts
// Tier 1. Public chain data.
//
// A public address is the rare case where "connecting an account" costs you
// almost nothing. There is no credential, no OAuth, no token that could be
// stolen, and nothing here can ever *move* your coins — Ballast only ever reads
// a balance that is, by the design of the chain itself, already public.
//
// The honest residual leak, stated plainly because it is the whole point of the
// tier system: the node we query sees the address you asked about, alongside
// your IP. It does not see who you are and does not see your other accounts.
// Anyone who already had your address could have looked this up themselves.
//
// Mitigation for the paranoid, and it is a legitimate posture: point these at
// your own node. Both endpoints are overridable (see `endpoints` below), at
// which point the leak is zero. Wiring that into Settings is a TODO.

import { quantity } from "../money";
import type { SnapshotContent, SourceRef } from "../ledger";
import type { Connector } from "./index";

// Overridable so a user can run this against their own node and leak nothing.
// Any change here must also be added to `connect-src` in public/_headers, or
// the browser will (correctly) refuse the request.
export const endpoints = {
  bitcoin: "https://blockstream.info/api",
  ethereum: "https://cloudflare-eth.com",
};

// Deliberately loose but not permissive: legacy (1…), P2SH (3…), and bech32
// (bc1…). The goal is to catch a typo before it becomes a silently-zero balance
// the user mistakes for real, not to reimplement full base58check validation.
const BTC_ADDRESS = /^(bc1[a-z0-9]{25,62}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})$/;
const ETH_ADDRESS = /^0x[a-fA-F0-9]{40}$/;

async function fetchJSON(url: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(url, init);
  if (!res.ok) {
    throw new Error(`${new URL(url).hostname} replied ${res.status}. Couldn't refresh right now.`);
  }
  return res.json();
}

export const bitcoin: Connector = {
  kind: "bitcoin",
  label: "Bitcoin address",
  tier: 1,
  discloses:
    "A public block explorer sees which Bitcoin address you asked about. Your balance is already public on the chain — anyone with the address can read it. Nothing here can spend, and no key is stored.",

  validate(ref: SourceRef): string | null {
    if (ref.kind !== "bitcoin") return "Wrong source type.";
    const addr = ref.address.trim();
    if (!addr) return "Paste a Bitcoin address.";
    if (!BTC_ADDRESS.test(addr)) {
      return "That doesn't look like a Bitcoin address. Check for a missing or extra character.";
    }
    return null;
  },

  async read(ref: SourceRef): Promise<SnapshotContent> {
    if (ref.kind !== "bitcoin") throw new Error("Wrong source type.");
    const data = (await fetchJSON(`${endpoints.bitcoin}/address/${ref.address.trim()}`)) as {
      chain_stats?: { funded_txo_sum?: number; spent_txo_sum?: number };
    };
    const stats = data.chain_stats;
    if (!stats || stats.funded_txo_sum === undefined || stats.spent_txo_sum === undefined) {
      throw new Error("The block explorer sent back something unexpected. Try again shortly.");
    }
    // Esplora reports in satoshis, which are integers — so this stays exact.
    const sats = stats.funded_txo_sum - stats.spent_txo_sum;
    return { type: "holding", quantity: quantity(String(sats), 8, "BTC") };
  },
};

export const ethereum: Connector = {
  kind: "ethereum",
  label: "Ethereum address",
  tier: 1,
  discloses:
    "A public Ethereum node sees which address you asked about. Your balance is already public on the chain. Nothing here can spend, and no key is stored.",

  validate(ref: SourceRef): string | null {
    if (ref.kind !== "ethereum") return "Wrong source type.";
    const addr = ref.address.trim();
    if (!addr) return "Paste an Ethereum address.";
    if (!ETH_ADDRESS.test(addr)) {
      return "An Ethereum address is 0x followed by 40 hex characters.";
    }
    return null;
  },

  async read(ref: SourceRef): Promise<SnapshotContent> {
    if (ref.kind !== "ethereum") throw new Error("Wrong source type.");
    const data = (await fetchJSON(endpoints.ethereum, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_getBalance",
        params: [ref.address.trim(), "latest"],
      }),
    })) as { result?: string; error?: { message?: string } };

    if (data.error) throw new Error(data.error.message ?? "The Ethereum node rejected that.");
    if (typeof data.result !== "string") {
      throw new Error("The Ethereum node sent back something unexpected. Try again shortly.");
    }

    // Wei is an 18-decimal integer — 1 ETH is 1e18, well past the point where a
    // JS number stays exact. BigInt parses the hex losslessly, and we keep it as
    // a string all the way to the display layer. This is precisely the case
    // money.ts's Quantity type exists for.
    const wei = BigInt(data.result);
    return { type: "holding", quantity: quantity(wei.toString(), 18, "ETH") };
  },
};
