// Goals.tsx
// One primitive, three shapes. "Save $10,000", "kill this card", and "spend
// $4,000 to hit a signup bonus" are the same question: given where I started and
// how fast I'm actually moving, do I get there?
//
// The one rule that keeps this honest: YOU name the target. Ballast never
// recommends a product. It will tell you whether your existing spending already
// clears a $4,000 bonus threshold — that's a true fact about your own money. It
// will never tell you which card to get, because the moment it does, it stops
// working for you and starts working for whoever pays the referral.

import { useState } from "react";
import { formatMoney, parseMoney, type Goal, type GoalKind, type Progress } from "../lib/money";
import type { Account, AccountValue, GoalContent } from "../lib/ledger";
import { goalStartValue } from "../lib/ledger";

const KIND_LABELS: Record<GoalKind, { label: string; blurb: string }> = {
  save: { label: "Save toward", blurb: "Build something up — a fund, a deposit, a cushion." },
  payoff: { label: "Pay off", blurb: "Bring a debt down to zero." },
  spend: {
    label: "Spend toward",
    blurb: "Hit a spending threshold — a signup bonus, say — and know if you'll get there without changing anything.",
  },
};

export function Goals({
  goals,
  progressFor,
  onRemove,
}: {
  goals: Goal[];
  progressFor: (g: Goal) => Progress;
  onRemove: (id: string) => void;
}) {
  if (goals.length === 0) {
    return (
      <div className="empty">
        No goals yet.
        <br />
        A goal is just a number and a date — Ballast tells you the truth about whether you'll
        make it.
      </div>
    );
  }

  return (
    <div>
      {goals.map((goal) => (
        <GoalRow key={goal.id} goal={goal} progress={progressFor(goal)} onRemove={onRemove} />
      ))}
    </div>
  );
}

function GoalRow({
  goal,
  progress,
  onRemove,
}: {
  goal: Goal;
  progress: Progress;
  onRemove: (id: string) => void;
}) {
  return (
    <div className="goal">
      <div className="goal-head">
        <div className="goal-name">{goal.name}</div>
        <div className="goal-amount">
          {formatMoney(progress.current, { compact: true })} /{" "}
          {formatMoney(progress.target, { compact: true })}
        </div>
      </div>

      <div className="bar">
        <div
          className={`bar-fill${progress.done ? " is-done" : ""}`}
          style={{ width: `${Math.round(progress.fraction * 100)}%` }}
        />
      </div>

      <div className="goal-read">
        <Read goal={goal} p={progress} />
      </div>

      <div style={{ marginTop: 10 }}>
        <button className="btn btn-danger btn-sm" onClick={() => onRemove(goal.id)}>
          Remove
        </button>
      </div>
    </div>
  );
}

// The honest read. Note what it does when it doesn't know: it says so, and stops.
// An app that projects a completion date from four hours of data is lying with
// statistics, and the person reading it can't tell.
function Read({ goal, p }: { goal: Goal; p: Progress }) {
  if (p.done) {
    return (
      <span className="on-pace">
        <strong>Done.</strong> You got there.
      </span>
    );
  }

  if (!p.perMonthObserved) {
    if (p.perMonthNeeded) {
      return (
        <>
          Too early to see a trend. To land it on time you'd need{" "}
          <strong>{formatMoney(p.perMonthNeeded)}</strong> a month.
        </>
      );
    }
    return <>Too early to say anything true about your pace. Come back in a few days.</>;
  }

  const pace = <strong>{formatMoney(p.perMonthObserved)}</strong>;

  if (!goal.deadline) {
    return (
      <>
        Moving at {pace} a month.
        {p.projectedAt ? (
          <>
            {" "}
            At that pace you arrive around <strong>{when(p.projectedAt)}</strong>.
          </>
        ) : null}
      </>
    );
  }

  if (p.onPace) {
    return (
      <>
        <span className="on-pace">On pace.</span> You're moving at {pace} a month
        {p.projectedAt ? (
          <>
            , which gets you there around <strong>{when(p.projectedAt)}</strong> — ahead of your{" "}
            {when(goal.deadline)} deadline
          </>
        ) : null}
        . {goal.kind === "spend" ? "You don't need to change anything." : "Keep going."}
      </>
    );
  }

  return (
    <>
      <span className="off-pace">Behind pace.</span> You're moving at {pace} a month
      {p.perMonthNeeded ? (
        <>
          , and hitting {when(goal.deadline)} would take{" "}
          <strong>{formatMoney(p.perMonthNeeded)}</strong> a month
        </>
      ) : null}
      .{" "}
      {goal.kind === "spend"
        ? "Your normal spending won't clear it on its own."
        : "Worth deciding whether to change the pace or move the date — either is a fine answer."}
    </>
  );
}

function when(at: number): string {
  return new Date(at).toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

// ---- new goal -----------------------------------------------------------

export function AddGoal({
  currency,
  accounts,
  valued,
  onAdd,
  onClose,
}: {
  currency: string;
  accounts: Account[];
  valued: AccountValue[];
  onAdd: (content: GoalContent) => Promise<void>;
  onClose: () => void;
}) {
  const [kind, setKind] = useState<GoalKind>("save");
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [deadline, setDeadline] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  function toggle(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!name.trim()) return setError("Give the goal a name.");
    const parsed = parseMoney(target, currency);
    if (!parsed || parsed.minor <= 0) return setError("Set a target amount.");
    if (selected.length === 0) return setError("Pick at least one account to track.");

    // The baseline. Progress is measured from where these accounts stand RIGHT
    // NOW — so a goal is always honest about what it can claim credit for. It
    // cannot retroactively take credit for money you already had, and a spend
    // goal starts from zero rather than from your card's current balance.
    const startValue = goalStartValue({ kind, accountIds: selected }, valued, currency);

    await onAdd({
      name: name.trim(),
      kind,
      target: parsed,
      startValue,
      startAt: Date.now(),
      deadline: deadline ? new Date(deadline).getTime() : undefined,
      accountIds: selected,
    });
    onClose();
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <h3>New goal</h3>

        <div className="choices">
          {(Object.keys(KIND_LABELS) as GoalKind[]).map((k) => (
            <button
              key={k}
              type="button"
              className="choice"
              aria-pressed={kind === k}
              onClick={() => setKind(k)}
            >
              <span className="choice-main">
                <div>{KIND_LABELS[k].label}</div>
                <div style={{ fontSize: 12, color: "var(--ink-faint)", marginTop: 2 }}>
                  {KIND_LABELS[k].blurb}
                </div>
              </span>
            </button>
          ))}
        </div>

        <form onSubmit={submit}>
          {error ? <div className="error">{error}</div> : null}

          <label className="field">
            <span className="label">Name</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={
                kind === "save" ? "Emergency fund" : kind === "payoff" ? "Kill the card" : "Signup bonus"
              }
              autoFocus
            />
          </label>

          <div className="row">
            <label className="field">
              <span className="label">Target</span>
              <input
                type="text"
                inputMode="decimal"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                placeholder="10,000"
              />
            </label>

            <label className="field">
              <span className="label">By when (optional)</span>
              <input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
            </label>
          </div>

          <div className="field">
            <span className="label">Which accounts count toward it?</span>
            {accounts.length === 0 ? (
              <span className="hint">Add an account first — a goal needs something to watch.</span>
            ) : (
              <div className="choices" style={{ marginTop: 6, marginBottom: 0 }}>
                {accounts.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    className="choice"
                    aria-pressed={selected.includes(a.id)}
                    onClick={() => toggle(a.id)}
                  >
                    <span className="choice-main">{a.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="sheet-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary">
              Add goal
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
