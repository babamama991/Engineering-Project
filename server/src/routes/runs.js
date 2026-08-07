import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { Router } from 'express';
import multer from 'multer';
import sharp from 'sharp';
import { z } from 'zod';

import { config } from '../config.js';
import { query } from '../db.js';
import { asyncHandler } from '../middleware/error.js';
import { resolveUserShift, isoWeekBounds } from '../utils/shifts.js';
import { getSetting } from '../utils/settings.js';
import { isManager } from '../middleware/auth.js';

const router = Router();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Find the user's run for this location in the current shift, creating it if it
 * doesn't exist yet. This is where the "reset" happens: a new shift produces a
 * new (user, location, business_date, shift) tuple, so a brand-new empty run.
 */
async function findOrCreateRun(userId, locationId) {
  const s = await resolveUserShift(userId);

  if (s.source === 'unscheduled' && !(await getSetting('allow_unscheduled', true))) {
    const err = new Error(
      'You are not on the roster for this shift. Ask the admin to schedule you.'
    );
    err.status = 403;
    throw err;
  }

  // ON CONFLICT makes this safe when the user double-taps an location and two
  // requests race — the second one returns the row the first just made.
  const { rows } = await query(
    `INSERT INTO checklist_runs
        (user_id, location_id, shift_type_id, business_date, source, shift_assignment_id)
     VALUES ($1,$2,$3,$4::date,$5,$6)
     ON CONFLICT (user_id, location_id, business_date, shift_type_id)
       DO UPDATE SET user_id = EXCLUDED.user_id
     RETURNING *`,
    [userId, locationId, s.shift.id, s.businessDate, s.source, s.assignmentId]
  );

  return { run: rows[0], shift: s };
}

/**
 * The checklist for a run: every active task in the location, plus this run's
 * answer, plus any "carried over" answer from an earlier run for daily/weekly
 * tasks (which the user sees as already done, read-only, with who and when).
 */
async function loadChecklist(run) {
  const { start: weekStart, end: weekEnd } = isoWeekBounds(run.business_date);

  const { rows } = await query(
    `SELECT
        t.id, t.description_en, t.description_ar, t.notes_en, t.notes_ar,
        t.frequency, t.requires_photo, t.is_critical, t.sort_order,
        t.sub_location_id,
        c.name_en AS sub_location_name_en, c.name_ar AS sub_location_name_ar,
        c.icon    AS category_icon,
        COALESCE(c.sort_order, 9999) AS sub_location_sort,

        a.id AS answer_id, a.answer, a.comment, a.answered_at, a.revision,

        co.answer      AS carry_answer,
        co.comment     AS carry_comment,
        co.answered_at AS carry_answered_at,
        co.full_name   AS carry_user_name,
        co.shift_code  AS carry_shift_code,

        COALESCE(ph.photos, '[]'::json) AS photos
     FROM tasks t
     LEFT JOIN sub_locations c ON c.id = t.sub_location_id AND c.deleted_at IS NULL
     LEFT JOIN task_answers a    ON a.task_id = t.id AND a.run_id = $1

     -- Most recent answer for this task, in this location, inside the task's
     -- frequency window, from a DIFFERENT run.
     LEFT JOIN LATERAL (
        SELECT a2.answer, a2.comment, a2.answered_at, u2.full_name, st2.code AS shift_code
          FROM task_answers a2
          JOIN checklist_runs r2 ON r2.id = a2.run_id
          JOIN users u2          ON u2.id = r2.user_id
          JOIN shift_types st2   ON st2.id = r2.shift_type_id
         WHERE a2.task_id = t.id
           AND r2.location_id = $2
           AND r2.id <> $1
           AND (
                 (t.frequency = 'daily'  AND r2.business_date = $3::date)
              OR (t.frequency = 'weekly' AND r2.business_date BETWEEN $4::date AND $5::date)
               )
         ORDER BY a2.answered_at DESC
         LIMIT 1
     ) co ON TRUE

     LEFT JOIN LATERAL (
        SELECT json_agg(json_build_object(
                 'id', p.id, 'url', '/uploads/' || p.file_path, 'uploadedAt', p.uploaded_at
               ) ORDER BY p.uploaded_at) AS photos
          FROM task_photos p WHERE p.answer_id = a.id
     ) ph ON TRUE

    WHERE t.location_id = $2 AND t.deleted_at IS NULL AND t.is_active
    ORDER BY sub_location_sort, c.name_en NULLS LAST, t.sort_order, t.id`,
    [run.id, run.location_id, run.business_date, weekStart, weekEnd]
  );

  // Group into the collapsible sections the phone UI renders.
  const groups = new Map();
  for (const r of rows) {
    const key = r.sub_location_id ?? 0;
    if (!groups.has(key)) {
      groups.set(key, {
        subLocationId: r.sub_location_id,
        nameEn: r.sub_location_name_en || 'Uncategorised',
        nameAr: r.sub_location_name_ar || 'غير مصنّف',
        icon: r.category_icon,
        tasks: [],
      });
    }
    groups.get(key).tasks.push({
      id: r.id,
      descriptionEn: r.description_en,
      descriptionAr: r.description_ar,
      notesEn: r.notes_en,
      notesAr: r.notes_ar,
      frequency: r.frequency,
      requiresPhoto: r.requires_photo,
      isCritical: r.is_critical,
      answer: r.answer,
      comment: r.comment,
      answeredAt: r.answered_at,
      revision: r.revision,
      photos: r.photos,
      // Present when a daily/weekly task was already done earlier in the period.
      carriedOver: r.carry_answered_at
        ? {
            answer: r.carry_answer,
            comment: r.carry_comment,
            answeredAt: r.carry_answered_at,
            byName: r.carry_user_name,
            shiftCode: r.carry_shift_code,
          }
        : null,
    });
  }

  const subLocations = [...groups.values()];
  const flat = rows;
  return {
    subLocations,
    summary: {
      total: flat.length,
      answered: flat.filter((r) => r.answer !== null).length,
      failed: flat.filter((r) => r.answer === false).length,
      carriedOver: flat.filter((r) => r.answer === null && r.carry_answered_at).length,
    },
  };
}

