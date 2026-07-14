// Accounts.tsx
// The list. Every row carries its trust badge — that's the point, and it is not
// negotiable away for visual tidiness later.

import { formatMoney, formatQuantity } from "../lib/money";
import { ACCOUNT_KINDS, type AccountValue } from "../lib/ledger";
import { connectorFor, isRefreshable } from "../lib/sources";
import { TrustBadge } from "./TrustBadge";
import { relative } from "./Waterline";
import { Refresh } from "./icons";

export function Accounts({
  valued,
  busy,
  onRefresh,
  onRemove,
  onUpdate,
}: {
  valued: AccountValue[];
  busy: boolean;
  onRefresh: (id: string) => void;
  onRemove: (id: string) => void;
  onUpdate: (id: string) => void;
}) {
  if (valued.length === 0) {
    return (
      <div className="empty">
        Nothing here yet.
        <br />
        Start with the account you check most often.
      </div>
    );
  }

  return (
    <div>
      {valued.map(({ account, snapshot, value }) => {
        const connector = connectorFor(account.source);
        const isDebt = ACCOUNT_KINDS[account.kind].liability;
        const refreshable = isRefreshable(account.source);

        return (
          <div className="account" key={account.id}>
            <div className="account-main">
              <div className="account-name">
                {account.name}
                <TrustBadge tier={connector.tier} />
              </div>
              <div className="account-meta">
                <span>{ACCOUNT_KINDS[account.kind].label}</span>
                {account.source.kind !== "manual" ? (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="addr">{truncate(account.source.address)}</span>
                  </>
                ) : null}
                {snapshot ? (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>{relative(snapshot.at)}</span>
                  </>
                ) : null}
              </div>
            </div>

            <div className="account-value-wrap">
              {value === null ? (
                <div className="account-value is-unknown">no price</div>
              ) : (
                <div className={`account-value${isDebt || value.minor < 0 ? " is-below" : ""}`}>
                  {formatMoney(value)}
                </div>
              )}
              {/* Show the holding itself, not just its money value. 0.5 BTC is
                  the thing you own; the dollar figure is today's opinion of it. */}
              {snapshot?.type === "holding" ? (
                <div className="account-meta" style={{ justifyContent: "flex-end" }}>
                  <span className="qty">{formatQuantity(snapshot.quantity, 6)}</span>
                </div>
              ) : null}
            </div>

            <div className="account-actions">
              {refreshable ? (
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => onRefresh(account.id)}
                  disabled={busy}
                  title="Read the current balance from the chain"
                >
                  <Refresh />
                </button>
              ) : (
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => onUpdate(account.id)}
                  title="Update the balance"
                >
                  Update
                </button>
              )}
              <button
                className="btn btn-danger btn-sm"
                onClick={() => onRemove(account.id)}
                title="Remove this account"
              >
                ×
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function truncate(addr: string): string {
  return addr.length > 16 ? `${addr.slice(0, 8)}…${addr.slice(-6)}` : addr;
}
