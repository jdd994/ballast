import { useState } from "react";
import { useLedger } from "./hooks/useLedger";
import { Welcome } from "./components/Welcome";
import { LockScreen } from "./components/LockScreen";
import { Waterline } from "./components/Waterline";
import { Accounts } from "./components/Accounts";
import { AddAccount, UpdateBalance } from "./components/AddAccount";
import { Goals, AddGoal } from "./components/Goals";
import type { SnapshotContent } from "./lib/ledger";

export default function App() {
  const l = useLedger();
  const [adding, setAdding] = useState(false);
  const [addingGoal, setAddingGoal] = useState(false);
  const [updating, setUpdating] = useState<string | null>(null);

  if (l.status === "loading") return null;

  if (l.status === "setup") {
    return <Welcome onSetup={l.setup} busy={l.busy} />;
  }

  if (l.status === "locked") {
    return (
      <LockScreen
        onUnlock={l.unlock}
        onBiometric={l.unlockWithBiometric}
        hasBiometric={l.hasBiometric}
        error={l.error}
        busy={l.busy}
      />
    );
  }

  const updatingAccount = l.accounts.find((a) => a.id === updating);
  const lastUpdate = l.snapshots.length
    ? Math.max(...l.snapshots.map((s) => s.at))
    : undefined;

  return (
    <div className="wrap">
      <header className="top">
        <h1 className="brand">
          Ballast<span>.</span>
        </h1>
        <div className="top-actions">
          {l.accounts.some((a) => a.source.kind !== "manual") ? (
            <button className="btn btn-sm" onClick={() => void l.refreshAll()} disabled={l.busy}>
              {l.busy ? "Refreshing…" : "Refresh"}
            </button>
          ) : null}
          {l.canBiometric && !l.hasBiometric ? (
            <button className="btn btn-sm" onClick={() => void l.enableBiometric()}>
              Quick unlock
            </button>
          ) : null}
          <button className="btn btn-sm" onClick={l.lock} title="Lock the vault">
            Lock
          </button>
        </div>
      </header>

      {l.error ? <div className="error">{l.error}</div> : null}

      <Waterline net={l.net} currency={l.currency} asOf={lastUpdate} />

      <section className="section">
        <div className="section-head">
          <h2 className="section-title">Accounts</h2>
          <button className="btn btn-sm" onClick={() => setAdding(true)}>
            Add
          </button>
        </div>
        <Accounts
          valued={l.valued}
          busy={l.busy}
          onRefresh={(id) => void l.refreshAccount(id)}
          onRemove={(id) => void l.removeAccount(id)}
          onUpdate={setUpdating}
        />
      </section>

      <section className="section">
        <div className="section-head">
          <h2 className="section-title">Goals</h2>
          <button className="btn btn-sm" onClick={() => setAddingGoal(true)} disabled={!l.accounts.length}>
            Add
          </button>
        </div>
        <Goals goals={l.goals} progressFor={l.progressFor} onRemove={(id) => void l.removeGoal(id)} />
      </section>

      {adding ? (
        <AddAccount
          currency={l.currency}
          busy={l.busy}
          onAdd={l.addAccount}
          onClose={() => setAdding(false)}
        />
      ) : null}

      {addingGoal ? (
        <AddGoal
          currency={l.currency}
          accounts={l.accounts}
          valued={l.valued}
          onAdd={l.addGoal}
          onClose={() => setAddingGoal(false)}
        />
      ) : null}

      {updatingAccount ? (
        <UpdateBalance
          name={updatingAccount.name}
          kind={updatingAccount.kind}
          currency={l.currency}
          onSave={(content: SnapshotContent) => void l.recordSnapshot(updatingAccount.id, content)}
          onClose={() => setUpdating(null)}
        />
      ) : null}
    </div>
  );
}
