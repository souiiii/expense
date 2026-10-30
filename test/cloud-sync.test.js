import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createStore } from '../lib/store.js';
import { createCloudSync, stateHash } from '../lib/cloud-sync.js';
import { createState } from '../lib/seed.js';

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'khaata-cloud-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'store.json');
  const store = createStore(file);
  let row = null;
  let unavailable = false;
  let loseResponse = false;
  let writes = 0;
  const warnings = [];
  const replica = {
    target: 'test-database',
    async read() {
      if (unavailable) throw new Error('SECRET_CONNECTION_STRING');
      return structuredClone(row);
    },
    async write({ baseRevision, revision, state }) {
      if (unavailable) throw new Error('SECRET_CONNECTION_STRING');
      if ((row?.revision ?? null) !== baseRevision) return false;
      row = { revision, state: structuredClone(state) };
      writes++;
      if (loseResponse) { loseResponse = false; throw new Error('lost response'); }
      return true;
    },
  };
  function syncFor(localStore = store, options = {}) {
    return createCloudSync({ store: localStore, replica, validate(state) {
      assert.ok(state.settings);
      assert.ok(Array.isArray(state.transactions));
    }, logger: { warn: message => warnings.push(message) }, ...options });
  }
  function change(localStore = store, income = 5432100) {
    const next = structuredClone(localStore.get());
    next.settings.monthlyIncomePaise = income;
    localStore.set(next);
    return next;
  }
  return {
    store, file, replica, syncFor, change, warnings,
    get row() { return row; },
    set row(value) { row = structuredClone(value); },
    set unavailable(value) { unavailable = value; },
    set loseResponse(value) { loseResponse = value; },
    get writes() { return writes; },
  };
}

test('cloud storage round-trips the complete ledger without recalculating it', async t => {
  const f = fixture(t);
  const original = structuredClone(f.store.get());
  const sync = f.syncFor();
  await sync.syncNow();
  assert.deepEqual(f.row.state, original);
  assert.deepEqual(f.store.get(), original);
  assert.equal(sync.getStatus().state, 'synced');
  assert.equal(sync.getStatus().pending, false);
  await sync.syncNow();
  assert.equal(f.writes, 1, 'unchanged ledger is not uploaded again');
});

test('local saves and API-equivalent reads do not wait for a stalled cloud request', async t => {
  const f = fixture(t);
  const read = f.replica.read;
  let release;
  f.replica.read = () => new Promise(resolve => { release = resolve; });
  const sync = f.syncFor();
  const inFlight = sync.syncNow();
  const changed = f.change();
  assert.deepEqual(f.store.get(), changed);
  assert.equal(JSON.parse(fs.readFileSync(f.file)).settings.monthlyIncomePaise, 5432100);
  release(null);
  await inFlight;
  assert.deepEqual(f.row.state, changed);
  f.replica.read = read;
});

test('offline changes survive restart, retry safely, and never log driver secrets', async t => {
  const f = fixture(t);
  let sync = f.syncFor();
  await sync.syncNow();
  const changed = f.change();
  f.unavailable = true;
  await sync.syncNow();
  assert.equal(sync.getStatus().state, 'offline');
  assert.equal(sync.getStatus().pending, true);
  assert.ok(!JSON.stringify(f.warnings).includes('SECRET_CONNECTION_STRING'));
  const reopened = createStore(f.file);
  assert.deepEqual(reopened.get(), changed);
  sync = f.syncFor(reopened);
  f.unavailable = false;
  await sync.syncNow();
  assert.deepEqual(f.row.state, changed);
  assert.equal(sync.getStatus().pending, false);
});

test('a lost upload response is acknowledged after restart without duplicate writes', async t => {
  const f = fixture(t);
  const sync = f.syncFor();
  f.loseResponse = true;
  await sync.syncNow();
  assert.equal(sync.getStatus().state, 'offline');
  assert.ok(f.store.getSyncMetadata().pending);
  const reopened = createStore(f.file);
  const latest = f.change(reopened);
  const restarted = f.syncFor(reopened);
  await restarted.syncNow();
  assert.equal(f.writes, 2, 'one original upload and one newer snapshot');
  assert.deepEqual(f.row.state, latest);
  assert.equal(restarted.getStatus().state, 'synced');
});

test('edits made during an upload remain pending and are included in the next snapshot', async t => {
  const f = fixture(t);
  const write = f.replica.write;
  let release;
  f.replica.write = input => new Promise(resolve => { release = async () => resolve(await write(input)); });
  const sync = f.syncFor();
  const inFlight = sync.syncNow();
  while (!release) await new Promise(resolve => setImmediate(resolve));
  const changed = f.change();
  await release();
  await inFlight;
  assert.equal(sync.getStatus().pending, true);
  assert.deepEqual(f.store.get(), changed);
  f.replica.write = write;
  await sync.syncNow();
  assert.deepEqual(f.row.state, changed);
});

