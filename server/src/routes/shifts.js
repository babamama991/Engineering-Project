import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db.js';
import { asyncHandler } from '../middleware/error.js';
import { requireAdmin } from '../middleware/auth.js';
import { loadShiftTypes } from '../utils/shifts.js';
import { logAction } from '../utils/audit.js';

const router = Router();

const shape = (s) => ({
  id: s.id,
  code: s.code,
  nameEn: s.name_en,
  nameAr: s.name_ar,
  startTime: s.start_time,
  endTime: s.end_time,
  crossesMidnight: s.crosses_midnight,
  sortOrder: s.sort_order,
});

router.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json((await loadShiftTypes()).map(shape));
  })
);

const schema = z.object({
  code: z.string().trim().min(1).max(16),
  nameEn: z.string().trim().min(1),
  nameAr: z.string().trim().min(1),
  startTime: z.string().regex(/^\d{2}:\d{2}$/, 'Use HH:MM'),
  endTime: z.string().regex(/^\d{2}:\d{2}$/, 'Use HH:MM'),
  sortOrder: z.number().int().default(0),
  isActive: z.boolean().default(true),
});

router.post(
  '/',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const d = schema.parse(req.body);
    const { rows } = await query(
      `INSERT INTO shift_types (code, name_en, name_ar, start_time, end_time, sort_order, is_active)
       VALUES ($1,$2,$3,$4::time,$5::time,$6,$7)
       RETURNING *, to_char(start_time,'HH24:MI') AS start_time, to_char(end_time,'HH24:MI') AS end_time`,
      [d.code.toUpperCase(), d.nameEn, d.nameAr, d.startTime, d.endTime, d.sortOrder, d.isActive]
    );
    logAction(req, { action: 'shift.create', entity: 'shift_type', entityId: rows[0].id, details: d });
    res.status(201).json(shape(rows[0]));
  })
);

router.patch(
  '/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const d = schema.partial().parse(req.body);
    const { rows } = await query(
      `UPDATE shift_types SET
         code       = COALESCE($2, code),
         name_en    = COALESCE($3, name_en),
         name_ar    = COALESCE($4, name_ar),
         start_time = COALESCE($5::time, start_time),
         end_time   = COALESCE($6::time, end_time),
         sort_order = COALESCE($7, sort_order),
         is_active  = COALESCE($8, is_active)
       WHERE id = $1
       RETURNING *, to_char(start_time,'HH24:MI') AS start_time, to_char(end_time,'HH24:MI') AS end_time`,
      [Number(req.params.id), d.code?.toUpperCase() ?? null, d.nameEn ?? null, d.nameAr ?? null,
       d.startTime ?? null, d.endTime ?? null, d.sortOrder ?? null, d.isActive ?? null]
    );
    if (!rows.length) return res.status(404).json({ error: 'Shift not found' });
    logAction(req, { action: 'shift.update', entity: 'shift_type', entityId: rows[0].id, details: d });
    res.json(shape(rows[0]));
  })
);

export default router;
