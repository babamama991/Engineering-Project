import { query } from '../db.js';

// Settings change rarely and are read on almost every request, so keep a small
// in-process cache with a short TTL.
let cache = null;
let cachedAt = 0;
const TTL_MS = 30_000;

async function load() {
  const { rows } = await query('SELECT key, value FROM app_settings');
  cache = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  cachedAt = Date.now();
  return cache;
}

export async function getSettings() {
  if (!cache || Date.now() - cachedAt > TTL_MS) return load();
  return cache;
}

export async function getSetting(key, fallback = null) {
  const s = await getSettings();
  return s[key] ?? fallback;
}

export async function setSetting(key, value, actorId = null) {
  await query(
    `INSERT INTO app_settings (key, value, updated_by, updated_at)
     VALUES ($1, $2::jsonb, $3, now())
     ON CONFLICT (key) DO UPDATE
       SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [key, JSON.stringify(value), actorId]
  );
  cache = null;
}

export function invalidateSettingsCache() {
  cache = null;
}
