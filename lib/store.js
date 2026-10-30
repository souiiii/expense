import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createState } from './seed.js';

/**
 * Local ledger and durable cloud-sync outbox. Writes are atomic (tmp + rename)
 * and the previous version is kept as .bak. Sync bookkeeping stays out of the
 * domain state and exported backups.
 */
export function createStore(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const created = !fs.existsSync(filePath);
  const listeners = new Set();
  let syncMetadata = null;

  function persist(backup = true) {
    const tmp = `${filePath}.tmp`;
    const document = syncMetadata ? { ...state, _cloudSync: syncMetadata } : state;
    fs.writeFileSync(tmp, `${JSON.stringify(document, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    if (backup && fs.existsSync(filePath)) {
      fs.copyFileSync(filePath, `${filePath}.bak`);
    }
    fs.renameSync(tmp, filePath);
  }

  function parse(raw, label) {
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(`${label} is not valid JSON.`);
    }
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      !parsed.settings ||
      !Number.isSafeInteger(parsed.settings.monthlyIncomePaise) ||
      parsed.settings.monthlyIncomePaise < 1 ||
      !Number.isSafeInteger(parsed.settings.openingBalancePaise) ||
      parsed.settings.openingBalancePaise < 0 ||
      !Array.isArray(parsed.categories) ||
      !Array.isArray(parsed.transactions)
    ) {
      throw new Error(`${label} is not a valid Khaata store.`);
    }
    parsed.version = parsed.version ?? 1;
    parsed.allocations = Array.isArray(parsed.allocations) ? parsed.allocations : [];
    parsed.moves = Array.isArray(parsed.moves) ? parsed.moves : [];
    if (!parsed.settings.ingestToken) {
      parsed.settings.ingestToken = randomUUID().replace(/-/g, '');
    }
    syncMetadata = parsed._cloudSync ?? null;
    delete parsed._cloudSync;
    return parsed;
  }

  let state;
  if (fs.existsSync(filePath)) {
    const raw = fs.readFileSync(filePath, 'utf8');
    try {
      state = parse(raw, `The data file at ${filePath}`);
    } catch (error) {
      const backupPath = `${filePath}.bak`;
      if (!fs.existsSync(backupPath)) {
        throw new Error(
          `${error.message} No backup was found. Restore from a downloaded backup or start with an empty data file.`
        );
      }
      const backupRaw = fs.readFileSync(backupPath, 'utf8');
      state = parse(backupRaw, `The backup at ${backupPath}`);
      fs.copyFileSync(filePath, `${filePath}.corrupt`);
      const tmp = `${filePath}.recover`;
      const document = syncMetadata ? { ...state, _cloudSync: syncMetadata } : state;
      fs.writeFileSync(tmp, `${JSON.stringify(document, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
      fs.renameSync(tmp, filePath);
      console.warn(`Recovered ${filePath} from ${backupPath}. The damaged file is ${filePath}.corrupt.`);
    }
  } else {
    state = createState();
    persist();
  }

  return {
    get: () => state,
    set: (next, metadata = syncMetadata) => {
      const previous = state;
      const previousMetadata = syncMetadata;
      const { _cloudSync, ...ledger } = next;
      state = ledger;
      syncMetadata = metadata;
      try { persist(); } catch (error) {
        state = previous;
        syncMetadata = previousMetadata;
        throw error;
      }
      for (const listener of listeners) listener();
    },
    save: () => {
      persist();
      for (const listener of listeners) listener();
    },
    getSyncMetadata: () => structuredClone(syncMetadata),
    setSyncMetadata: (metadata) => {
      const previous = syncMetadata;
      syncMetadata = structuredClone(metadata);
      try { persist(false); } catch (error) { syncMetadata = previous; throw error; }
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    created,
    file: filePath,
  };
}
