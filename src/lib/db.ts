// db.ts
// Local-first storage. Everything lives in IndexedDB, so the dashboard opens
// and works with no network at all.
//
// The shape of every record here follows one rule: anything that says something
// about your money is CIPHERTEXT. What stays in the clear is only the
// bookkeeping the sync engine needs to reconcile records without being able to
// read them — ids, timestamps, tombstones, dirty flags.
//
// Concretely, for an account the server (later) will see: "record abc123 was
// updated at 14:22 and is 400 bytes long." It will not see the bank, the
// balance, the address, or the name. That is the entire security model in one
// sentence, and every store below is built to keep it true.
//
// Stores:
//   - vault:     one record: salt + verifier + the wrapped identity key.
//   - accounts:  one per account. content encrypts { name, kind, source, ... }.
//   - snapshots: one per observation of an account's value at a point in time.
//                This is what makes net worth a *history* and not just a number.
//   - goals:     one per goal. content encrypts { name, target, deadline, ... }.
//   - sync:      pull cursor + auth token. Unused until the sync engine lands.
//   - device:    per-device biometric enrollment. Never synced.

import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { CipherBlob, WrappedKey } from "./crypto";

export const DB_VERSION = 1;

export type VaultMeta = {
  id: "vault";
  salt: number[];
  verifier: CipherBlob;
  createdAt: number;
  iterations: number;
  // The base currency for this vault, chosen at setup. Plaintext: knowing
  // someone thinks in dollars reveals nothing about how many they have, and
  // keeping it readable means the UI can format numbers before unlock.
  currency: string;
  // Identity keypair. Public is plaintext (it's public). Private is wrapped by
  // the vault key, so it rides along to a new device with the passphrase.
  // Nothing uses these yet — see crypto.ts.
  identityPublic?: string;
  identityPrivate?: WrappedKey;
};

// Sync bookkeeping shared by every syncable record. Plaintext, never secret.
type Syncable = {
  id: string;
  createdAt: number;
  updatedAt: number;
  deleted: boolean; // tombstone — a deletion has to be able to propagate
  dirty: boolean; // has local changes not yet pushed
};

// content encrypts an `AccountContent` (see ledger.ts).
export type StoredAccount = Syncable & { content: CipherBlob };

// content encrypts a `SnapshotContent`: the observed value/positions.
//
// `at` is deliberately in the clear so the timeline can sort and window without
// decrypting every record first. The metadata leak is real but small: a server
// would learn THAT you recorded a balance at 3pm, never WHAT it was. Driftless
// made the same call for entry timestamps and flagged it as an explicit
// decision to revisit (its roadmap item 3); the same revisit applies here.
export type StoredSnapshot = Syncable & {
  accountId: string;
  at: number;
  content: CipherBlob;
};

// content encrypts a `GoalContent`.
export type StoredGoal = Syncable & { content: CipherBlob };

export type SyncState = {
  id: "state";
  cursor: number;
  token?: string;
  accountEmail?: string;
};

export type DeviceEnrollment = {
  id: "device";
  credentialId: number[];
  prfSalt: number[];
  wrapped: CipherBlob;
};

interface BallastDB extends DBSchema {
  vault: { key: string; value: VaultMeta };
  accounts: { key: string; value: StoredAccount };
  snapshots: {
    key: string;
    value: StoredSnapshot;
    indexes: { byAccount: string; byTime: number };
  };
  goals: { key: string; value: StoredGoal };
  sync: { key: string; value: SyncState };
  device: { key: string; value: DeviceEnrollment };
}

let dbPromise: Promise<IDBPDatabase<BallastDB>> | null = null;

function db() {
  if (!dbPromise) {
    dbPromise = openDB<BallastDB>("ballast", DB_VERSION, {
      upgrade(database, oldVersion) {
        if (oldVersion < 1) {
          database.createObjectStore("vault", { keyPath: "id" });
          database.createObjectStore("accounts", { keyPath: "id" });
          const snaps = database.createObjectStore("snapshots", { keyPath: "id" });
          snaps.createIndex("byAccount", "accountId");
          snaps.createIndex("byTime", "at");
          database.createObjectStore("goals", { keyPath: "id" });
          database.createObjectStore("sync", { keyPath: "id" });
          database.createObjectStore("device", { keyPath: "id" });
        }
      },
    });
  }
  return dbPromise;
}

// ---- vault ---------------------------------------------------------------

export async function getVault(): Promise<VaultMeta | undefined> {
  return (await db()).get("vault", "vault");
}

export async function saveVault(meta: VaultMeta): Promise<void> {
  await (await db()).put("vault", meta);
}

// ---- accounts ------------------------------------------------------------

export async function allStoredAccounts(): Promise<StoredAccount[]> {
  return (await db()).getAll("accounts");
}

export async function putStoredAccount(a: StoredAccount): Promise<void> {
  await (await db()).put("accounts", a);
}

// ---- snapshots -----------------------------------------------------------

export async function allStoredSnapshots(): Promise<StoredSnapshot[]> {
  return (await db()).getAllFromIndex("snapshots", "byTime");
}

export async function snapshotsForAccount(accountId: string): Promise<StoredSnapshot[]> {
  return (await db()).getAllFromIndex("snapshots", "byAccount", accountId);
}

export async function putStoredSnapshot(s: StoredSnapshot): Promise<void> {
  await (await db()).put("snapshots", s);
}

// ---- goals ---------------------------------------------------------------

export async function allStoredGoals(): Promise<StoredGoal[]> {
  return (await db()).getAll("goals");
}

export async function putStoredGoal(g: StoredGoal): Promise<void> {
  await (await db()).put("goals", g);
}

// ---- sync + device -------------------------------------------------------

export async function getSyncState(): Promise<SyncState | undefined> {
  return (await db()).get("sync", "state");
}

export async function saveSyncState(state: SyncState): Promise<void> {
  await (await db()).put("sync", state);
}

export async function getDevice(): Promise<DeviceEnrollment | undefined> {
  return (await db()).get("device", "device");
}

export async function saveDevice(e: DeviceEnrollment): Promise<void> {
  await (await db()).put("device", e);
}

export async function clearDevice(): Promise<void> {
  await (await db()).delete("device", "device");
}

// Records awaiting upload, including dirty tombstones.
export async function dirtyRecords(): Promise<{
  accounts: StoredAccount[];
  snapshots: StoredSnapshot[];
  goals: StoredGoal[];
}> {
  const d = await db();
  return {
    accounts: (await d.getAll("accounts")).filter((r) => r.dirty),
    snapshots: (await d.getAll("snapshots")).filter((r) => r.dirty),
    goals: (await d.getAll("goals")).filter((r) => r.dirty),
  };
}

// Wipe everything. Used by "forget this device" — the local copy goes, and
// without the passphrase nothing that remains anywhere is readable.
export async function wipe(): Promise<void> {
  const d = await db();
  const tx = d.transaction(["vault", "accounts", "snapshots", "goals", "sync", "device"], "readwrite");
  await Promise.all([
    tx.objectStore("vault").clear(),
    tx.objectStore("accounts").clear(),
    tx.objectStore("snapshots").clear(),
    tx.objectStore("goals").clear(),
    tx.objectStore("sync").clear(),
    tx.objectStore("device").clear(),
  ]);
  await tx.done;
}
