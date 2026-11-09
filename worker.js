/*
 * Sync API for the app. Everything except /api/* is served as a static asset.
 *
 * GET /api/state returns { revision, updatedAt, data }, with revision 0 and
 * null data until the first upload.
 * PUT /api/state takes { baseRevision, data } and answers 409 if another device
 * saved since baseRevision, so an upload never overwrites changes it has not seen.
 */

const MAX_BODY_CHARS = 1_000_000;

const CREATE_TABLE = `CREATE TABLE IF NOT EXISTS sync_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  revision INTEGER NOT NULL,
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL
)`;

// The WHERE clause makes the write conditional: no row comes back on a conflict.
const SAVE_STATE = `INSERT INTO sync_state (id, revision, data, updated_at)
  VALUES (1, ?1 + 1, ?2, ?3)
  ON CONFLICT (id) DO UPDATE SET
    revision = sync_state.revision + 1,
    data = excluded.data,
    updated_at = excluded.updated_at
  WHERE sync_state.revision = ?1
  RETURNING revision, updated_at`;

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

const sha256 = async (text) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));

// Compares digests with a fixed number of steps so timing reveals nothing about the key.
async function keyMatches(given, expected) {
  const [a, b] = await Promise.all([sha256(given), sha256(expected)]);
  return a.reduce((diff, byte, i) => diff | (byte ^ b[i]), 0) === 0;
}

async function readState(db) {
  const row = await db.prepare('SELECT revision, data, updated_at FROM sync_state WHERE id = 1').first();
  return row
    ? { revision: row.revision, updatedAt: row.updated_at, data: JSON.parse(row.data) }
    : { revision: 0, updatedAt: null, data: null };
}

async function writeState(request, db) {
  const text = await request.text();
  if (text.length > MAX_BODY_CHARS) return json({ error: 'too_large' }, 413);

  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }
  const { baseRevision, data } = body ?? {};
  const validData = data && typeof data === 'object' && Array.isArray(data.dishes);
  if (!Number.isInteger(baseRevision) || baseRevision < 0 || !validData) {
    return json({ error: 'invalid_state' }, 400);
  }

  const saved = await db.prepare(SAVE_STATE)
    .bind(baseRevision, JSON.stringify(data), new Date().toISOString())
    .first();
  if (!saved) return json({ error: 'conflict' }, 409);
  return json({ revision: saved.revision, updatedAt: saved.updated_at });
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (!pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    if (pathname !== '/api/state') return json({ error: 'not_found' }, 404);

    // Fail closed: without a configured key the data is never reachable
    if (!env.SYNC_KEY || !env.DB) return json({ error: 'not_configured' }, 503);
    const given = (request.headers.get('Authorization') ?? '').replace(/^Bearer /, '');
    if (!given || !(await keyMatches(given, env.SYNC_KEY))) return json({ error: 'unauthorized' }, 401);

    // Creating the table here spares a manual migration; it writes nothing once it exists
    await env.DB.prepare(CREATE_TABLE).run();

    if (request.method === 'GET') return json(await readState(env.DB));
    if (request.method === 'PUT') return writeState(request, env.DB);
    return json({ error: 'method_not_allowed' }, 405);
  },
};
