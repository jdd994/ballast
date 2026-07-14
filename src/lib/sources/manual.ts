// sources/manual.ts
// Tier 0. The rung where nothing leaves the device.
//
// This connector has no `read` because there is nothing to read: you tell
// Ballast the number. That sounds like the primitive option and it is — it is
// also the ONLY option with a security story that is airtight rather than
// merely good, which is why it is the default and why every other rung is
// measured against it.
//
// It covers more than it looks like it does: a checking account you update
// monthly, a house, a car, a pension whose value you copy off a statement, a
// loan from your parents. Most of a net worth is not something an API can see.

import type { Connector } from "./index";

export const manual: Connector = {
  kind: "manual",
  label: "Enter it myself",
  tier: 0,
  discloses:
    "Nothing leaves your device. The number is encrypted before it is written to disk, and nobody — including us — can read it.",
};
