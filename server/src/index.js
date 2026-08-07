import fs from 'node:fs';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import rateLimit from 'express-rate-limit';

import { config } from './config.js';
import { pool } from './db.js';
import { notFound, errorHandler } from './middleware/error.js';
import { authenticate, requireManager, requirePasswordSet } from './middleware/auth.js';

import authRoutes from './routes/auth.js';
import outletRoutes from './routes/locations.js';
import categoryRoutes from './routes/subLocations.js';
import taskRoutes from './routes/tasks.js';
import userRoutes from './routes/users.js';
import shiftRoutes from './routes/shifts.js';
import rosterRoutes from './routes/roster.js';
import runRoutes from './routes/runs.js';
import dashboardRoutes from './routes/dashboard.js';
import reportRoutes from './routes/reports.js';
import settingsRoutes from './routes/settings.js';

const app = express();

app.set('trust proxy', 1);
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(compression());
app.use(express.json({ limit: '1mb' }));
app.use(morgan(config.env === 'production' ? 'combined' : 'dev'));

app.use(
  cors({
    origin(origin, cb) {
      // Same-origin / curl / native app requests have no Origin header.
      if (!origin) return cb(null, true);
      if (!config.corsOrigins.length) return cb(null, true);
      if (config.corsOrigins.includes(origin)) return cb(null, true);
      cb(new Error(`Origin ${origin} is not allowed`));
    },
    credentials: true,
  })
);

// Uploaded photos. Behind auth would be nicer, but <img> tags can't send a
// bearer header — the filenames are random UUIDs and the server is LAN-only.
fs.mkdirSync(config.uploadDir, { recursive: true });
app.use('/uploads', express.static(config.uploadDir, { maxAge: '7d' }));

app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true, time: new Date().toISOString() });
  } catch (err) {
    res.status(503).json({ ok: false, error: err.message });
  }
});

// Brute-force guard on sign-in only.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many sign-in attempts. Try again in a few minutes.' },
});

app.use('/api/auth/login', loginLimiter);
app.use('/api/auth', authRoutes);

// Everything below needs a valid session.
const authed = [authenticate, requirePasswordSet];

app.use('/api/locations', authed, outletRoutes);
app.use('/api/sub-locations', authed, categoryRoutes);
app.use('/api/tasks', authed, taskRoutes);
app.use('/api/shifts', authed, shiftRoutes);
app.use('/api/runs', authed, runRoutes);
app.use('/api/settings', authed, settingsRoutes);

// Management areas — admin or HOD. Which *actions* a HOD may take inside
// /api/users is enforced per-route in that router, since it depends on the
// target account's role, not just the caller's.
app.use('/api/users', authed, requireManager, userRoutes);
app.use('/api/roster', authed, rosterRoutes); // staff may read their own; guarded inside
app.use('/api/dashboard', authed, requireManager, dashboardRoutes);
app.use('/api/reports', authed, requireManager, reportRoutes);

app.use(notFound);
app.use(errorHandler);

const server = app.listen(config.port, config.host, () => {
  console.log(`SmallVille Engineering API listening on http://${config.host}:${config.port}`);
  console.log(`Environment: ${config.env} | DB: ${config.db.database}@${config.db.host}`);
});

const shutdown = (signal) => async () => {
  console.log(`\n${signal} received, shutting down…`);
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
};
process.on('SIGTERM', shutdown('SIGTERM'));
process.on('SIGINT', shutdown('SIGINT'));

export default app;
