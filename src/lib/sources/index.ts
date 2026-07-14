// sources/index.ts
// The connector interface. Every way money can get into Ballast implements this,
// and every one of them must state its rung on the trust ladder.
//
// `tier` is not documentation — it is rendered next to the account, forever. A
// connector that cannot honestly justify its tier does not get merged.
//
// Adding a connector is therefore a two-part act: the code, and the honest
// answer to "who learns what?". If those two disagree, the code is wrong.

import type { SnapshotContent, SourceKind, SourceRef, Tier } from "../ledger";

export type Connector = {
  kind: SourceKind;
  label: string;
  tier: Tier;

  // Precisely who learns precisely what. Shown to the user before they connect.
  // Write it as if the person reading it is about to trust you with their
  // money, because they are.
  discloses: string;

  // Some sources you read (a chain); some you're told (manual entry).
  read?: (ref: SourceRef) => Promise<SnapshotContent>;

  // Validate user input before we ever store it. Returns an error string, or
  // null when it's fine.
  validate?: (ref: SourceRef) => string | null;
};

import { manual } from "./manual";
import { bitcoin, ethereum } from "./chain";

export const CONNECTORS: Record<SourceKind, Connector> = {
  manual: manual,
  bitcoin: bitcoin,
  ethereum: ethereum,
};

export function connectorFor(ref: SourceRef): Connector {
  return CONNECTORS[ref.kind];
}

// A source is refreshable if it knows how to go and look.
export function isRefreshable(ref: SourceRef): boolean {
  return typeof CONNECTORS[ref.kind].read === "function";
}
