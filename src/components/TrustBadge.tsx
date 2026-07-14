// TrustBadge.tsx
// The honest cost of a connection, rendered next to the account that incurred
// it, every single time you look at it.
//
// This component is small and it is the ethical centre of the app. Fintech
// convention is to bury "we and our partners may access your transaction data"
// in a privacy policy nobody reads, then show a clean green "Connected ✓". The
// badge refuses that. If connecting an account means a third party can read
// every transaction, the account says so, on the dashboard, forever.

import { TIERS, type Tier } from "../lib/ledger";

export function TrustBadge({ tier, showLabel = true }: { tier: Tier; showLabel?: boolean }) {
  const { label, discloses } = TIERS[tier];
  return (
    <span className={`tier tier-${tier}`} title={discloses}>
      {showLabel ? label : null}
    </span>
  );
}

export function Disclosure({ tier, discloses }: { tier: Tier; discloses: string }) {
  return (
    <div className="disclosure">
      <TrustBadge tier={tier} />
      <p>{discloses}</p>
    </div>
  );
}
