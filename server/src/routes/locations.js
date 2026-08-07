import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db.js';
import { asyncHandler } from '../middleware/error.js';
import { requireManager, isManager } from '../middleware/auth.js';
import { logAction } from '../utils/audit.js';

const router = Router();

const shape = (o) => ({
  id: o.id,
  code: o.code,
  nameEn: o.name_en,
  nameAr: o.name_ar,
  location: o.location,
  sortOrder: o.sort_order,
  isActive: o.is_active,
  taskCount: o.task_count ?? undefined,
});

/** Staff and admin both read this — it's the location grid on the staff home. */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const includeInactive = req.query.includeInactive === 'true' && isManager(req.user);
    const { rows } = await query(
      `SELECT o.*,
              (SELECT count(*)::int FROM tasks t
                WHERE t.location_id = o.id AND t.deleted_at IS NULL AND t.is_active) AS task_count
         FROM locations o
        WHERE o.deleted_at IS NULL ${includeInactive ? '' : 'AND o.is_active'}
        ORDER BY o.sort_order, o.name_en`
    );
    res.json(rows.map(shape));
  })
);

const upsertSchema = z.object({
  code: z.string().trim().min(2).regex(/^[A-Za-z0-9_-]+$/, 'Letters, numbers, dash, underscore'),
  nameEn: z.string().trim().min(1),
  // Optional — see tasks.descriptionAr. Arabic can be filled in later.
  nameAr: z.string().trim().min(1).nullable().optional(),
  location: z.string().trim().nullable().optional(),
  sortOrder: z.number().int().default(0),
  isActive: z.boolean().default(true),
});

router.post(
  '/',
  requireManager,
  asyncHandler(async (req, res) => {
    const d = upsertSchema.parse(req.body);
    const { rows } = await query(
      `INSERT INTO locations (code, name_en, name_ar, location, sort_order, is_active)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [d.code.toUpperCase(), d.nameEn, d.nameAr, d.location || null, d.sortOrder, d.isActive]
    );
    logAction(req, { action: 'location.create', entity: 'location', entityId: rows[0].id, details: d });
    res.status(201).json(shape(rows[0]));
  })
);

router.patch(
  '/:id',
  requireManager,
  asyncHandler(async (req, res) => {
    const d = upsertSchema.partial().parse(req.body);
    const { rows } = await query(
      `UPDATE locations SET
         code       = COALESCE($2, code),
         name_en    = COALESCE($3, name_en),
         name_ar    = COALESCE($4, name_ar),
         location   = COALESCE($5, location),
         sort_order = COALESCE($6, sort_order),
         is_active  = COALESCE($7, is_active)
       WHERE id = $1 AND deleted_at IS NULL RETURNING *`,
      [Number(req.params.id), d.code?.toUpperCase() ?? null, d.nameEn ?? null, d.nameAr ?? null,
       d.location ?? null, d.sortOrder ?? null, d.isActive ?? null]
    );
    if (!rows.length) return res.status(404).json({ error: 'Location not found' });
    logAction(req, { action: 'location.update', entity: 'location', entityId: rows[0].id, details: d });
    res.json(shape(rows[0]));
  })
);

/** Soft delete — historical runs and reports for this location stay readable. */
router.delete(
  '/:id',
  requireManager,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const { rowCount } = await query(
      `UPDATE locations SET deleted_at = now(), is_active = FALSE
        WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    if (!rowCount) return res.status(404).json({ error: 'Location not found' });
    logAction(req, { action: 'location.delete', entity: 'location', entityId: id });
    res.json({ ok: true });
  })
);

export default router;
