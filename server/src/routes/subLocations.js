import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db.js';
import { asyncHandler } from '../middleware/error.js';
import { requireManager, isManager } from '../middleware/auth.js';
import { logAction } from '../utils/audit.js';

const router = Router();

const shape = (c) => ({
  id: c.id,
  nameEn: c.name_en,
  nameAr: c.name_ar,
  icon: c.icon,
  sortOrder: c.sort_order,
  isActive: c.is_active,
});

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `SELECT * FROM sub_locations
        WHERE deleted_at IS NULL AND is_active
        ORDER BY sort_order, name_en`
    );
    res.json(rows.map(shape));
  })
);

const schema = z.object({
  nameEn: z.string().trim().min(1),
  // Optional — see tasks.descriptionAr. Arabic can be filled in later.
  nameAr: z.string().trim().min(1).nullable().optional(),
  icon: z.string().trim().nullable().optional(),
  sortOrder: z.number().int().default(0),
  isActive: z.boolean().default(true),
});

router.post(
  '/',
  requireManager,
  asyncHandler(async (req, res) => {
    const d = schema.parse(req.body);
    const { rows } = await query(
      `INSERT INTO sub_locations (name_en, name_ar, icon, sort_order, is_active)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [d.nameEn, d.nameAr, d.icon || null, d.sortOrder, d.isActive]
    );
    logAction(req, { action: 'subLocation.create', entity: 'subLocation', entityId: rows[0].id, details: d });
    res.status(201).json(shape(rows[0]));
  })
);

router.patch(
  '/:id',
  requireManager,
  asyncHandler(async (req, res) => {
    const d = schema.partial().parse(req.body);
    const { rows } = await query(
      `UPDATE sub_locations SET
         name_en    = COALESCE($2, name_en),
         name_ar    = COALESCE($3, name_ar),
         icon       = COALESCE($4, icon),
         sort_order = COALESCE($5, sort_order),
         is_active  = COALESCE($6, is_active)
       WHERE id = $1 AND deleted_at IS NULL RETURNING *`,
      [Number(req.params.id), d.nameEn ?? null, d.nameAr ?? null, d.icon ?? null,
       d.sortOrder ?? null, d.isActive ?? null]
    );
    if (!rows.length) return res.status(404).json({ error: 'SubLocation not found' });
    logAction(req, { action: 'subLocation.update', entity: 'subLocation', entityId: rows[0].id, details: d });
    res.json(shape(rows[0]));
  })
);

router.delete(
  '/:id',
  requireManager,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);

    // Tasks keep working with no subLocation (they fall into "Uncategorised"),
    // so this is safe — but tell the admin how many are affected.
    const { rows: used } = await query(
      `SELECT count(*)::int AS n FROM tasks WHERE sub_location_id = $1 AND deleted_at IS NULL`,
      [id]
    );

    const { rowCount } = await query(
      `UPDATE sub_locations SET deleted_at = now(), is_active = FALSE
        WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    if (!rowCount) return res.status(404).json({ error: 'SubLocation not found' });

    logAction(req, { action: 'subLocation.delete', entity: 'subLocation', entityId: id });
    res.json({ ok: true, tasksAffected: used[0].n });
  })
);

export default router;
