// api.ts
// Thin client for the Ballast sync server. It only ever sends/receives opaque
// ciphertext + non-secret metadata — never the passphrase or the key. The auth
// token is separate from the encryption passphrase (invariant #5).

import type { CipherBlob, WrappedKey } from "./crypto";

const API_BASE = "https://ballast-server.jdd994.workers.dev";

export type VaultMetaDTO = {
  salt: number[];
  verifier: CipherBlob;
  iterations?: number;
  identityPrivWrapped?: WrappedKey | null;
  // Base display currency — plaintext, non-secret. Travels with the vault so a
  // new device labels money in the right units before there's anything to sync.
  currency?: string | null;
  // Envelope encryption: the DEK wrapped by the passphrase-derived KEK. Opaque —
  // the server stores/returns it, never reads it. Absent for legacy vaults.
  wrappedDEK?: CipherBlob | null;
};

// A record on the wire: opaque content + optional non-secret `meta` (a snapshot's
// accountId + at, a transaction's at) the server passes through unread.
export type SyncRecord = {
  kind: "account" | "snapshot" | "transaction" | "goal";
  id: string;
  createdAt: number;
  updatedAt: number;
  deleted: boolean;
  content: CipherBlob;
  meta?: Record<string, unknown>;
};

async function req(path: string, opts: { method?: string; token?: string; body?: unknown } = {}): Promise<any> {
  const res = await fetch(API_BASE + path, {
    method: opts.method ?? "GET",
    headers: {
      ...(opts.body ? { "Content-Type": "application/json" } : {}),
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status}).`);
  return data;
}

export function register(
  email: string,
  password: string,
  vault: VaultMetaDTO,
  identityPublicKey: string,
  identityPrivWrapped: WrappedKey
): Promise<{ token: string; userId: string }> {
  return req("/auth/register", {
    method: "POST",
    body: { email, password, vault, identityPublicKey, identityPrivWrapped },
  });
}

export function login(email: string, password: string): Promise<{ token: string; userId: string }> {
  return req("/auth/login", { method: "POST", body: { email, password } });
}

export function fetchVault(token: string): Promise<VaultMetaDTO> {
  return req("/vault", { token });
}

// Permanently delete the account and every blob the server holds for it. Local
// data on the device is untouched. Irreversible.
export function deleteAccount(token: string): Promise<{ ok: boolean }> {
  return req("/me", { method: "DELETE", token });
}

// Update the vault after a passphrase change: new salt, verifier, re-wrapped DEK.
// Envelope-only — the object ciphertext is untouched (the DEK didn't change), so
// no re-upload is needed; another device just needs the new wrap to unlock.
export function updateVault(
  token: string,
  vault: { salt: number[]; verifier: CipherBlob; iterations?: number; wrappedDEK: CipherBlob }
): Promise<{ ok: boolean }> {
  return req("/vault", { method: "PUT", token, body: vault });
}

export function pushChanges(token: string, changes: SyncRecord[]): Promise<{ applied: number; cursor: number }> {
  return req("/sync/push", { method: "POST", token, body: { changes } });
}

export function pullChanges(
  token: string,
  since: number
): Promise<{ changes: SyncRecord[]; cursor: number; more: boolean }> {
  return req(`/sync/pull?since=${since}`, { token });
}
