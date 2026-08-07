import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { query } from '../db.js';
import { signToken, authenticate } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/error.js';
import { resolveUserShift } from '../utils/shifts.js';

const router = Router();

const loginSchema = z.object({
  username: z.string().trim().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required'),
});

const publicUser = (u) => ({
  id: u.id,
  username: u.username,
  fullName: u.full_name,
  role: u.role,
  preferredLang: u.preferred_lang,
  mustChangePassword: u.must_change_password,
});

router.post(
  '/login',
  asyncHandler(async (req, res) => {
    const { username, password } = loginSchema.parse(req.body);

    const { rows } = await query(
      `SELECT id, username, password_hash, full_name, role, preferred_lang,
              is_active, must_change_password
         FROM users
        WHERE username = $1 AND deleted_at IS NULL`,
      [username]
    );
    const user = rows[0];

    const record = (success, userId) =>
      query(
        `INSERT INTO login_audit (user_id, username, success, ip_address, user_agent)
         VALUES ($1, $2, $3, $4, $5)`,
        [userId, username, success, req.ip, req.headers['user-agent'] || null]
      ).catch(() => {});

    // Same generic message and roughly the same work whether the username
    // exists or not, so the endpoint can't be used to enumerate accounts.
    if (!user) {
      await bcrypt.compare(password, '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidin');
      await record(false, null);
      return res.status(401).json({ error: 'Wrong username or password' });
    }

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      await record(false, user.id);
      return res.status(401).json({ error: 'Wrong username or password' });
    }
    if (!user.is_active) {
      await record(false, user.id);
      return res.status(403).json({ error: 'This account is disabled. Contact the admin.' });
    }

    await record(true, user.id);
    await query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);

    res.json({ token: signToken(user), user: publicUser(user) });
  })
);

/** Current user + the shift the system has resolved for them right now. */
router.get(
  '/me',
  authenticate,
  asyncHandler(async (req, res) => {
    const payload = { user: publicUser(req.user) };

    if (!req.user.must_change_password) {
      const s = await resolveUserShift(req.user.id);
      payload.shift = {
        id: s.shift.id,
        code: s.shift.code,
        nameEn: s.shift.name_en,
        nameAr: s.shift.name_ar,
        startTime: s.shift.start_time,
        endTime: s.shift.end_time,
        businessDate: s.businessDate,
        source: s.source,
        localTime: s.localTime,
      };
    }
    res.json(payload);
  })
);

const passwordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8, 'New password must be at least 8 characters'),
});

router.post(
  '/change-password',
  authenticate, // deliberately NOT requirePasswordSet — this is the way out of that state
  asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = passwordSchema.parse(req.body);

    const { rows } = await query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    const ok = await bcrypt.compare(currentPassword, rows[0].password_hash);
    if (!ok) return res.status(401).json({ error: 'Current password is not correct' });

    await query(
      `UPDATE users SET password_hash = $1, must_change_password = FALSE WHERE id = $2`,
      [await bcrypt.hash(newPassword, 12), req.user.id]
    );
    res.json({ ok: true });
  })
);

router.post(
  '/language',
  authenticate,
  asyncHandler(async (req, res) => {
    const { lang } = z.object({ lang: z.enum(['en', 'ar']) }).parse(req.body);
    await query('UPDATE users SET preferred_lang = $1 WHERE id = $2', [lang, req.user.id]);
    res.json({ ok: true, lang });
  })
);

export default router;
