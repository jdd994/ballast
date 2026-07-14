// LockScreen.tsx
// The vault is closed. Nothing on screen, and nothing in memory, says anything
// about this person's money until the passphrase (or a biometric shortcut to the
// same key) opens it.

import { useEffect, useState } from "react";

export function LockScreen({
  onUnlock,
  onBiometric,
  hasBiometric,
  error,
  busy,
}: {
  onUnlock: (passphrase: string) => Promise<boolean>;
  onBiometric: () => Promise<boolean>;
  hasBiometric: boolean;
  error: string | null;
  busy: boolean;
}) {
  const [passphrase, setPassphrase] = useState("");

  // If this device has quick unlock, offer it immediately rather than making the
  // user tap a button to be asked for their thumb.
  useEffect(() => {
    if (hasBiometric) void onBiometric();
    // Deliberately once, on mount. Re-prompting on every render would be a
    // biometric popup loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const ok = await onUnlock(passphrase);
    if (!ok) setPassphrase("");
  }

  return (
    <div className="gate">
      <div className="gate-card">
        <h1 className="gate-brand">
          Ballast<span>.</span>
        </h1>
        <h2>Welcome back.</h2>
        <p>Your passphrase unlocks the vault on this device.</p>

        <form onSubmit={submit}>
          {error ? <div className="error">{error}</div> : null}

          <label className="field">
            <span className="label">Passphrase</span>
            <input
              type="password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              autoFocus
              autoComplete="current-password"
            />
          </label>

          <button type="submit" className="btn btn-primary" style={{ width: "100%" }} disabled={busy || !passphrase}>
            {busy ? "Unlocking…" : "Unlock"}
          </button>

          {hasBiometric ? (
            <button
              type="button"
              className="btn btn-ghost"
              style={{ width: "100%", marginTop: 9 }}
              onClick={() => void onBiometric()}
            >
              Use biometrics instead
            </button>
          ) : null}
        </form>
      </div>
    </div>
  );
}