const runShape = (run, shift) => ({
  id: run.id,
  locationId: run.location_id,
  businessDate: run.business_date,
  status: run.status,
  source: run.source,
  startedAt: run.started_at,
  completedAt: run.completed_at,
  shift: shift && {
    id: shift.shift.id,
    code: shift.shift.code,
    nameEn: shift.shift.name_en,
    nameAr: shift.shift.name_ar,
    startTime: shift.shift.start_time,
    endTime: shift.shift.end_time,
  },
});

/** Loads a run and checks the caller is allowed to write to it. */
async function loadOwnedRun(runId, user) {
  const { rows } = await query('SELECT * FROM checklist_runs WHERE id = $1', [runId]);
  const run = rows[0];
  if (!run) {
    const e = new Error('Checklist not found');
    e.status = 404;
    throw e;
  }
  if (run.user_id !== user.id && !isManager(user)) {
    const e = new Error('This checklist belongs to another user');
    e.status = 403;
    throw e;
  }
  return run;
}

async function assertWritable(run) {
  if (run.status === 'completed' && (await getSetting('lock_run_on_complete', false))) {
    const e = new Error('This checklist was submitted and is now locked');
    e.status = 423;
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/**
 * The staff app's main call: open an location.
 * GET /api/runs/current?locationId=3
 */
router.get(
  '/current',
  asyncHandler(async (req, res) => {
    const { locationId } = z
      .object({ locationId: z.coerce.number().int().positive() })
      .parse(req.query);

    const { rows: locations } = await query(
      `SELECT id, name_en, name_ar, location FROM locations
        WHERE id = $1 AND deleted_at IS NULL AND is_active`,
      [locationId]
    );
    if (!locations.length) return res.status(404).json({ error: 'Location not found' });

    const { run, shift } = await findOrCreateRun(req.user.id, locationId);
    const checklist = await loadChecklist(run);

    res.json({
      run: runShape(run, shift),
      location: {
        id: locations[0].id,
        nameEn: locations[0].name_en,
        nameAr: locations[0].name_ar,
        location: locations[0].location,
      },
      ...checklist,
    });
  })
);

/** Progress across all locations for the current shift — the staff home screen. */
router.get(
  '/my-progress',
  asyncHandler(async (req, res) => {
    const s = await resolveUserShift(req.user.id);
    const { rows } = await query(
      `SELECT o.id AS location_id,
              COALESCE(p.total_tasks, (
                SELECT count(*)::int FROM tasks t
                 WHERE t.location_id = o.id AND t.deleted_at IS NULL AND t.is_active)) AS total,
              COALESCE(p.answered_tasks, 0) AS answered,
              COALESCE(p.failed_tasks, 0)   AS failed,
              r.status
         FROM locations o
         LEFT JOIN checklist_runs r
                ON r.location_id = o.id AND r.user_id = $1
               AND r.business_date = $2::date AND r.shift_type_id = $3
         LEFT JOIN v_run_progress p ON p.run_id = r.id
        WHERE o.deleted_at IS NULL AND o.is_active
        ORDER BY o.sort_order, o.name_en`,
      [req.user.id, s.businessDate, s.shift.id]
    );

    res.json({
      shift: {
        id: s.shift.id, code: s.shift.code,
        nameEn: s.shift.name_en, nameAr: s.shift.name_ar,
        startTime: s.shift.start_time, endTime: s.shift.end_time,
        businessDate: s.businessDate, source: s.source,
      },
      locations: rows.map((r) => ({
        locationId: r.location_id,
        total: r.total,
        answered: r.answered,
        failed: r.failed,
        status: r.status || 'not_started',
      })),
    });
  })
);

/**
 * Save one tick. Called the moment the user presses Yes or No, so the
 * timestamp is the real time the task was checked.
 * PUT /api/runs/:runId/answers/:taskId
 */
const answerSchema = z.object({
  answer: z.boolean(),
  comment: z.string().trim().max(2000).nullable().optional(),
});

router.put(
  '/:runId/answers/:taskId',
  asyncHandler(async (req, res) => {
    const runId = Number(req.params.runId);
    const taskId = Number(req.params.taskId);
    const d = answerSchema.parse(req.body);

    const run = await loadOwnedRun(runId, req.user);
    await assertWritable(run);

    if (d.answer === false && !d.comment?.trim()) {
      return res.status(400).json({
        error: 'Please write what is wrong before saving a No',
        code: 'COMMENT_REQUIRED',
      });
    }

    // The task must actually belong to this run's location.
    const { rows: taskRows } = await query(
      `SELECT id FROM tasks
        WHERE id = $1 AND location_id = $2 AND deleted_at IS NULL AND is_active`,
      [taskId, run.location_id]
    );
    if (!taskRows.length) {
      return res.status(404).json({ error: 'That task is not on this location’s checklist' });
    }

    // Re-answering bumps revision; the trigger writes the old value to history.
    const { rows } = await query(
      `INSERT INTO task_answers (run_id, task_id, answer, comment, answered_by)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (run_id, task_id) DO UPDATE
         SET answer      = EXCLUDED.answer,
             comment     = EXCLUDED.comment,
             answered_by = EXCLUDED.answered_by,
             -- The report's timestamp must be when the CURRENT answer was
             -- given; the previous one is preserved in task_answer_history.
             answered_at = now(),
             revision    = task_answers.revision + 1
       RETURNING *`,
      [runId, taskId, d.answer, d.comment?.trim() || null, req.user.id]
    );

    res.json({
      id: rows[0].id,
      taskId,
      answer: rows[0].answer,
      comment: rows[0].comment,
      answeredAt: rows[0].answered_at,
      revision: rows[0].revision,
    });
  })
);

/** Clears an answer — the task goes back to unticked. */
router.delete(
  '/:runId/answers/:taskId',
  asyncHandler(async (req, res) => {
    const run = await loadOwnedRun(Number(req.params.runId), req.user);
    await assertWritable(run);
    await query('DELETE FROM task_answers WHERE run_id = $1 AND task_id = $2', [
      run.id, Number(req.params.taskId),
    ]);
    res.json({ ok: true });
  })
);

/** Full edit trail for one answer — who changed it, from what, when. */
router.get(
  '/:runId/answers/:taskId/history',
  asyncHandler(async (req, res) => {
    const run = await loadOwnedRun(Number(req.params.runId), req.user);
    const { rows } = await query(
      `SELECT h.*, u.full_name
         FROM task_answer_history h
         JOIN users u ON u.id = h.changed_by
        WHERE h.run_id = $1 AND h.task_id = $2
        ORDER BY h.changed_at`,
      [run.id, Number(req.params.taskId)]
    );
    res.json(
      rows.map((h) => ({
        revision: h.revision,
        oldAnswer: h.old_answer,
        newAnswer: h.new_answer,
        oldComment: h.old_comment,
        newComment: h.new_comment,
        changedBy: h.full_name,
        changedAt: h.changed_at,
      }))
    );
  })
);

// --- Photo upload ----------------------------------------------------------

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadBytes, files: 1 },
  fileFilter: (req, file, cb) => {
    if (/^image\/(jpeg|png|webp|heic|heif)$/.test(file.mimetype)) return cb(null, true);
    cb(Object.assign(new Error('Only image files can be attached'), { status: 400 }));
  },
});

