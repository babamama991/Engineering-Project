import { ZodError } from 'zod';

/** Wraps an async route so rejected promises reach the error handler. */
export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

export function notFound(req, res) {
  res.status(404).json({ error: `No route for ${req.method} ${req.originalUrl}` });
}

export function errorHandler(err, req, res, _next) {
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: 'Invalid request',
      details: err.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
    });
  }

  // Postgres constraint violations -> readable messages
  if (err.code === '23505') {
    return res.status(409).json({ error: 'That record already exists', detail: err.detail });
  }
  if (err.code === '23503') {
    return res.status(409).json({ error: 'Referenced record does not exist', detail: err.detail });
  }
  if (err.code === '23514') {
    return res.status(400).json({
      error: err.constraint === 'task_answers_no_needs_comment'
        ? 'A comment is required when the answer is No'
        : 'Value failed a database check',
      detail: err.constraint,
    });
  }

  // multer rejects oversized / too many files before the route ever runs.
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'That photo is too large. Try again.' });
  }
  if (typeof err.code === 'string' && err.code.startsWith('LIMIT_')) {
    return res.status(400).json({ error: 'That upload was rejected', detail: err.code });
  }

  const status = err.status || 500;
  if (status >= 500) console.error('[error]', err);

  res.status(status).json({
    error: status >= 500 ? 'Something went wrong on the server' : err.message,
  });
}
