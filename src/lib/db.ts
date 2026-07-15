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
//   - vault:        one record: salt + verifier + the wrapped identity key.
//   - accounts:     one per account. content encrypts { name, kind, source, ... }.
//   - snapshots:    one per observation of an account's value at a point in time.
//                   This is what makes net worth a *history*, not just a number.
//   - transactions: one per expense/income. content encrypts amount, merchant,
//                   category, note.
//   - media:        encrypted receipt photos, as raw bytes.
//   - memory:       the merchant -> category memory the categoriser learns. It is
//                   encrypted like everything else: what you buy and where is at
//                   least as revealing as how much.
//   - goals:        one per goal.
//   - sync:         pull cursor + auth token. Unused until the sync engine lands.
//   - device:       per-device biometric enrollment. Never synced.

import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { CipherBlob, WrappedKey } from "./crypto";

export const DB_VERSION = 2;

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
  // Envelope encryption: the random data key (DEK) wrapped by the passphrase-
  // derived KEK. Present on vaults created/migrated under the envelope model;
  // ABSENT on older vaults (key derived straight from the passphrase) — those
  // migrate on first unlock. Changing the passphrase re-wraps this without
  // re-encrypting any data. See crypto.ts wrapVaultKey.
  wrappedDEK?: CipherBlob;
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

// content encrypts a `TransactionContent`. `at` is plaintext for the same reason
// snapshots' is: cheap windowing without decrypting the whole ledger.
export type StoredTransaction = Syncable & {
  at: number;
  content: CipherBlob;
};

// A receipt photo. Stored as encrypted raw bytes — IndexedDB holds ArrayBuffers
// efficiently, so images don't go through the number[] shape small text blobs use.
//
// `type` (image/jpeg) is plaintext and harmless. The pixels are not: a receipt
// names the merchant, the items, the time, and often the last four of your card.
// It is ciphertext at rest and it never touches the network. See receipt.ts for
// why there is no OCR service in this picture.
export type StoredMedia = {
  id: string;
  type: string;
  createdAt: number;
  iv: Uint8Array;
  data: ArrayBuffer; // ciphertext
  deleted: boolean;
  dirty: boolean;
};

// The categoriser's learned memory. One record, encrypted.
export type StoredMemory = {
  id: "memory";
  updatedAt: number;
  dirty: boolean;
  content: CipherBlob; // encrypts a MerchantMemory
};

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
  transactions: { key: string; value: StoredTransaction; indexes: { byTime: number } };
  media: { key: string; value: StoredMedia };
  memory: { key: string; value: StoredMemory };
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
        // v2: spend tracking — transactions, receipt photos, and the memory the
        // categoriser builds.
        if (oldVersion < 2) {
          const txns = database.createObjectStore("transactions", { keyPath: "id" });
          txns.createIndex("byTime", "at");
          database.createObjectStore("media", { keyPath: "id" });
          database.createObjectStore("memory", { keyPath: "id" });
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

// ---- transactions --------------------------------------------------------

export async function allStoredTransactions(): Promise<StoredTransaction[]> {
  return (await db()).getAllFromIndex("transactions", "byTime");
}

export async function putStoredTransaction(t: StoredTransaction): Promise<void> {
  await (await db()).put("transactions", t);
}

// ---- media (receipt photos) ----------------------------------------------

export async function putMedia(m: StoredMedia): Promise<void> {
  await (await db()).put("media", m);
}

export async function getMedia(id: string): Promise<StoredMedia | undefined> {
  return (await db()).get("media", id);
}

export async function deleteMedia(id: string): Promise<void> {
  await (await db()).delete("media", id);
}

// ---- the categoriser's memory --------------------------------------------

export async function getStoredMemory(): Promise<StoredMemory | undefined> {
  return (await db()).get("memory", "memory");
}

export async function saveStoredMemory(m: StoredMemory): Promise<void> {
  await (await db()).put("memory", m);
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
  transactions: StoredTransaction[];
  goals: StoredGoal[];
  media: StoredMedia[];
}> {
  const d = await db();
  return {
    accounts: (await d.getAll("accounts")).filter((r) => r.dirty),
    snapshots: (await d.getAll("snapshots")).filter((r) => r.dirty),
    transactions: (await d.getAll("transactions")).filter((r) => r.dirty),
    goals: (await d.getAll("goals")).filter((r) => r.dirty),
    media: (await d.getAll("media")).filter((r) => r.dirty && !r.deleted),
  };
}

// ---- generic sync accessors ---------------------------------------------
// The sync engine treats the four syncable object stores uniformly (a kind + an
// id). These map a kind to its store and give get/put/clear-dirty/mark-all by
// kind, so lib/sync.ts stays small. (media + memory are not synced in v1.)

export type SyncKind = "account" | "snapshot" | "transaction" | "goal";
export type AnyStored = StoredAccount | StoredSnapshot | StoredTransaction | StoredGoal;
const KIND_STORE: Record<SyncKind, "accounts" | "snapshots" | "transactions" | "goals"> = {
  account: "accounts", snapshot: "snapshots", transaction: "transactions", goal: "goals",
};
export const SYNC_KINDS: SyncKind[] = ["account", "snapshot", "transaction", "goal"];

export async function getStoredByKind(kind: SyncKind, id: string): Promise<AnyStored | undefined> {
  return (await db()).get(KIND_STORE[kind], id) as Promise<AnyStored | undefined>;
}
export async function putStoredByKind(kind: SyncKind, rec: AnyStored): Promise<void> {
  // idb's types are per-literal-store; the runtime store is chosen by kind.
  await (await db()).put(KIND_STORE[kind], rec as never);
}
// Clear the dirty flag after a successful push — only if the record hasn't
// changed since (updatedAt still matches), so a mid-sync edit is never dropped.
export async function clearDirtyByKind(kind: SyncKind, id: string, updatedAt: number): Promise<void> {
  const d = await db();
  const rec = await d.get(KIND_STORE[kind], id);
  if (rec && rec.dirty && rec.updatedAt === updatedAt) await d.put(KIND_STORE[kind], { ...rec, dirty: false } as never);
}
// Mark every syncable record dirty — used when connecting a NEW account, so the
// whole local vault uploads even if it was previously synced elsewhere.
export async function markAllDirty(): Promise<void> {
  const d = await db();
  for (const kind of SYNC_KINDS) {
    const store = KIND_STORE[kind];
    for (const r of await d.getAll(store)) if (!r.dirty) await d.put(store, { ...r, dirty: true } as never);
  }
}

// Every store, in one place. Both `wipe` and any future migration must cover all
// of them — a "wipe" that leaves receipt photos behind would be a serious lie.
const ALL_STORES = [
  "vault",
  "accounts",
  "snapshots",
  "transactions",
  "media",
  "memory",
  "goals",
  "sync",
  "device",
] as const;

// Wipe everything. Used by "forget this device" — the local copy goes, and
// without the passphrase nothing that remains anywhere is readable anyway.
export async function wipe(): Promise<void> {
  const d = await db();
  const tx = d.transaction(ALL_STORES, "readwrite");
  await Promise.all(ALL_STORES.map((s) => tx.objectStore(s).clear()));
  await tx.done;
}
