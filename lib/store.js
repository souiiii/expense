import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
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
      fs.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
      fs.renameSync(tmp, filePath);
      console.warn(`Recovered ${filePath} from ${backupPath}. The damaged file is ${filePath}.corrupt.`);
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
