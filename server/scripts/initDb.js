/**
 * Creates the database (if missing), then applies db/schema.sql and db/seed.sql.
 *   npm run db:init
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { config } from '../src/config.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const dbDir = path.resolve(here, '../../db');

async function ensureDatabase() {
  const admin = new pg.Client({ ...config.db, database: 'postgres' });
  await admin.connect();
  const { rows } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [
    config.db.database,
  ]);
  if (!rows.length) {
    // Identifiers can't be parameterised; the name comes from our own .env.
    await admin.query(`CREATE DATABASE "${config.db.database.replace(/"/g, '""')}"`);
    console.log(`Created database "${config.db.database}"`);
  } else {
    console.log(`Database "${config.db.database}" already exists`);
  }
  await admin.end();
}

async function runFile(client, name) {
  const file = path.join(dbDir, name);
  if (!fs.existsSync(file)) throw new Error(`Missing ${file}`);
  console.log(`Applying ${name}…`);
  await client.query(fs.readFileSync(file, 'utf8'));
}

async function main() {
  await ensureDatabase();

  const client = new pg.Client(config.db);
  await client.connect();

  const { rows } = await client.query(
    `SELECT to_regclass('public.users') IS NOT NULL AS exists`
  );
  if (rows[0].exists) {
    console.log('Schema already applied — skipping schema.sql.');
    console.log('To start over: DROP DATABASE and run this again.');
  } else {
    await runFile(client, 'schema.sql');
  }

  await runFile(client, 'seed.sql');
  await client.end();

  console.log('\nDone. Next: npm run create-admin');
}

main().catch((err) => {
  console.error('\nFailed:', err.message);
  process.exit(1);
});