router.post(
  '/:runId/answers/:taskId/photos',
  upload.single('photo'),
  asyncHandler(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No photo received' });

    const run = await loadOwnedRun(Number(req.params.runId), req.user);
    await assertWritable(run);
    const taskId = Number(req.params.taskId);

    const { rows: answers } = await query(
      'SELECT id FROM task_answers WHERE run_id = $1 AND task_id = $2',
      [run.id, taskId]
    );
    if (!answers.length) {
      return res.status(409).json({ error: 'Answer the task first, then attach a photo' });
    }

    // Phone cameras produce 4-8 MB files. Downscale to something a report can
    // actually carry, and strip EXIF (which includes GPS) while we're at it.
    const buffer = await sharp(req.file.buffer)
      .rotate()
      .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 78 })
      .toBuffer();

    const folder = run.business_date.slice(0, 7); // YYYY-MM
    const filename = `${crypto.randomUUID()}.jpg`;
    const relPath = path.posix.join(folder, filename);

    await fs.mkdir(path.join(config.uploadDir, folder), { recursive: true });
    await fs.writeFile(path.join(config.uploadDir, folder, filename), buffer);

    const { rows } = await query(
      `INSERT INTO task_photos (answer_id, run_id, task_id, file_path, original_name,
                                mime_type, size_bytes, uploaded_by)
       VALUES ($1,$2,$3,$4,$5,'image/jpeg',$6,$7) RETURNING *`,
      [answers[0].id, run.id, taskId, relPath, req.file.originalname, buffer.length, req.user.id]
    );

    res.status(201).json({
      id: rows[0].id,
      url: `/uploads/${relPath}`,
      uploadedAt: rows[0].uploaded_at,
    });
  })
);

