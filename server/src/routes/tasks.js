import { Router } from 'express';
import { z } from 'zod';
import multer from 'multer';
import ExcelJS from 'exceljs';
import { query, withTransaction } from '../db.js';
import { asyncHandler } from '../middleware/error.js';
import { requireManager, isManager } from '../middleware/auth.js';
import { logAction } from '../utils/audit.js';
import { findHeader, readRows, splitTitle } from '../utils/importSheet.js';

const router = Router();

const shape = (t) => ({
  id: t.id,
  locationId: t.location_id,
  subLocationId: t.sub_location_id,
  subLocationNameEn: t.sub_location_name_en ?? null,
  subLocationNameAr: t.sub_location_name_ar ?? null,
  subLocationIcon: t.category_icon ?? null,
  descriptionEn: t.description_en,
  descriptionAr: t.description_ar,
  notesEn: t.notes_en,
  notesAr: t.notes_ar,
  frequency: t.frequency,
  requiresPhoto: t.requires_photo,
  isCritical: t.is_critical,
  sortOrder: t.sort_order,
  isActive: t.is_active,
});

/** Master task list, optionally filtered by location. Admin panel view. */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const locationId = req.query.locationId ? Number(req.query.locationId) : null;
    const includeInactive = req.query.includeInactive === 'true' && isManager(req.user);

    const { rows } = await query(
      `SELECT t.*, c.name_en AS sub_location_name_en, c.name_ar AS sub_location_name_ar,
              c.icon AS category_icon, c.sort_order AS sub_location_sort
         FROM tasks t
         LEFT JOIN sub_locations c ON c.id = t.sub_location_id
        WHERE t.deleted_at IS NULL
          ${includeInactive ? '' : 'AND t.is_active'}
          AND ($1::int IS NULL OR t.location_id = $1)
        ORDER BY COALESCE(c.sort_order, 9999), c.name_en NULLS LAST, t.sort_order, t.id`,
      [locationId]
    );
    res.json(rows.map(shape));
  })
);

// ---------------------------------------------------------------------------
// Excel import
// ---------------------------------------------------------------------------

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    if (/\.xlsx$/i.test(file.originalname)) return cb(null, true);
    cb(
      Object.assign(new Error('Please upload an .xlsx file (Excel workbook)'), { status: 400 })
    );
  },
});

/** Stable short code for an location, derived from its name. 'Red Street' -> 'RED_STREET'. */
const outletCode = (name) =>
  name.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || 'LOCATION';

/**
 * Import a checklist spreadsheet.
 *
 * Creates any Location (location) and Sub-Location (subLocation) it hasn't seen
 * before, then adds the tasks. Re-importing the same file adds nothing — a task
 * is matched on (location, subLocation, English title), so the sheet is safe to fix
 * and re-upload. Everything runs in one transaction: a bad row half way down
 * rolls back the whole import rather than leaving a partial checklist.
 *
 * POST /api/tasks/import   (multipart/form-data, field name "file")
 */
