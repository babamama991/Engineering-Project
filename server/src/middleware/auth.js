import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { query } from '../db.js';

export function signToken(user) {
  return jwt.sign(
    { sub: user.id, role: user.role, username: user.username },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn }
  );
}

/** Verifies the bearer token and re-checks the account is still live. */
export async function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Not signed in' });

  let payload;
  try {
    payload = jwt.verify(token, config.jwtSecret);
  } catch {
    return res.status(401).json({ error: 'Session expired, please sign in again' });
  }

  // A token stays valid until it expires, so re-read the account: deactivating
  // or deleting a user must take effect immediately, not in 12 hours.
  const { rows } = await query(
    `SELECT id, username, full_name, role, preferred_lang, is_active,
            must_change_password
       FROM users
      WHERE id = $1 AND deleted_at IS NULL`,
    [payload.sub]
  );
  const user = rows[0];
  if (!user) return res.status(401).json({ error: 'Account no longer exists' });
  if (!user.is_active) return res.status(403).json({ error: 'Account is disabled' });

  req.user = user;
  next();
}

/**
 * Roles
 *   admin : IT. Superuser — everything, including Settings, shift times, and
 *           creating or editing other admins and HODs.
 *   hod   : Head of Department. Runs the department — dashboard, reports,
 *           schedule, tasks, locations, subLocations — and may create STAFF
 *           accounts only. Cannot reach Settings or touch elevated accounts.
 *   staff : technician. Staff app only.
 */
export const isManager = (user) => user?.role === 'admin' || user?.role === 'hod';

/** IT-level only: Settings, shift times, and anything touching admins/HODs. */
export function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

/** Admin or HOD: the whole admin panel except the IT-level areas above. */
export function requireManager(req, res, next) {
  if (!isManager(req.user)) {
    return res.status(403).json({ error: 'Admin or HOD access required' });
  }
  next();
}

/**
 * Blocks normal API use until a first-login password change is done.
 * The password-change endpoint itself opts out.
 */
export function requirePasswordSet(req, res, next) {
  if (req.user?.must_change_password) {
    return res.status(428).json({
      error: 'You must set a new password before continuing',
      code: 'PASSWORD_CHANGE_REQUIRED',
    });
  }
  next();
}