router.delete(
  '/:runId/photos/:photoId',
  asyncHandler(async (req, res) => {
    const run = await loadOwnedRun(Number(req.params.runId), req.user);
    await assertWritable(run);

    const { rows } = await query(
      'DELETE FROM task_photos WHERE id = $1 AND run_id = $2 RETURNING file_path',
      [Number(req.params.photoId), run.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Photo not found' });

    // Best-effort file cleanup; a leftover file is harmless, a 500 is not.
    fs.unlink(path.join(config.uploadDir, rows[0].file_path)).catch(() => {});
    res.json({ ok: true });
  })
);

/** Marks the round finished. Optional — ticks are already saved. */
router.post(
  '/:runId/complete',
  asyncHandler(async (req, res) => {
    const run = await loadOwnedRun(Number(req.params.runId), req.user);

    const { rows: progress } = await query('SELECT * FROM v_run_progress WHERE run_id = $1', [run.id]);
    const p = progress[0];

    const { rows } = await query(
      `UPDATE checklist_runs SET status = 'completed', completed_at = now()
        WHERE id = $1 RETURNING *`,
      [run.id]
    );

    res.json({
      run: runShape(rows[0], null),
      summary: { total: p.total_tasks, answered: p.answered_tasks, failed: p.failed_tasks },
    });
  })
);

/** Reopen a completed round (same shift only — a new shift makes a new run). */
router.post(
  '/:runId/reopen',
  asyncHandler(async (req, res) => {
    const run = await loadOwnedRun(Number(req.params.runId), req.user);
    const { rows } = await query(
      `UPDATE checklist_runs SET status = 'in_progress', completed_at = NULL
        WHERE id = $1 RETURNING *`,
      [run.id]
    );
    res.json({ run: runShape(rows[0], null) });
  })
);

export default router;
