import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { neonConfig } from '@neondatabase/serverless';
import { createNeonReplica } from '../lib/neon.js';

test('Neon adapter uses bound parameters, parses JSONB and performs conditional writes', async t => {
  const previousFetch = neonConfig.fetchFunction;
  t.after(() => { neonConfig.fetchFunction = previousFetch; });
  const requests = [];
  const revision = randomUUID();
  const state = { transactions: [{ description: "Dinner'); DROP TABLE khaata_ledgers; --", amountPaise: 12345 }] };
  let acceptWrite = true;
  neonConfig.fetchFunction = async (url, options) => {
    assert.equal(new URL(url).protocol, 'https:');
    assert.ok(options.signal instanceof AbortSignal);
    const body = JSON.parse(options.body);
    requests.push(body);
    let fields = [], rows = [];
    if (body.query.startsWith('SELECT')) {
      fields = [{ name: 'revision', dataTypeID: 2950 }, { name: 'payload', dataTypeID: 3802 }];
      rows = [[revision, JSON.stringify(state)]];
    } else if (!body.query.startsWith('CREATE')) {
      fields = [{ name: 'revision', dataTypeID: 2950 }];
      rows = acceptWrite ? [[body.params[1]]] : [];
    }
    return Response.json({ fields, rows });
  };
  const direct = 'postgresql://test:private-password@ep-example.us-east-1.aws.neon.tech/neondb?sslmode=require';
  const replica = createNeonReplica(direct, 'personal');
  const pooled = createNeonReplica(direct.replace('ep-example.', 'ep-example-pooler.'), 'personal');
  assert.equal(replica.target, pooled.target);
  assert.ok(!replica.target.includes('private-password'));
  assert.notEqual(replica.target, createNeonReplica(direct, 'other-ledger').target);
  assert.deepEqual(await replica.read(), { revision, state });
  await replica.read();
  assert.equal(requests.filter(request => request.query.startsWith('CREATE')).length, 1);
  const nextRevision = randomUUID();
  assert.equal(await replica.write({ baseRevision: null, revision: nextRevision, state }), true);
  const insert = requests.at(-1);
  assert.match(insert.query, /ON CONFLICT \(id\) DO NOTHING/);
  assert.deepEqual(insert.params, ['personal', nextRevision, JSON.stringify(state)]);
  assert.ok(!insert.query.includes(state.transactions[0].description));
  assert.equal(await replica.write({ baseRevision: revision, revision: nextRevision, state }), true);
  const update = requests.at(-1);
  assert.match(update.query, /WHERE id = \$1 AND revision = \$4/);
  assert.deepEqual(update.params, ['personal', nextRevision, JSON.stringify(state), revision]);
  acceptWrite = false;
  assert.equal(await replica.write({ baseRevision: revision, revision: nextRevision, state }), false);
});

test('invalid database configuration fails without exposing credentials', () => {
  for (const connection of ['secret-password', 'https://test:secret-password@example.com/db', 'postgresql://test:secret-password@example.com/db']) {
    assert.throws(() => createNeonReplica(connection), error => {
      assert.match(error.message, /Neon PostgreSQL connection string/);
      assert.ok(!String(error).includes('secret-password'));
      return true;
    });
  }
});
