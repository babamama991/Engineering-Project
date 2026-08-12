/**
 * File logging.
 *
 * One combined file per day, outside the project directory, so a git pull or a
 * redeploy never touches it and it survives re-cloning the app. Set with
 * LOG_DIR (default C:\SmallVilleLogs on Windows, ./logs elsewhere).
 *
 *   smallville-2026-08-11.log
 *
 * Every line carries a level so one file stays readable:
 *
 *   HTTP   every request, in morgan's combined format
 *   INFO   startup, shutdown
 *   WARN   4xx responses, validation failures, shutdown timeouts
 *   ERROR  5xx and crashes, followed by the stack trace
 *
 * To read only the failures:
 *   findstr " ERROR " C:\SmallVilleLogs\smallville-2026-08-11.log
 *
 * Files rotate daily and are gzipped; anything older than LOG_KEEP_DAYS is
 * deleted, so an unattended server can't fill its disk.
 */
import fs from 'node:fs';
import { createStream } from 'rotating-file-stream';
import { DateTime } from 'luxon';
import { config } from '../config.js';

fs.mkdirSync(config.logDir, { recursive: true });

/** smallville.log -> smallville-2026-08-11.log.gz once rotated. */
const namer = (time, index) => {
  if (!time) return 'smallville.log';
  const d = DateTime.fromJSDate(time).setZone(config.timezone).toISODate();
  return index > 1 ? `smallville-${d}.${index}.log.gz` : `smallville-${d}.log.gz`;
};

const stream = createStream(namer, {
  path: config.logDir,
  interval: '1d',
  maxFiles: config.logKeepDays,
  compress: 'gzip',
  // Cap a single day too — a crash loop can produce a lot in an hour.
  size: '20M',
});

/** Local wall-clock time, because whoever reads this is in the hotel. */
const stamp = () => DateTime.now().setZone(config.timezone).toFormat('yyyy-LL-dd HH:mm:ss');

const write = (level, message, meta) => {
  const extra = meta && Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
  return `${stamp()}  ${level.padEnd(5)}  ${message}${extra}\n`;
};

/**
 * morgan writes here. Its lines already end in \n and have no level of their
 * own, so they are tagged HTTP and timestamped like everything else — otherwise
 * request lines would be the only ones you couldn't filter by level.
 */
export const accessStream = {
  write(line) {
    stream.write(write('HTTP', String(line).trimEnd()));
  },
};

export const logger = {
  info(message, meta) {
    const text = write('INFO', message, meta);
    stream.write(text);
    if (config.env !== 'production') process.stdout.write(text);
  },

  warn(message, meta) {
    const text = write('WARN', message, meta);
    stream.write(text);
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
    const text = write('ERROR', message, meta);
    const stack = err instanceof Error && err.stack ? `${err.stack}\n` : '';

    stream.write(text + stack);
    process.stderr.write(text + stack);
  },
};
