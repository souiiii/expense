import { createHash, randomUUID } from 'node:crypto';

// PostgreSQL JSONB can reorder object keys; array order remains significant.
export function stateHash(state) {
  const canonical = (value) => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
    }
    return value;
  };
  return createHash('sha256').update(JSON.stringify(canonical(state))).digest('hex');
}

class SyncConflict extends Error {}

export function createCloudSync({ store, replica, validate, intervalMs = 60_000, debounceMs = 250, logger = console }) {
  let metadata = store.getSyncMetadata();
  if (!metadata || metadata.target !== replica.target) {
    metadata = {
      version: 1, target: replica.target, remoteRevision: null, syncedHash: null,
      bootstrapHash: store.created ? stateHash(store.get()) : null, pending: null,
    };
    store.setSyncMetadata(metadata);
  }
  let active = null;
  let timer = null;
  let running = false;
  let unsubscribe = null;
  let status = { enabled: true, state: 'pending', lastSyncedAt: null, error: null };

  function report(state, error = null) {
    if (status.state !== state && error) logger.warn(`Cloud sync ${state}: ${error}`);
    status = { ...status, state, error };
  }

  function saveMetadata(next) {
    store.setSyncMetadata(next);
    metadata = next;
  }

  function acknowledge(revision, hash) {
    saveMetadata({ ...metadata, remoteRevision: revision, syncedHash: hash, bootstrapHash: null, pending: null });
  }

  function schedule(delay = debounceMs) {
    if (!running) return;
    clearTimeout(timer);
    timer = setTimeout(() => { void syncNow(); }, delay);
    timer.unref?.();
  }

  async function exchange() {
    const remote = await replica.read();
    const remoteHash = remote ? stateHash(remote.state) : null;

    // If the server committed but the response was lost, acknowledge the exact
    // durable outbox revision rather than inserting/replaying a transaction.
    if (metadata.pending && remote?.revision === metadata.pending.revision && remoteHash === metadata.pending.hash) {
      acknowledge(remote.revision, remoteHash);
    }

    const expectedRevision = metadata.remoteRevision;
    if (metadata.pending) {
      if ((remote?.revision ?? null) !== expectedRevision || (remote && remoteHash !== metadata.syncedHash)) {
        throw new SyncConflict('Local and cloud ledgers have diverged. Both copies are preserved; see README cloud recovery.');
      }
    } else if (remote) {
      const localHash = stateHash(store.get());
      if (remote.revision !== expectedRevision) {
        if (localHash === remoteHash) {
          acknowledge(remote.revision, remoteHash);
        } else if ((metadata.syncedHash !== null && localHash === metadata.syncedHash) ||
                   (metadata.bootstrapHash !== null && localHash === metadata.bootstrapHash)) {
          // Validation is synchronous. Nothing can edit local state between this
          // comparison and the atomic replacement of state + sync bookkeeping.
          validate(structuredClone(remote.state));
          const nextMetadata = { ...metadata, remoteRevision: remote.revision, syncedHash: remoteHash, bootstrapHash: null, pending: null };
          store.set(remote.state, nextMetadata);
          metadata = nextMetadata;
        } else {
          throw new SyncConflict('Local and cloud ledgers have diverged. Both copies are preserved; see README cloud recovery.');
        }
      } else if (remoteHash !== metadata.syncedHash) {
        throw new SyncConflict('The cloud ledger changed without a new revision. Both copies are preserved.');
      }
    } else if (expectedRevision !== null) {
      throw new SyncConflict('The cloud ledger is missing. The local ledger is preserved; see README cloud recovery.');
    }

    if (!metadata.pending && stateHash(store.get()) === metadata.syncedHash) return;

    if (!metadata.pending) {
      const snapshot = structuredClone(store.get());
      const pending = { revision: randomUUID(), hash: stateHash(snapshot), state: snapshot };
      // Outbox and the local ledger are committed together before network I/O.
      saveMetadata({ ...metadata, pending });
    }
    const pending = metadata.pending;
    const written = await replica.write({ baseRevision: metadata.remoteRevision, ...pending });
    if (!written) throw new SyncConflict('Another writer updated the cloud ledger. Both copies are preserved; see README cloud recovery.');
    acknowledge(pending.revision, pending.hash);
  }

  function syncNow() {
    if (active) return active;
    clearTimeout(timer);
    report('syncing');
    active = (async () => {
      try {
        await exchange();
        status.lastSyncedAt = new Date().toISOString();
        report(stateHash(store.get()) === metadata.syncedHash ? 'synced' : 'pending');
      } catch (error) {
        // Driver errors can contain credentials or financial data. Only emit
        // controlled messages, never raw database/network exceptions.
        report(error instanceof SyncConflict ? 'conflict' : 'offline', error instanceof SyncConflict
          ? error.message : 'Cloud sync is unavailable. Changes are saved locally and will retry automatically.');
      } finally {
        active = null;
        schedule(status.state === 'pending' ? debounceMs : intervalMs);
      }
      return getStatus();
    })();
    return active;
  }

  function getStatus() {
    return { ...status, pending: Boolean(metadata.pending) || stateHash(store.get()) !== metadata.syncedHash };
  }

  return {
    getStatus,
    syncNow,
    start() {
      if (running) return;
      running = true;
      unsubscribe = store.subscribe(() => {
        if (!active) report('pending');
        schedule();
      });
      schedule(0);
    },
    async stop() {
      running = false;
      clearTimeout(timer);
      unsubscribe?.();
      await active;
    },
  };
}
