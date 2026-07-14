// AddAccount.tsx
// The connect flow. The disclosure for the chosen source is shown BEFORE the
// user hands over anything — not in a tooltip, not behind a "learn more", not
// after the fact. You read what it costs, then you decide.

import { useState } from "react";
import { parseMoney, type Money } from "../lib/money";
import {
  ACCOUNT_KINDS,
  type AccountContent,
  type AccountKind,
  type SnapshotContent,
  type SourceKind,
  type SourceRef,
} from "../lib/ledger";
import { CONNECTORS, connectorFor } from "../lib/sources";
import { Disclosure } from "./TrustBadge";

const SOURCE_ORDER: SourceKind[] = ["manual", "bitcoin", "ethereum"];

export function AddAccount({
  currency,
  busy,
  onAdd,
  onClose,
}: {
  currency: string;
  busy: boolean;
  onAdd: (content: AccountContent, initial?: SnapshotContent) => Promise<void>;
  onClose: () => void;
}) {
  const [sourceKind, setSourceKind] = useState<SourceKind>("manual");
  const [name, setName] = useState("");
  const [kind, setKind] = useState<AccountKind>("cash");
  const [address, setAddress] = useState("");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);

  const connector = CONNECTORS[sourceKind];
  const isManual = sourceKind === "manual";

  function buildRef(): SourceRef {
    if (sourceKind === "manual") return { kind: "manual" };
    return { kind: sourceKind, address: address.trim() };
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError("Give it a name you'll recognise.");
      return;
    }

    const source = buildRef();
    const invalid = connectorFor(source).validate?.(source);
    if (invalid) {
      setError(invalid);
      return;
    }

    let initial: SnapshotContent | undefined;
    if (isManual) {
      const parsed = parseMoney(amount, currency);
      if (!parsed) {
        setError("That doesn't read as an amount. Try something like 1200 or 1,200.50");
        return;
      }
      initial = { type: "balance", value: signFor(kind, parsed) };
    }

    try {
      await onAdd(
        {
          name: name.trim(),
          // A crypto address is always a crypto account. Don't make the user
          // tell us something we already know.
          kind: isManual ? kind : "crypto",
          source,
        },
        initial
      );
      onClose();
    } catch {
      // useLedger has already surfaced the real reason; the sheet stays open so
      // the typed address isn't lost.
    }
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <h3>Add an account</h3>

        <div className="choices">
          {SOURCE_ORDER.map((k) => (
            <button
              key={k}
              type="button"
              className="choice"
              aria-pressed={sourceKind === k}
              onClick={() => {
                setSourceKind(k);
                setError(null);
              }}
            >
              <span className="choice-main">{CONNECTORS[k].label}</span>
            </button>
          ))}
        </div>

        {/* The cost of the rung you just picked, before you give it anything. */}
        <Disclosure tier={connector.tier} discloses={connector.discloses} />

        <form onSubmit={submit}>
          {error ? <div className="error">{error}</div> : null}

          <label className="field">
            <span className="label">Name</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={isManual ? "Checking" : "Cold wallet"}
              autoFocus
            />
          </label>

          {isManual ? (
            <>
              <label className="field">
                <span className="label">What kind?</span>
                <select value={kind} onChange={(e) => setKind(e.target.value as AccountKind)}>
                  {(Object.keys(ACCOUNT_KINDS) as AccountKind[]).map((k) => (
                    <option key={k} value={k}>
                      {ACCOUNT_KINDS[k].label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span className="label">
                  {ACCOUNT_KINDS[kind].liability ? "How much do you owe?" : "What's it worth?"}
                </span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                />
                <span className="hint">
                  {ACCOUNT_KINDS[kind].liability
                    ? "Enter it as a positive number — Ballast knows a debt counts against you."
                    : `In ${currency}. You can update it whenever you like; each update is kept, so the history is real.`}
                </span>
              </label>
            </>
          ) : (
            <label className="field">
              <span className="label">Public address</span>
              <input
                type="text"
                className="mono"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder={sourceKind === "bitcoin" ? "bc1…" : "0x…"}
                spellCheck={false}
                autoCapitalize="none"
              />
              <span className="hint">
                A public address only — never a seed phrase or private key. Ballast can read this
                balance and nothing else; it cannot move your coins, and there is no field here
                that would let it.
              </span>
            </label>
          )}

          <div className="sheet-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? "Adding…" : "Add account"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// A debt is stored as a negative number, so net worth is a plain sum and no
// downstream code has to remember which kinds are liabilities. The user always
// types a positive number, because "how much do you owe? -5000" is a nonsense
// question to ask a human.
function signFor(kind: AccountKind, m: Money): Money {
  const liability = ACCOUNT_KINDS[kind].liability;
  const magnitude = Math.abs(m.minor);
  return { minor: liability ? -magnitude : magnitude, currency: m.currency };
}

// Update the balance of an existing manual account.
export function UpdateBalance({
  name,
  kind,
  currency,
  onSave,
  onClose,
}: {
  name: string;
  kind: AccountKind;
  currency: string;
  onSave: (content: SnapshotContent) => void;
  onClose: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = parseMoney(amount, currency);
    if (!parsed) {
      setError("That doesn't read as an amount.");
      return;
    }
    onSave({ type: "balance", value: signFor(kind, parsed) });
    onClose();
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <h3>{name}</h3>
        <form onSubmit={submit}>
          {error ? <div className="error">{error}</div> : null}
          <label className="field">
            <span className="label">
              {ACCOUNT_KINDS[kind].liability ? "How much do you owe now?" : "What's it worth now?"}
            </span>
            <input
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              autoFocus
            />
            <span className="hint">
              The old value isn't overwritten — it's kept, so your history stays true.
            </span>
          </label>
          <div className="sheet-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary">
              Save
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
