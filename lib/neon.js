import { createHash } from 'node:crypto';
import { neon } from '@neondatabase/serverless';

// Keep the complete ledger in one row: cloud persistence must not reinterpret
// budgets, history, integer paise or any of the existing domain calculations.
export function createNeonReplica(connectionString, ledgerId = 'personal') {
  let url;
  try { url = new URL(connectionString); } catch {
    throw new Error('DATABASE_URL must be a Neon PostgreSQL connection string.');
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname.endsWith('.neon.tech')) {
    throw new Error('DATABASE_URL must be a Neon PostgreSQL connection string.');
  }
  if (!ledgerId || ledgerId.length > 128) throw new Error('CLOUD_LEDGER_ID must contain 1–128 characters.');
  // No password or full connection string is written to local metadata/logs.
  const target = createHash('sha256').update(`${url.hostname.replace('-pooler.', '.')}|${url.pathname}|${ledgerId}`).digest('hex');
  const sql = neon(connectionString);
  const query = (text, params = []) => sql.query(text, params, {
    fetchOptions: { signal: AbortSignal.timeout(10_000) },
  });
  let initialized = false;

  return {
    target,
    async read() {
      if (!initialized) {
        await query(`CREATE TABLE IF NOT EXISTS public.khaata_ledgers (
          id text PRIMARY KEY,
          revision uuid NOT NULL,
          payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
          updated_at timestamptz NOT NULL DEFAULT now()
        )`);
        initialized = true;
      }
      const rows = await query('SELECT revision, payload FROM public.khaata_ledgers WHERE id = $1', [ledgerId]);
      return rows[0] ? { revision: rows[0].revision, state: rows[0].payload } : null;
    },
    async write({ baseRevision, revision, state }) {
      const rows = baseRevision === null
        ? await query(`INSERT INTO public.khaata_ledgers (id, revision, payload)
            VALUES ($1, $2, $3::jsonb) ON CONFLICT (id) DO NOTHING RETURNING revision`,
          [ledgerId, revision, JSON.stringify(state)])
        : await query(`UPDATE public.khaata_ledgers SET revision = $2, payload = $3::jsonb, updated_at = now()
            WHERE id = $1 AND revision = $4 RETURNING revision`,
          [ledgerId, revision, JSON.stringify(state), baseRevision]);
      return rows.length === 1;
    },
  };
}
