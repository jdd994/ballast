import { useState } from "react";
import { useLedger } from "./hooks/useLedger";
import { Welcome } from "./components/Welcome";
import { LockScreen } from "./components/LockScreen";
import { Waterline } from "./components/Waterline";
import { Accounts } from "./components/Accounts";
import { AddAccount, UpdateBalance } from "./components/AddAccount";
import { Goals, AddGoal } from "./components/Goals";
import { Spending, ReceiptView } from "./components/Spending";
import { AddExpense } from "./components/AddExpense";
import { Support } from "./components/Support";
import { Sync } from "./components/Sync";
import { InstallHint } from "./components/InstallHint";
import { Heart } from "./components/icons";
import type { SnapshotContent } from "./lib/ledger";

type Tab = "worth" | "spending";

export default function App() {
  const l = useLedger();
  const [tab, setTab] = useState<Tab>("worth");
  const [adding, setAdding] = useState(false);
  const [addingGoal, setAddingGoal] = useState(false);
  const [addingExpense, setAddingExpense] = useState(false);
  const [updating, setUpdating] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<string | null>(null);
  const [support, setSupport] = useState(false);
  const [sync, setSync] = useState(false);

  async function viewReceipt(mediaId: string) {
    setReceipt(await l.loadReceipt(mediaId));
  }

  if (l.status === "loading") return null;

  if (l.status === "setup") {
    return (
      <>
        <Welcome onSetup={l.setup} busy={l.busy} onSignIn={() => setSync(true)} />
        {sync ? (
          <Sync
            account={l.account}
            syncing={l.syncing}
            syncError={l.syncError}
            canCreate={false}
            onCreate={l.connectCreate}
            onSignIn={l.connectSignIn}
            onDisconnect={l.disconnect}
            onDelete={l.deleteAccount}
            onChangePassphrase={l.changePassphrase}
            onSyncNow={l.syncNow}
            onClose={() => setSync(false)}
          />
        ) : null}
      </>
    );
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
          <button
            className="btn btn-sm"
            onClick={() => setSync(true)}
            title={l.account ? `Syncing as ${l.account}` : "Sync across devices"}
          >
            {l.syncing ? "Syncing…" : l.account ? "Synced" : "Sync"}
          </button>
          <button
            className="btn btn-ghost btn-sm heart"
            onClick={() => setSupport(true)}
            title="How Ballast is paid for"
            aria-label="How Ballast is paid for"
          >
            <Heart />
          </button>
          <button className="btn btn-sm" onClick={l.lock} title="Lock the vault">
            Lock
          </button>
        </div>
      </header>

      {l.error ? <div className="error">{l.error}</div> : null}

      <InstallHint />

      <Waterline net={l.net} currency={l.currency} asOf={lastUpdate} />

      <nav className="tabs">
        <button
          className="tab"
          aria-pressed={tab === "worth"}
          onClick={() => setTab("worth")}
        >
          Worth
        </button>
        <button
          className="tab"
          aria-pressed={tab === "spending"}
          onClick={() => setTab("spending")}
        >
          Spending
        </button>
      </nav>

      {tab === "worth" ? (
        <>
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
              <button
                className="btn btn-sm"
                onClick={() => setAddingGoal(true)}
                disabled={!l.accounts.length}
              >
                Add
              </button>
            </div>
            <Goals
              goals={l.goals}
              progressFor={l.progressFor}
              onRemove={(id) => void l.removeGoal(id)}
            />
          </section>
        </>
      ) : (
        <section className="section">
          <div className="section-head">
            <h2 className="section-title">Spending</h2>
            <button className="btn btn-sm" onClick={() => setAddingExpense(true)}>
              Log
            </button>
          </div>
          <Spending
            transactions={l.transactions}
            currency={l.currency}
            onRemove={(id) => void l.removeTransaction(id)}
            onViewReceipt={(id) => void viewReceipt(id)}
          />
        </section>
      )}

      {addingExpense ? (
        <AddExpense
          currency={l.currency}
          accounts={l.accounts}
          busy={l.busy}
          suggest={l.suggest}
          onAdd={l.addTransaction}
          onClose={() => setAddingExpense(false)}
        />
      ) : null}

      {receipt ? <ReceiptView src={receipt} onClose={() => setReceipt(null)} /> : null}

      {support ? <Support onClose={() => setSupport(false)} /> : null}

      {sync ? (
        <Sync
          account={l.account}
          syncing={l.syncing}
          syncError={l.syncError}
          canCreate={true}
          onCreate={l.connectCreate}
          onSignIn={l.connectSignIn}
          onDisconnect={l.disconnect}
          onDelete={l.deleteAccount}
          onChangePassphrase={l.changePassphrase}
            onSyncNow={l.syncNow}
          onClose={() => setSync(false)}
        />
      ) : null}

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
