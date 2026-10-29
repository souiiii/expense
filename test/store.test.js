import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../lib/store.js';
import { createState } from '../lib/seed.js';

test('store creates a fresh file and recovers a damaged file from .bak', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'khaata-store-'));
  const file = path.join(dir, 'store.json');

  const store = createStore(file);
  const state = createState({ onboarded: true });
  state.settings.ingestToken = 'backup-token';
  store.set(state);
  store.save(); // now .bak also contains the marker
  assert.equal(JSON.parse(fs.readFileSync(`${file}.bak`, 'utf8')).settings.ingestToken, 'backup-token');

  fs.writeFileSync(file, '{ this is not json', 'utf8');
  const recovered = createStore(file);
  assert.equal(recovered.get().settings.ingestToken, 'backup-token');
  assert.equal(fs.existsSync(`${file}.corrupt`), true);
  assert.doesNotThrow(() => JSON.parse(fs.readFileSync(file, 'utf8')));

  fs.rmSync(dir, { recursive: true, force: true });
});

test('store fails clearly when the file is damaged and there is no backup', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'khaata-store-'));
  const file = path.join(dir, 'store.json');
  fs.writeFileSync(file, 'not json', 'utf8');

  assert.throws(() => createStore(file), /No backup was found/);

  fs.rmSync(dir, { recursive: true, force: true });
});
