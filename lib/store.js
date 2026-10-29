import fs from 'node:fs';
import path from 'node:path';
import { createState } from './seed.js';

/**
 * Tiny JSON store. The dataset is a single person's ledger, so a file is
 * simpler and more transparent than a database. Writes are atomic (tmp + rename)
 * and the previous version is kept as .bak.
 */
export function createStore(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  function persist() {
    const tmp = `${filePath}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    if (fs.existsSync(filePath)) {
      fs.copyFileSync(filePath, `${filePath}.bak`);
    }
    fs.renameSync(tmp, filePath);
  }

  let state;
  if (fs.existsSync(filePath)) {
    const raw = fs.readFileSync(filePath, 'utf8');
    state = JSON.parse(raw);
    if (!state || typeof state !== 'object' || !state.settings) {
      throw new Error(`The data file at ${filePath} is not a valid Khaata store.`);
    }
  } else {
    state = createState();
    persist();
  }

  return {
    get: () => state,
    set: (next) => {
      state = next;
      persist();
    },
    save: () => persist(),
    file: filePath,
  };
}
