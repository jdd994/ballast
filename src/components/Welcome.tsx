// Welcome.tsx
// First run. Two things get said before the user types a single number, because
// saying them afterwards would be a kind of lying:
//
//   1. There is no password reset. Ever. This is the direct consequence of the
//      thing that makes the app safe, and burying it would be a betrayal of the
//      person who trusts it and then loses everything.
//   2. What each kind of connection actually costs them.
//
// Driftless states its trade up front for the same reason. Copy the discipline,
// not just the code.

import { useState } from "react";
import { TrustBadge } from "./TrustBadge";
import { IosSetupNote } from "./IosSetupNote";

const CURRENCIES = ["USD", "EUR", "GBP", "CAD", "AUD", "JPY", "CHF", "SEK", "NZD"];

export function Welcome({
  onSetup,
  busy,
  onSignIn,
}: {
  onSetup: (passphrase: string, currency: string) => Promise<void>;
  busy: boolean;
  // Open the sync sheet to sign in to an existing account (a second device).
  onSignIn?: () => void;
}) {
  const [step, setStep] = useState<"intro" | "passphrase">("intro");
  const [passphrase, setPassphrase] = useState("");
  const [confirm, setConfirm] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    // Length is the only thing that actually matters for a passphrase, so it's
    // the only thing we require. No "must contain a symbol" theatre — that
    // pushes people toward P@ssw0rd1! and away from four honest words.
    if (passphrase.length < 10) {
      setError("Use at least 10 characters. A few plain words you'll remember beats a clever short one.");
      return;
    }
    if (passphrase !== confirm) {
      setError("Those don't match.");
      return;
    }
    await onSetup(passphrase, currency);
  }

  if (step === "intro") {
    return (
      <div className="gate">
        <div className="gate-card">
          <h1 className="gate-brand">
            Ballast<span>.</span>
          </h1>

          <h2>Steady footing with your money.</h2>

          <IosSetupNote />

          <p>
            Everything you put here — balances, accounts, goals — is encrypted on this device
            before it is stored anywhere. Not encrypted "in transit". Encrypted so that we
            could not read it if we wanted to, and so a breach of our servers would yield
            nothing but noise.
          </p>

          <div className="trade">
            <strong>The trade:</strong> the key is made from your passphrase, and your
            passphrase never leaves this device. So there is <strong>no reset</strong>. If you
            forget it, nobody — not us, not anyone — can get your data back. Write it down and
            put it somewhere safe. That is the price of the guarantee, and we would rather you
            hear it now than later.
          </div>

          <h2 style={{ fontSize: 17, marginTop: 30 }}>What it costs to connect an account</h2>
          <p>
            Most money apps hide this. Every account you add here wears a badge saying exactly
            who learns what — and it keeps wearing it, on the dashboard, forever.
          </p>

          <ul className="ladder">
            <li>
              <TrustBadge tier={0} />
              <span>You type the number in. Nothing leaves this device. Nobody sees it.</span>
            </li>
            <li>
              <TrustBadge tier={1} />
              <span>
                Public data — a crypto address, a market price. A provider learns <em>which</em>{" "}
                asset you asked about, never how much you hold.
              </span>
            </li>
            <li>
              <TrustBadge tier={2} />
              <span>
                Your browser talks straight to a bank or exchange that already holds your data.
                Nobody new is added.
              </span>
            </li>
            <li>
              <TrustBadge tier={3} />
              <span>
                An aggregator reads every transaction, in the clear. Ballast doesn't offer this
                today. If it ever does, it will look exactly this alarming.
              </span>
            </li>
          </ul>

          <button className="btn btn-primary" style={{ width: "100%" }} onClick={() => setStep("passphrase")}>
            Set a passphrase
          </button>

          {onSignIn ? (
            <p className="gate-alt">
              Already set up on another device?{" "}
              <button type="button" className="linklike" onClick={onSignIn}>
                Sign in to sync
              </button>
            </p>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="gate">
      <div className="gate-card">
        <h1 className="gate-brand">
          Ballast<span>.</span>
        </h1>
        <h2>Choose a passphrase</h2>
        <p>
          This is the only key to your vault. A few plain words you will not forget is stronger
          than something short and clever.
        </p>

        <IosSetupNote />

        <form onSubmit={submit}>
          {error ? <div className="error">{error}</div> : null}

          <label className="field">
            <span className="label">Passphrase</span>
            <input
              type="password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              autoFocus
              autoComplete="new-password"
              placeholder="at least 10 characters"
            />
          </label>

          <label className="field">
            <span className="label">Again, to be sure</span>
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
            />
          </label>

          <label className="field">
            <span className="label">Your currency</span>
            <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <span className="hint">
              Everything is held and totalled in this one currency, so no total is ever quietly
              built on a guessed exchange rate.
            </span>
          </label>

          <div className="sheet-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setStep("intro")}>
              Back
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? "Making your vault…" : "Create vault"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
