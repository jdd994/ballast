// sync.test.ts
// The reconcile engine, exercised as two devices sharing one account. The
// network is mocked with a tiny in-memory "server" that behaves like the real
// one (LWW upsert, monotonic seq, pull-by-cursor); the local store is a real
// IndexedDB via fake-indexeddb. So this tests the actual push/pull/LWW code
// against real persistence, without touching the wire.

import "fake-indexeddb/auto";
import { openDB } from "idb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CipherBlob } from "./crypto";

// ---- the fake server (shared across "devices") ---------------------------

type Row = {
  kind: string; id: string; createdAt: number; updatedAt: number;
  deleted: boolean; content: CipherBlob; meta?: Record<string, unknown>; seq: number;
};
const server: { rows: Row[]; seq: number } = { rows: [], seq: 0 };

vi.mock("./api", () => ({
  pushChanges: async (_t: string, changes: Omit<Row, "seq">[]) => {
    for (const ch of changes) {
      const existing = server.rows.find((r) => r.kind === ch.kind && r.id === ch.id);
      if (existing && ch.updatedAt < existing.updatedAt) continue; // LWW, like the real UPSERT
      const seq = ++server.seq;
      if (existing) Object.assign(existing, ch, { seq });
      else server.rows.push({ ...ch, seq });
    }
    return { applied: changes.length, cursor: server.seq };
  },
  pullChanges: async (_t: string, since: number) => {
    const rows = server.rows.filter((r) => r.seq > since).sort((a, b) => a.seq - b.seq);
    const changes = rows.map(({ seq, ...rest }) => { void seq; return rest; });
    return { changes, cursor: rows.length ? rows[rows.length - 1].seq : since, more: false };
  },
}));

const blob = (n: number): CipherBlob => ({ iv: [n], data: [n, n] });

// A fresh device = the same real DB with every synced store (and the cursor)
// cleared. The module-level db handle in db.ts sees the clears immediately.
async function wipeLocal() {
  const raw = await openDB("ballast", 2);
  for (const s of ["accounts", "snapshots", "transactions", "goals", "sync"]) {
    if (raw.objectStoreNames.contains(s)) await raw.clear(s);
  }
  raw.close();
}

describe("sync reconcile engine", () => {
  beforeEach(async () => {
    server.rows = [];
    server.seq = 0;
    // Touch the db so it's created, then wipe to a clean slate.
    const db = await import("./db");
    await db.putStoredAccount({ id: "warm", createdAt: 0, updatedAt: 0, deleted: false, dirty: false, content: blob(0) });
    await wipeLocal();
  });

  it("pushes the dirty set and clears the flags", async () => {
    const db = await import("./db");
    const { push } = await import("./sync");

    await db.putStoredAccount({ id: "acc-1", createdAt: 1, updatedAt: 1, deleted: false, dirty: true, content: blob(1) });
    await db.putStoredSnapshot({ id: "snap-1", accountId: "acc-1", at: 1234, createdAt: 2, updatedAt: 2, deleted: false, dirty: true, content: blob(2) });

    await push("t");

    // The server received both, and the snapshot's plaintext bookkeeping rode
    // along as meta.
    expect(server.rows).toHaveLength(2);
    const snap = server.rows.find((r) => r.kind === "snapshot")!;
    expect(snap.meta).toEqual({ accountId: "acc-1", at: 1234 });

    // Locally, nothing is dirty anymore.
    const acc = (await db.allStoredAccounts()).find((a) => a.id === "acc-1")!;
    expect(acc.dirty).toBe(false);
  });

  it("materializes a second device's records from a pull, reconstructing meta", async () => {
    const db = await import("./db");
    const { push, pull } = await import("./sync");

    // Device A publishes.
    await db.putStoredAccount({ id: "acc-1", createdAt: 1, updatedAt: 1, deleted: false, dirty: true, content: blob(1) });
    await db.putStoredSnapshot({ id: "snap-1", accountId: "acc-1", at: 1234, createdAt: 2, updatedAt: 2, deleted: false, dirty: true, content: blob(2) });
    await push("t");

    // Device B: fresh local store, pulls from seq 0.
    await wipeLocal();
    const changed = await pull("t");
    expect(changed).toBe(true);

    const acc = (await db.allStoredAccounts()).find((a) => a.id === "acc-1")!;
    expect(acc).toBeTruthy();
    expect(acc.dirty).toBe(false);
    expect(acc.content).toEqual(blob(1));

    const snap = (await db.allStoredSnapshots()).find((s) => s.id === "snap-1")!;
    expect(snap.accountId).toBe("acc-1"); // reconstructed from meta
    expect(snap.at).toBe(1234);

    // The cursor advanced, so a second pull is a no-op.
    expect(await pull("t")).toBe(false);
  });

  it("keeps the newer record on conflict (last-write-wins by updatedAt)", async () => {
    const db = await import("./db");
    const { pull } = await import("./sync");

    // Server holds an OLD version of acc-1.
    server.rows.push({ kind: "account", id: "acc-1", createdAt: 1, updatedAt: 1, deleted: false, content: blob(1), seq: ++server.seq });

    // Locally we already have a NEWER version (e.g. just edited here).
    await db.putStoredAccount({ id: "acc-1", createdAt: 1, updatedAt: 1000, deleted: false, dirty: false, content: blob(9) });

    const changed = await pull("t");
    expect(changed).toBe(false); // the older remote must not clobber us

    const acc = (await db.allStoredAccounts()).find((a) => a.id === "acc-1")!;
    expect(acc.updatedAt).toBe(1000);
    expect(acc.content).toEqual(blob(9));
  });

  it("propagates a tombstone through sync", async () => {
    const db = await import("./db");
    const { push, pull } = await import("./sync");

    await db.putStoredGoal({ id: "g-1", createdAt: 1, updatedAt: 1, deleted: false, dirty: true, content: blob(1) });
    await push("t");

    // The goal is deleted on this device and pushed as a tombstone.
    await db.putStoredGoal({ id: "g-1", createdAt: 1, updatedAt: 2, deleted: true, dirty: true, content: blob(1) });
    await push("t");

    // A second device pulls and sees the deletion.
    await wipeLocal();
    await pull("t");
    const goals = await db.allStoredGoals();
    const g = goals.find((x) => x.id === "g-1")!;
    expect(g.deleted).toBe(true);
  });
});
