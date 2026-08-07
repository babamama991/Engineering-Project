import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { query } from '../db.js';
import { asyncHandler } from '../middleware/error.js';
import { logAction } from '../utils/audit.js';

// Mounted for admin + hod (requireManager). Which actions a HOD may take
// depends on the TARGET account, not just the caller, so it is enforced here.
const router = Router();

/**
 * A HOD may only ever act on staff accounts, and may only ever create staff.
 * Everything about admins and HODs — creating them, editing them, resetting
 * their passwords, deleting them, or promoting anyone into those roles — is
 * IT's alone.
 *
 * Returns an Error with .status when the caller may not touch this, else null.
 */
function denyElevated(caller, { targetRole, requestedRole }) {
  if (caller.role === 'admin') return null;

  if (requestedRole && requestedRole !== 'staff') {
    return Object.assign(
      new Error('Only IT can create or assign the admin and HOD roles'),
      { status: 403 }
    );
  }
  if (targetRole && targetRole !== 'staff') {
    return Object.assign(
      new Error('Only IT can manage admin and HOD accounts'),
      { status: 403 }
    );
  }
  return null;
}

/** Current role of an account, or null when it doesn't exist / is deleted. */
async function targetRoleOf(id) {
  const { rows } = await query(
    'SELECT role FROM users WHERE id = $1 AND deleted_at IS NULL',
    [id]
  );
  return rows.length ? rows[0].role : null;
}

const shape = (u) => ({
  id: u.id,
  username: u.username,
  fullName: u.full_name,
  role: u.role,
  jobTitle: u.job_title,
  phone: u.phone,
  preferredLang: u.preferred_lang,
  isActive: u.is_active,
  mustChangePassword: u.must_change_password,
  lastLoginAt: u.last_login_at,
  createdAt: u.created_at,
});

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const includeInactive = req.query.includeInactive === 'true';
    const { rows } = await query(
      `SELECT * FROM users
        WHERE deleted_at IS NULL ${includeInactive ? '' : 'AND is_active'}
        ORDER BY role, full_name`
    );
    res.json(rows.map(shape));
  })
);

const createSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3, 'Username must be at least 3 characters')
    .regex(/^[a-zA-Z0-9._-]+$/, 'Use letters, numbers, dot, dash or underscore only'),
  fullName: z.string().trim().min(2),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  role: z.enum(['admin', 'hod', 'staff']).default('staff'),
  jobTitle: z.string().trim().optional().nullable(),
  phone: z.string().trim().optional().nullable(),
  preferredLang: z.enum(['en', 'ar']).default('en'),
  mustChangePassword: z.boolean().default(true),
});

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const d = createSchema.parse(req.body);

    const denied = denyElevated(req.user, { requestedRole: d.role });
    if (denied) return res.status(denied.status).json({ error: denied.message });

    const hash = await bcrypt.hash(d.password, 12);

    const { rows } = await query(
      `INSERT INTO users (username, password_hash, full_name, role, job_title, phone,
                          preferred_lang, must_change_password, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [
        d.username, hash, d.fullName, d.role, d.jobTitle || null, d.phone || null,
        d.preferredLang, d.mustChangePassword, req.user.id,
      ]
    );

    logAction(req, {
      action: 'user.create', entity: 'user', entityId: rows[0].id,
      details: { username: d.username, role: d.role },
    });
    res.status(201).json(shape(rows[0]));
  })
);

const updateSchema = z.object({
  fullName: z.string().trim().min(2).optional(),
  role: z.enum(['admin', 'hod', 'staff']).optional(),
  jobTitle: z.string().trim().nullable().optional(),
  phone: z.string().trim().nullable().optional(),
  preferredLang: z.enum(['en', 'ar']).optional(),
  isActive: z.boolean().optional(),
});

router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const d = updateSchema.parse(req.body);

    const currentRole = await targetRoleOf(id);
    if (!currentRole) return res.status(404).json({ error: 'User not found' });

    const denied = denyElevated(req.user, {
      targetRole: currentRole,
      requestedRole: d.role,
    });
    if (denied) return res.status(denied.status).json({ error: denied.message });

    // Don't let the last admin lock everyone out. Demoting to 'hod' removes an
    // admin just as surely as demoting to 'staff', so test "no longer admin"
    // rather than naming a specific target role.
    if ((d.role && d.role !== 'admin') || d.isActive === false) {
      const { rows } = await query(
        `SELECT count(*)::int AS n FROM users
          WHERE role = 'admin' AND is_active AND deleted_at IS NULL AND id <> $1`,
        [id]
      );
      if (rows[0].n === 0) {
        return res.status(409).json({
          error: 'This is the only active admin — promote another admin first',
        });
      }
    }

    const { rows } = await query(
      `UPDATE users SET
         full_name      = COALESCE($2, full_name),
         role           = COALESCE($3, role),
         job_title      = COALESCE($4, job_title),
         phone          = COALESCE($5, phone),
         preferred_lang = COALESCE($6, preferred_lang),
         is_active      = COALESCE($7, is_active)
       WHERE id = $1 AND deleted_at IS NULL
       RETURNING *`,
      [id, d.fullName ?? null, d.role ?? null, d.jobTitle ?? null, d.phone ?? null,
       d.preferredLang ?? null, d.isActive ?? null]
    );
    if (!rows.length) return res.status(404).json({ error: 'User not found' });

    logAction(req, { action: 'user.update', entity: 'user', entityId: id, details: d });
    res.json(shape(rows[0]));
  })
);

/** Admin resets a forgotten password. Forces a change on next sign-in. */
router.post(
  '/:id/reset-password',
  asyncHandler(async (req, res) => {
    const { newPassword } = z
      .object({ newPassword: z.string().min(8, 'Password must be at least 8 characters') })
      .parse(req.body);

    const currentRole = await targetRoleOf(Number(req.params.id));
    if (!currentRole) return res.status(404).json({ error: 'User not found' });

    const denied = denyElevated(req.user, { targetRole: currentRole });
    if (denied) return res.status(denied.status).json({ error: denied.message });

    const { rowCount } = await query(
      `UPDATE users SET password_hash = $1, must_change_password = TRUE
        WHERE id = $2 AND deleted_at IS NULL`,
      [await bcrypt.hash(newPassword, 12), Number(req.params.id)]
    );
    if (!rowCount) return res.status(404).json({ error: 'User not found' });

    logAction(req, { action: 'user.reset_password', entity: 'user', entityId: Number(req.params.id) });
    res.json({ ok: true });
  })
);

/**
 * Soft delete. Their checklist history stays intact and still shows their name
 * in reports; they simply can't sign in and the username is freed for reuse.
 */
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (id === req.user.id) {
      return res.status(409).json({ error: 'You cannot delete your own account' });
    }

    const currentRole = await targetRoleOf(id);
    if (!currentRole) return res.status(404).json({ error: 'User not found' });

    const denied = denyElevated(req.user, { targetRole: currentRole });
    if (denied) return res.status(denied.status).json({ error: denied.message });

    const { rows: admins } = await query(
      `SELECT count(*)::int AS n FROM users
        WHERE role = 'admin' AND is_active AND deleted_at IS NULL AND id <> $1`,
      [id]
    );
    if (admins[0].n === 0) {
      return res.status(409).json({ error: 'This is the only active admin' });
    }

    const { rowCount } = await query(
      `UPDATE users SET deleted_at = now(), is_active = FALSE
        WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    if (!rowCount) return res.status(404).json({ error: 'User not found' });

    logAction(req, { action: 'user.delete', entity: 'user', entityId: id });
    res.json({ ok: true });
  })
);

export default router;
