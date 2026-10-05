// The browser's recovery keys (VAULT-MESSAGING §11.11.2, MEMBER-API "Vault
// recovery"): one P-256 key pair per recovery, made with WebCrypto as
// NON-extractable and kept in IndexedDB, so the private key can be used by
// this site in this browser profile but never read out, not even by this
// code. The enclave seals the recovery code to its public half.
//
// Records: { id, vault_id, recovery_id, privateKey, browser_key, created_at }
//  - before the request is answered, id = 'pending:<random>' and
//    recovery_id = null (the API assigns the recovery_id); bound to the
//    recovery_id once the API answers. A request whose answer was lost
//    leaves an unbound key, which the status page tries when it opens the
//    code (only the right key opens it: AES-GCM).
//  - deleted once their recovery is over (see prune()).
// This is the only IndexedDB this site uses; nothing else is stored.

const DB_NAME = 'vettid-vault-recovery';
const STORE = 'keys';

function openDb() {
  return new Promise((resolve, reject) => {
    let req;
    try {
      req = indexedDB.open(DB_NAME, 1);
    } catch (e) {
      reject(e);
      return;
    }
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB unavailable'));
    req.onblocked = () => reject(new Error('IndexedDB blocked'));
  });
}

async function withStore(mode, fn) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const store = tx.objectStore(STORE);
      let result;
      Promise.resolve(fn(store)).then((r) => {
        result = r;
      }, reject);
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
    });
  } finally {
    db.close();
  }
}

const req2p = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

/** True if this browser can make and keep a recovery key (WebCrypto + IndexedDB). */
export async function supported() {
  if (!globalThis.crypto?.subtle || !globalThis.indexedDB) return false;
  try {
    await withStore('readonly', (s) => req2p(s.count()));
    return true;
  } catch {
    return false;
  }
}

export function allKeys() {
  return withStore('readonly', (s) => req2p(s.getAll()));
}

export async function keyFor(recoveryId) {
  return (await withStore('readonly', (s) => req2p(s.get(recoveryId)))) ?? null;
}

function randomId() {
  return [...globalThis.crypto.getRandomValues(new Uint8Array(12))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Make and store a new unbound key pair for a recovery of `vaultId`. */
export async function createKey(vaultId) {
  const pair = await globalThis.crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
  if (pair.privateKey.extractable) throw new Error('private key must not be extractable');
  const browserKey = new Uint8Array(await globalThis.crypto.subtle.exportKey('raw', pair.publicKey));
  const rec = { id: `pending:${randomId()}`, vault_id: vaultId, recovery_id: null, privateKey: pair.privateKey, browser_key: browserKey, created_at: Date.now() };
  await withStore('readwrite', (s) => req2p(s.put(rec)));
  // Ask the browser not to evict this site's storage under pressure; the
  // key must live for up to 48 hours. Best effort; the answer is not needed.
  try {
    await navigator.storage?.persist?.();
  } catch {
    /* ignore */
  }
  return rec;
}

/** Bind an unbound key to the recovery the API created with it. */
export async function bindKey(rec, recoveryId) {
  const bound = { ...rec, id: recoveryId, recovery_id: recoveryId };
  await withStore('readwrite', (s) => {
    s.put(bound);
    if (rec.id !== recoveryId) s.delete(rec.id);
  });
  return bound;
}

export function deleteKey(id) {
  return withStore('readwrite', (s) => req2p(s.delete(id)));
}

/**
 * Drop the keys no recovery needs any more. `active` is the recovery that is
 * pending or available ({recovery_id, requested_at}) or null.
 * Kept: its bound key, and unbound keys made shortly before it was
 * requested (one of them may be its key, if the API's answer was lost).
 */
export async function prune(active) {
  let recs;
  try {
    recs = await allKeys();
  } catch {
    return;
  }
  const since = active ? Date.parse(active.requested_at) - 10 * 60 * 1000 : Infinity;
  const drop = recs.filter((r) => {
    if (!active) return true;
    if (r.recovery_id) return r.recovery_id !== active.recovery_id;
    return !(r.created_at >= since);
  });
  if (!drop.length) return;
  await withStore('readwrite', (s) => {
    for (const r of drop) s.delete(r.id);
  }).catch(() => {});
}

/** The keys that may open `recoveryId`'s code: its bound key first, then unbound ones of the vault. */
export async function candidates(recoveryId, vaultId) {
  const recs = await allKeys();
  const bound = recs.filter((r) => r.recovery_id === recoveryId);
  const unbound = recs.filter((r) => !r.recovery_id && r.vault_id === vaultId).sort((a, b) => b.created_at - a.created_at);
  return [...bound, ...unbound];
}