router.post(
  '/import',
  requireManager,
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file received' });

    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(req.file.buffer);
    } catch {
      return res.status(400).json({ error: 'That file could not be read as an Excel workbook' });
    }

    const sheetName = req.body.sheet;
    const ws = sheetName ? wb.getWorksheet(sheetName) : wb.worksheets[0];
    if (!ws) return res.status(400).json({ error: 'The workbook has no readable sheet' });

    const header = findHeader(ws);
    const { rows, skipped } = readRows(ws, header);

    if (!rows.length) {
      return res.status(400).json({
        error: 'No task rows found under the header',
        skipped,
      });
    }

    const result = await withTransaction(async (client) => {
      const outletsCreated = [];
      const categoriesCreated = [];
      let tasksCreated = 0;
      const duplicates = [];

      // name -> id, so each distinct Location/Sub-Location is resolved once.
      const locationIds = new Map();
      const subLocationIds = new Map();
      const sortCounters = new Map();

      const resolveOutlet = async (name) => {
        if (locationIds.has(name)) return locationIds.get(name);

        const found = await client.query(
          'SELECT id FROM locations WHERE name_en = $1 AND deleted_at IS NULL',
          [name]
        );
        if (found.rows.length) {
          locationIds.set(name, found.rows[0].id);
          return found.rows[0].id;
        }

        const t = splitTitle(name);
        // locations.code is unique among live rows; suffix on collision rather
        // than failing the whole import over a name clash.
        let code = outletCode(name);
        for (let i = 2; ; i++) {
          const clash = await client.query(
            'SELECT 1 FROM locations WHERE code = $1 AND deleted_at IS NULL',
            [code]
          );
          if (!clash.rows.length) break;
          code = `${outletCode(name)}_${i}`.slice(0, 40);
        }

        const ins = await client.query(
          `INSERT INTO locations (code, name_en, name_ar, sort_order)
           VALUES ($1,$2,$3,$4) RETURNING id`,
          [code, t.en, t.ar, locationIds.size + 1]
        );
        locationIds.set(name, ins.rows[0].id);
        outletsCreated.push(t.en);
        return ins.rows[0].id;
      };

      const resolveCategory = async (name) => {
        if (!name) return null;
        if (subLocationIds.has(name)) return subLocationIds.get(name);

        const found = await client.query(
          'SELECT id FROM sub_locations WHERE name_en = $1 AND deleted_at IS NULL',
          [name]
        );
        if (found.rows.length) {
          subLocationIds.set(name, found.rows[0].id);
          return found.rows[0].id;
        }

        const t = splitTitle(name);
        const ins = await client.query(
          `INSERT INTO sub_locations (name_en, name_ar, sort_order)
           VALUES ($1,$2,$3) RETURNING id`,
          [t.en, t.ar, subLocationIds.size + 1]
        );
        subLocationIds.set(name, ins.rows[0].id);
        categoriesCreated.push(t.en);
        return ins.rows[0].id;
      };

      for (const r of rows) {
        const locationId = await resolveOutlet(r.location);
        const subLocationId = await resolveCategory(r.subLocation);

        const exists = await client.query(
          `SELECT 1 FROM tasks
            WHERE location_id = $1 AND description_en = $2 AND deleted_at IS NULL
              AND sub_location_id IS NOT DISTINCT FROM $3`,
          [locationId, r.descriptionEn, subLocationId]
        );
        if (exists.rows.length) {
          duplicates.push({ row: r.excelRow, title: r.descriptionEn, subLocation: r.subLocation });
          continue;
        }

        const key = `${locationId}|${subLocationId ?? 0}`;
        const next = (sortCounters.get(key) ?? 0) + 10;
        sortCounters.set(key, next);

        await client.query(
          `INSERT INTO tasks (location_id, sub_location_id, description_en, description_ar, sort_order, created_by)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [locationId, subLocationId, r.descriptionEn, r.descriptionAr, next, req.user.id]
        );
        tasksCreated++;
      }

      return { outletsCreated, categoriesCreated, tasksCreated, duplicates };
    });

    logAction(req, {
      action: 'tasks.import',
      entity: 'task',
      details: {
        file: req.file.originalname,
        sheet: ws.name,
        tasks: result.tasksCreated,
        locations: result.outletsCreated.length,
        subLocations: result.categoriesCreated.length,
      },
    });

    res.status(201).json({
      sheet: ws.name,
      rowsRead: rows.length,
      tasksCreated: result.tasksCreated,
      locationsCreated: result.outletsCreated,
      subLocationsCreated: result.categoriesCreated,
      // Rows already present — the usual case when re-uploading a corrected sheet.
      duplicatesSkipped: result.duplicates,
      // Rows that couldn't be used at all, with the reason and the Excel row number.
      rowsSkipped: skipped,
      withoutArabic: rows.filter((r) => !r.hasArabic).length,
    });
  })
);

const schema = z.object({
  locationId: z.number().int().positive(),
  subLocationId: z.number().int().positive().nullable().optional(),
  descriptionEn: z.string().trim().min(1),
  // Optional: a row imported without Arabic stores NULL, and a HOD must be
  // able to save edits to that row before getting round to translating it.
  descriptionAr: z.string().trim().min(1).nullable().optional(),
  notesEn: z.string().trim().nullable().optional(),
  notesAr: z.string().trim().nullable().optional(),
  frequency: z.enum(['every_shift', 'daily', 'weekly']).default('every_shift'),
  requiresPhoto: z.boolean().default(false),
  isCritical: z.boolean().default(false),
  sortOrder: z.number().int().default(0),
  isActive: z.boolean().default(true),
});

router.post(
  '/',
  requireManager,
  asyncHandler(async (req, res) => {
    const d = schema.parse(req.body);
    const { rows } = await query(
      `INSERT INTO tasks (location_id, sub_location_id, description_en, description_ar, notes_en,
                          notes_ar, frequency, requires_photo, is_critical,
                          sort_order, is_active, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [d.locationId, d.subLocationId ?? null, d.descriptionEn, d.descriptionAr, d.notesEn || null,
       d.notesAr || null, d.frequency, d.requiresPhoto, d.isCritical,
       d.sortOrder, d.isActive, req.user.id]
    );
    logAction(req, { action: 'task.create', entity: 'task', entityId: rows[0].id, details: d });
    res.status(201).json(shape(rows[0]));
  })
);

/**
 * Copy every task from one location into another. Saves the admin retyping 60
 * tasks when a new location opens with the same standard checklist.
 */
router.post(
  '/copy',
  requireManager,
  asyncHandler(async (req, res) => {
    const { fromOutletId, toOutletId } = z
      .object({
        fromOutletId: z.number().int().positive(),
        toOutletId: z.number().int().positive(),
      })
      .parse(req.body);

    if (fromOutletId === toOutletId) {
      return res.status(400).json({ error: 'Source and target location are the same' });
    }

    const { rows } = await query(
      `INSERT INTO tasks (location_id, sub_location_id, description_en, description_ar, notes_en,
                          notes_ar, frequency, requires_photo, is_critical,
                          sort_order, is_active, created_by)
       SELECT $2, sub_location_id, description_en, description_ar, notes_en, notes_ar,
              frequency, requires_photo, is_critical, sort_order, is_active, $3
         FROM tasks
        WHERE location_id = $1 AND deleted_at IS NULL AND is_active
       RETURNING id`,
      [fromOutletId, toOutletId, req.user.id]
    );

    logAction(req, {
      action: 'task.copy', entity: 'location', entityId: toOutletId,
      details: { fromOutletId, copied: rows.length },
    });
    res.status(201).json({ copied: rows.length });
  })
);

/** Drag-to-reorder: [{ id, sortOrder }, ...] applied in one transaction. */
router.patch(
  '/reorder',
  requireManager,
  asyncHandler(async (req, res) => {
    const { items } = z
      .object({
        items: z
          .array(z.object({ id: z.number().int(), sortOrder: z.number().int() }))
          .min(1),
      })
      .parse(req.body);

    await withTransaction(async (client) => {
      for (const it of items) {
        await client.query('UPDATE tasks SET sort_order = $2 WHERE id = $1', [it.id, it.sortOrder]);
      }
    });
    res.json({ ok: true, updated: items.length });
  })
);

router.patch(
  '/:id',
  requireManager,
  asyncHandler(async (req, res) => {
    const d = schema.partial().parse(req.body);
    const { rows } = await query(
      `UPDATE tasks SET
         location_id       = COALESCE($2, location_id),
         sub_location_id     = COALESCE($3, sub_location_id),
         description_en        = COALESCE($4, description_en),
         description_ar        = COALESCE($5, description_ar),
         notes_en  = COALESCE($6, notes_en),
         notes_ar  = COALESCE($7, notes_ar),
         frequency       = COALESCE($8, frequency),
         requires_photo  = COALESCE($9, requires_photo),
         is_critical     = COALESCE($10, is_critical),
         sort_order      = COALESCE($11, sort_order),
         is_active       = COALESCE($12, is_active)
       WHERE id = $1 AND deleted_at IS NULL RETURNING *`,
      [Number(req.params.id), d.locationId ?? null, d.subLocationId ?? null, d.descriptionEn ?? null,
       d.descriptionAr ?? null, d.notesEn ?? null, d.notesAr ?? null, d.frequency ?? null,
       d.requiresPhoto ?? null, d.isCritical ?? null, d.sortOrder ?? null, d.isActive ?? null]
    );
    if (!rows.length) return res.status(404).json({ error: 'Task not found' });
    logAction(req, { action: 'task.update', entity: 'task', entityId: rows[0].id, details: d });
    res.json(shape(rows[0]));
  })
);

/**
 * Soft delete. The task vanishes from every checklist immediately, but past
 * answers keep resolving its title, so old reports never break or go blank.
 */
router.delete(
  '/:id',
  requireManager,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const { rowCount } = await query(
      `UPDATE tasks SET deleted_at = now(), is_active = FALSE
        WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    if (!rowCount) return res.status(404).json({ error: 'Task not found' });
    logAction(req, { action: 'task.delete', entity: 'task', entityId: id });
    res.json({ ok: true });
  })
);

export default router;
