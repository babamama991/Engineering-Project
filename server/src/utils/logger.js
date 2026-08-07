/**
 * File logging.
 *
 * The API runs as a Windows service in production, where nothing is watching
 * stdout — so every line also goes to a dated file under LOG_DIR. Three streams,
 * because they answer different questions:
 *
 *   access-*.log   every HTTP request. "Did the phone even reach the server?"
 *   app-*.log      startup, shutdown, warnings, errors. The running narrative.
 *   error-*.log    errors only, with stack traces. The one to open first.
 *
 * Errors are written to BOTH app and error, so app-*.log stays a complete
 * chronological account while error-*.log stays short enough to read.
 *
 * Files rotate daily and are gzipped; anything older than LOG_KEEP_DAYS is
 * deleted, so an unattended server can't fill its disk with logs.
 */
import fs from 'node:fs';
import { createStream } from 'rotating-file-stream';
import { DateTime } from 'luxon';
import { config } from '../config.js';

fs.mkdirSync(config.logDir, { recursive: true });

/** access.log -> access-2026-08-07.log, then .gz once rotated. */
const namer = (base) => (time, index) => {
  if (!time) return `${base}.log`;
  const d = DateTime.fromJSDate(time).setZone(config.timezone).toISODate();
  return index > 1 ? `${base}-${d}.${index}.log.gz` : `${base}-${d}.log.gz`;
};

const open = (base) =>
  createStream(namer(base), {
    path: config.logDir,
    interval: '1d',
    maxFiles: config.logKeepDays,
    compress: 'gzip',
    // Cap a single day too — a crash loop can produce a lot in an hour.
    size: '20M',
  });

export const accessStream = open('access');
const appStream = open('app');
const errorStream = open('error');

/** Local wall-clock time, because whoever reads these is in the hotel. */
const stamp = () => DateTime.now().setZone(config.timezone).toFormat('yyyy-LL-dd HH:mm:ss');

const line = (level, message, meta) => {
  const extra = meta && Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
  return `${stamp()}  ${level.padEnd(5)}  ${message}${extra}\n`;
};

export const logger = {
  info(message, meta) {
    const text = line('INFO', message, meta);
    appStream.write(text);
    if (config.env !== 'production') process.stdout.write(text);
  },

  warn(message, meta) {
    const text = line('WARN', message, meta);
    appStream.write(text);
    process.stdout.write(text);
  },

  /**
   * @param {Error|string} err
   * @param {object} [meta] request context — method, url, user, status
   */
  error(err, meta) {
    // Some errors carry an empty message — AggregateError [ECONNREFUSED] from a
    // dead database is the one you'll actually hit. Fall back to code or name so
    // the summary line is readable without scrolling into the stack.
    const message =
      (err instanceof Error ? err.message : String(err)) ||
      (err && (err.code || err.name)) ||
      'Unknown error';
    const text = line('ERROR', message, meta);
    const stack = err instanceof Error && err.stack ? `${err.stack}\n` : '';

    appStream.write(text);
    errorStream.write(text + stack);
    process.stderr.write(text + stack);
  },
};