test('an outbox that was not sent is retried before newer local edits', async t => {
  const f = fixture(t);
  const write = f.replica.write;
  f.replica.write = async () => { throw new Error('offline'); };
  const sync = f.syncFor();
  const original = structuredClone(f.store.get());
  await sync.syncNow();
  const reopened = createStore(f.file);
  const changed = f.change(reopened);
  f.replica.write = write;
  const restarted = f.syncFor(reopened);
  await restarted.syncNow();
  assert.deepEqual(f.row.state, original);
  assert.equal(restarted.getStatus().pending, true);
  await restarted.syncNow();
  assert.deepEqual(f.row.state, changed);
});

test('a new empty installation downloads cloud data, including after an offline restart', async t => {
  const f = fixture(t);
  const cloud = createState({ monthlyIncomePaise: 8765432, onboarded: true });
  f.row = { revision: randomUUID(), state: cloud };
  let sync = f.syncFor();
  f.unavailable = true;
  await sync.syncNow();
  const reopened = createStore(f.file);
  sync = f.syncFor(reopened);
  f.unavailable = false;
  await sync.syncNow();
  assert.deepEqual(reopened.get(), cloud);
  assert.equal(f.writes, 0);
});

test('existing local data and first-use edits are never overwritten by an unrelated cloud ledger', async t => {
  const f = fixture(t);
  const local = f.change();
  f.row = { revision: randomUUID(), state: createState({ monthlyIncomePaise: 8765432 }) };
  const remote = structuredClone(f.row);
  const sync = f.syncFor(createStore(f.file));
  await sync.syncNow();
  assert.equal(sync.getStatus().state, 'conflict');
  assert.deepEqual(f.store.get(), local);
  assert.deepEqual(f.row, remote);
  assert.equal(f.writes, 0);
});

test('cloud changes are downloaded only when the local ledger has no pending edits', async t => {
  const f = fixture(t);
  const sync = f.syncFor();
  await sync.syncNow();
  const remote = structuredClone(f.row.state);
  remote.settings.monthlyIncomePaise = 7654321;
  f.row = { revision: randomUUID(), state: remote };
  await sync.syncNow();
  assert.deepEqual(f.store.get(), remote);
  f.change();
  const nextRemote = structuredClone(remote);
  nextRemote.settings.monthlyIncomePaise = 1234567;
  f.row = { revision: randomUUID(), state: nextRemote };
  await sync.syncNow();
  assert.equal(sync.getStatus().state, 'conflict');
  assert.equal(f.store.get().settings.monthlyIncomePaise, 5432100);
  assert.equal(f.row.state.settings.monthlyIncomePaise, 1234567);
});

test('a racing cloud writer cannot be overwritten by a stale local snapshot', async t => {
  const f = fixture(t);
  const sync = f.syncFor();
  await sync.syncNow();
  f.change();
  const write = f.replica.write;
  const remote = { revision: randomUUID(), state: createState({ monthlyIncomePaise: 3333333 }) };
  f.replica.write = async input => { f.row = remote; return write(input); };
  await sync.syncNow();
  assert.equal(sync.getStatus().state, 'conflict');
  assert.deepEqual(f.row, remote);
});

test('invalid remote ledgers and remote deletion preserve local data', async t => {
  const f = fixture(t);
  const sync = f.syncFor();
  await sync.syncNow();
  const original = structuredClone(f.store.get());
  f.row = { revision: randomUUID(), state: { bad: true } };
  await sync.syncNow();
  assert.deepEqual(f.store.get(), original);
  f.row = null;
  await sync.syncNow();
  assert.equal(sync.getStatus().state, 'conflict');
  assert.deepEqual(f.store.get(), original);
});

test('JSONB object key ordering does not make a ledger appear changed', () => {
  assert.equal(stateHash({ a: 1, b: { c: 2, d: 3 } }), stateHash({ b: { d: 3, c: 2 }, a: 1 }));
  assert.notEqual(stateHash([1, 2]), stateHash([2, 1]));
});

test('background scheduling uploads changes automatically and coalesces concurrent requests', async t => {
  const f = fixture(t);
  const sync = f.syncFor(f.store, { intervalMs: 10, debounceMs: 1 });
  t.after(() => sync.stop());
  sync.start();
  const waitFor = async predicate => {
    for (let attempt = 0; attempt < 200 && !predicate(); attempt++) {
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    assert.ok(predicate());
  };
  await waitFor(() => sync.getStatus().state === 'synced');
  f.change();
  await waitFor(() => f.row.state.settings.monthlyIncomePaise === 5432100);
  const first = sync.syncNow();
  assert.equal(sync.syncNow(), first);
  await first;
  await sync.stop();
});
