import pg from 'pg';
import { config } from './config.js';

// Return DATE columns as plain 'YYYY-MM-DD' strings instead of JS Dates.
// Without this, node-postgres converts a DATE to midnight *local* time, which
// silently shifts business_date by a day for anyone east/west of the server.
pg.types.setTypeParser(1082, (v) => v);
// BIGINT / NUMERIC counts -> Number (safe for our row volumes)
pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v)));
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));

export const pool = new pg.Pool({
  ...config.db,
  max: 10,
  idleTimeoutMillis: 30_000,
});

pool.on('error', (err) => {
  // Lazy import: db.js loads before logger.js is ready during startup.
  import('./utils/logger.js').then(({ logger }) =>
    logger.error(err, { source: 'pg pool idle client' })
  );
});

export const query = (text, params) => pool.query(text, params);

/** Run a callback inside a transaction, rolling back on throw. */
export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
