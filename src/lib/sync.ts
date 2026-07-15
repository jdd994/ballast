// sync.ts
// The reconcile engine. Moves ciphertext between the device and the server — it
// never needs the passphrase or the key (that's the design). Pull applies remote
// records last-write-wins by updatedAt; push uploads the dirty set. Ported from
// Driftless, adapted to Ballast's per-kind stores: the extra plaintext a record
// needs (a snapshot's accountId + at, a transaction's at) rides along as opaque
// `meta` the server passes through unread.

import { pushChanges, pullChanges, type SyncRecord } from "./api";
import {
  dirtyRecords, getSyncState, saveSyncState, getStoredByKind, putStoredByKind,
  clearDirtyByKind, type AnyStored, type SyncKind, type StoredAccount,
  type StoredSnapshot, type StoredTransaction, type StoredGoal,
} from "./db";

// Extra non-secret fields a kind keeps outside the ciphertext (so a new device
// can reconstruct the record). content is opaque; meta is opaque-to-the-server.
function metaOf(kind: SyncKind, rec: AnyStored): Record<string, unknown> | undefined {
  if (kind === "snapshot") {
    const s = rec as StoredSnapshot;
    return { accountId: s.accountId, at: s.at };
  }
  if (kind === "transaction") return { at: (rec as StoredTransaction).at };
  return undefined;
}

function toRecord(kind: SyncKind, rec: AnyStored): SyncRecord {
  return {
    kind, id: rec.id, createdAt: rec.createdAt, updatedAt: rec.updatedAt,
    deleted: rec.deleted, content: rec.content, meta: metaOf(kind, rec),
  };
}

// Rebuild a stored record from a pulled one (dirty:false — it came from the
// server, nothing to push back).
function fromRecord(rec: SyncRecord): AnyStored {
  const base = {
    id: rec.id, createdAt: rec.createdAt, updatedAt: rec.updatedAt,
    deleted: rec.deleted, dirty: false, content: rec.content,
  };
  const m = rec.meta ?? {};
  if (rec.kind === "snapshot") {
    return { ...base, accountId: String(m.accountId ?? ""), at: Number(m.at ?? rec.createdAt) } as StoredSnapshot;
  }
  if (rec.kind === "transaction") {
    return { ...base, at: Number(m.at ?? rec.createdAt) } as StoredTransaction;
  }
  return base as StoredAccount | StoredGoal;
}

// Apply one remote record locally, last-write-wins. Returns true if it changed
// anything (so the caller re-decrypts the view).
async function applyRemote(rec: SyncRecord): Promise<boolean> {
  const local = await getStoredByKind(rec.kind, rec.id);
  if (local && rec.updatedAt <= local.updatedAt) return false;
  await putStoredByKind(rec.kind, fromRecord(rec));
  return true;
}

// Pull everything past the cursor, apply it, advance the cursor.
export async function pull(token: string): Promise<boolean> {
  const st = await getSyncState();
  let cursor = st?.cursor ?? 0;
  let changed = false;
  for (;;) {
    const res = await pullChanges(token, cursor);
    for (const rec of res.changes) if (await applyRemote(rec)) changed = true;
    cursor = res.cursor;
    if (!res.more) break;
  }
  await saveSyncState({ ...(st ?? { id: "state" }), id: "state", cursor, token });
  return changed;
}

// Upload the dirty set, then clear the flags.
export async function push(token: string): Promise<void> {
  const dirty = await dirtyRecords();
  const changes: SyncRecord[] = [
    ...dirty.accounts.map((r) => toRecord("account", r)),
    ...dirty.snapshots.map((r) => toRecord("snapshot", r)),
    ...dirty.transactions.map((r) => toRecord("transaction", r)),
    ...dirty.goals.map((r) => toRecord("goal", r)),
  ];
  if (changes.length === 0) return;
  for (let i = 0; i < changes.length; i += 500) {
    await pushChanges(token, changes.slice(i, i + 500));
  }
  for (const ch of changes) await clearDirtyByKind(ch.kind, ch.id, ch.updatedAt);
}

// Full sync: pull first (others' changes), then push local dirty. Returns true
// if the pull changed local data (caller should re-decrypt the view).
export async function syncNow(token: string): Promise<boolean> {
  const changed = await pull(token);
  await push(token);
  return changed;
}
