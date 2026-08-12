import 'dotenv/config';
import path from 'node:path';

const required = (key) => {
  const v = process.env[key];
  if (!v) throw new Error(`Missing required env var: ${key}`);
  return v;
};

export const config = {
  port: Number(process.env.PORT || 4000),
  host: process.env.HOST || '0.0.0.0',
  env: process.env.NODE_ENV || 'development',

  db: {
    host: process.env.PGHOST || 'localhost',
    port: Number(process.env.PGPORT || 5432),
    database: process.env.PGDATABASE || 'smallville_engineering',
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || '',
  },

  jwtSecret: required('JWT_SECRET'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '12h',

  uploadDir: path.resolve(process.env.UPLOAD_DIR || './uploads'),
  maxUploadBytes: Number(process.env.MAX_UPLOAD_MB || 8) * 1024 * 1024,

  // Outside the project by default, so a git pull or a re-clone never disturbs
  // the logs and they don't need to be gitignored on every machine.
  logDir: path.resolve(
    process.env.LOG_DIR || (process.platform === 'win32' ? 'C:/SmallVilleLogs' : './logs')
  ),
  logKeepDays: Number(process.env.LOG_KEEP_DAYS || 30),

  corsOrigins: (process.env.CORS_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  timezone: process.env.APP_TIMEZONE || 'Asia/Beirut',
};
