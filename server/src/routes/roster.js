import { Router } from 'express';
import { z } from 'zod';
import ExcelJS from 'exceljs';
import { DateTime } from 'luxon';
import { query, withTransaction } from '../db.js';
import { asyncHandler } from '../middleware/error.js';
import { logAction } from '../utils/audit.js';
import { getSetting } from '../utils/settings.js';
import { isManager } from '../middleware/auth.js';

const router = Router();

const shape = (r) => ({
  id: r.id,
  userId: r.user_id,
  userName: r.full_name,
  username: r.username,
  shiftTypeId: r.shift_type_id,
  shiftCode: r.code,
  workDate: r.work_date,
  notes: r.notes,
});

/**
 * Roster for a date range. Staff may only read their own rows; admin reads all.
 * GET /api/roster?from=2026-08-03&to=2026-08-09[&userId=5]
 */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { from, to } = z
      .object({
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      })
      .parse(req.query);

    // Managers see the whole schedule; staff only ever see their own rows.
    const userId = isManager(req.user)
      ? (req.query.userId ? Number(req.query.userId) : null)
      : req.user.id;

    const { rows } = await query(
      `SELECT sa.*, u.full_name, u.username, st.code
         FROM shift_assignments sa
         JOIN users u       ON u.id = sa.user_id
         JOIN shift_types st ON st.id = sa.shift_type_id
        WHERE sa.work_date BETWEEN $1::date AND $2::date
          AND u.deleted_at IS NULL
          AND ($3::int IS NULL OR sa.user_id = $3)
        ORDER BY sa.work_date, st.sort_order, u.full_name`,
      [from, to, userId]
    );
    res.json(rows.map(shape));
  })
);

const assignSchema = z.object({
  userId: z.number().int().positive(),
  shiftTypeId: z.number().int().positive(),
  workDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes: z.string().trim().nullable().optional(),
});

// The schedule is department work, so HODs manage it too. Mounted without a
// router-level guard because staff may read their own rows.
const requireAdminRole = (req, res, next) =>
  isManager(req.user) ? next() : res.status(403).json({ error: 'Admin or HOD access required' });

router.post(
  '/',
  requireAdminRole,
  asyncHandler(async (req, res) => {
    const d = assignSchema.parse(req.body);
    const { rows } = await query(
      `INSERT INTO shift_assignments (user_id, shift_type_id, work_date, notes, created_by)
       VALUES ($1,$2,$3::date,$4,$5)
       ON CONFLICT (user_id, work_date, shift_type_id)
         DO UPDATE SET notes = EXCLUDED.notes, updated_at = now()
       RETURNING *`,
      [d.userId, d.shiftTypeId, d.workDate, d.notes || null, req.user.id]
    );
    logAction(req, { action: 'roster.assign', entity: 'shift_assignment', entityId: rows[0].id, details: d });
    res.status(201).json({ id: rows[0].id, ...d });
  })
);

/**
 * Save a whole week in one call — what the admin's roster grid posts.
 * Replaces every assignment inside [from, to] so removing a cell in the UI
 * actually removes it, instead of leaving a stale row behind.
 */
router.put(
  '/bulk',
  requireAdminRole,
  asyncHandler(async (req, res) => {
    const { from, to, assignments } = z
      .object({
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        assignments: z.array(assignSchema),
      })
      .parse(req.body);

    const count = await withTransaction(async (client) => {
      await client.query(
        'DELETE FROM shift_assignments WHERE work_date BETWEEN $1::date AND $2::date',
        [from, to]
      );
      for (const a of assignments) {
        await client.query(
          `INSERT INTO shift_assignments (user_id, shift_type_id, work_date, notes, created_by)
           VALUES ($1,$2,$3::date,$4,$5)
           ON CONFLICT (user_id, work_date, shift_type_id) DO NOTHING`,
          [a.userId, a.shiftTypeId, a.workDate, a.notes || null, req.user.id]
        );
      }
      return assignments.length;
    });

    logAction(req, { action: 'roster.bulk_save', entity: 'shift_assignment', details: { from, to, count } });
    res.json({ ok: true, saved: count });
  })
);

/** Copy an entire week's roster forward — the usual way to plan next week. */
router.post(
  '/copy-week',
  requireAdminRole,
  asyncHandler(async (req, res) => {
    const { fromWeekStart, toWeekStart } = z
      .object({
        fromWeekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        toWeekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      })
      .parse(req.body);

    const { rows } = await query(
      `INSERT INTO shift_assignments (user_id, shift_type_id, work_date, notes, created_by)
       SELECT sa.user_id, sa.shift_type_id,
              sa.work_date + ($2::date - $1::date), sa.notes, $3
         FROM shift_assignments sa
         JOIN users u ON u.id = sa.user_id AND u.deleted_at IS NULL AND u.is_active
        WHERE sa.work_date BETWEEN $1::date AND $1::date + 6
       ON CONFLICT (user_id, work_date, shift_type_id) DO NOTHING
       RETURNING id`,
      [fromWeekStart, toWeekStart, req.user.id]
    );
    res.status(201).json({ copied: rows.length });
  })
);

/**
 * The schedule for a date range as a spreadsheet: one row per staff member,
 * one column per day, the shift code in the cell. Same grid the admin edits on
 * screen, so it can be printed or sent to the team.
 *
 * Declared before '/:id' — Express matches in order, and 'export.xlsx' would
 * otherwise be swallowed by the DELETE/param route family.
 * GET /api/roster/export.xlsx?from=2026-08-03&to=2026-08-09
 */
router.get(
  '/export.xlsx',
  requireAdminRole,
  asyncHandler(async (req, res) => {
    const { from, to } = z
      .object({
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      })
      .parse(req.query);

    const start = DateTime.fromISO(from);
    const end = DateTime.fromISO(to);
    if (!start.isValid || !end.isValid || end < start) {
      return res.status(400).json({ error: '"to" must be on or after "from"' });
    }
    // A year of columns would be unreadable and slow to build; the UI only ever
    // asks for a week.
    if (end.diff(start, 'days').days > 92) {
      return res.status(400).json({ error: 'Range is too long — 92 days maximum' });
    }

    const hotel = await getSetting('hotel_name', 'The SmallVille Hotel');

    const [users, shifts, assignments] = await Promise.all([
      query(
        `SELECT id, full_name, username, job_title FROM users
          WHERE deleted_at IS NULL AND is_active
          ORDER BY full_name`
      ),
      query(
        `SELECT id, code, name_en,
                to_char(start_time, 'HH24:MI') AS start_time,
                to_char(end_time,   'HH24:MI') AS end_time,
                crosses_midnight
           FROM shift_types WHERE is_active ORDER BY sort_order, id`
      ),
      query(
        `SELECT sa.user_id, sa.work_date::text AS work_date, st.code
           FROM shift_assignments sa
           JOIN shift_types st ON st.id = sa.shift_type_id
           JOIN users u        ON u.id = sa.user_id
          WHERE sa.work_date BETWEEN $1::date AND $2::date
            AND u.deleted_at IS NULL`,
        [from, to]
      ),
    ]);

    const byCell = new Map();
    for (const a of assignments.rows) {
      const key = `${a.user_id}|${a.work_date}`;
      // Someone rostered twice in a day gets both codes rather than one silently
      // winning.
      byCell.set(key, byCell.has(key) ? `${byCell.get(key)} + ${a.code}` : a.code);
    }

    const days = [];
    for (let d = start; d <= end; d = d.plus({ days: 1 })) days.push(d);

    const wb = new ExcelJS.Workbook();
    wb.creator = hotel;
    wb.created = new Date();

    const ws = wb.addWorksheet('Schedule', {
      // Freeze the name column and the header row so scrolling a long team or a
      // long range keeps both anchors on screen.
      views: [{ state: 'frozen', xSplit: 2, ySplit: 2 }],
    });

    ws.mergeCells(1, 1, 1, days.length + 2);
    const title = ws.getCell(1, 1);
    title.value = `${hotel} — Engineering schedule · ${from} to ${to}`;
    title.font = { bold: true, size: 13 };
    title.alignment = { vertical: 'middle' };
    ws.getRow(1).height = 24;

    const header = ['Staff', 'Username', ...days.map((d) => d.toFormat('ccc dd LLL'))];
    const headerRow = ws.getRow(2);
    headerRow.values = header;
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF131316' } };
    headerRow.alignment = { horizontal: 'center', vertical: 'middle' };
    headerRow.height = 20;
    headerRow.getCell(1).alignment = { horizontal: 'left', vertical: 'middle' };
    headerRow.getCell(2).alignment = { horizontal: 'left', vertical: 'middle' };

    ws.getColumn(1).width = 26;
    ws.getColumn(2).width = 16;
    days.forEach((_, i) => (ws.getColumn(i + 3).width = 12));

    users.rows.forEach((u, i) => {
      const row = ws.getRow(i + 3);
      row.values = [
        u.full_name,
        `@${u.username}`,
        ...days.map((d) => byCell.get(`${u.id}|${d.toISODate()}`) || '—'),
      ];
      row.alignment = { horizontal: 'center', vertical: 'middle' };
      row.getCell(1).alignment = { horizontal: 'left', vertical: 'middle' };
      row.getCell(2).alignment = { horizontal: 'left', vertical: 'middle' };

      days.forEach((d, di) => {
        const cell = row.getCell(di + 3);
        const isWeekend = d.weekday >= 6;
        if (cell.value === '—') {
          // Days off stay legible but recede, so the pattern of who is on when
          // is what the eye picks up.
          cell.font = { color: { argb: 'FFB0B0B8' } };
          if (isWeekend) {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF4F4F8' } };
          }
        } else {
          cell.font = { bold: true, color: { argb: 'FF131316' } };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF3D6' } };
        }
      });
    });

    if (!users.rows.length) {
      ws.getCell(3, 1).value = 'No active staff.';
    }

    // --- Sheet 2: what the codes mean ---------------------------------------
    const legend = wb.addWorksheet('Shifts');
    legend.columns = [
      { header: 'Code',  key: 'code',  width: 10 },
      { header: 'Name',  key: 'name',  width: 18 },
      { header: 'Start', key: 'start', width: 10 },
      { header: 'End',   key: 'end',   width: 10 },
      { header: 'Notes', key: 'notes', width: 34 },
    ];
    legend.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    legend.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF131316' } };
    for (const s of shifts.rows) {
      legend.addRow({
        code: s.code,
        name: s.name_en,
        start: s.start_time,
        end: s.end_time,
        notes: s.crosses_midnight
          ? 'Crosses midnight — stays on the day it started'
          : '',
      });
    }

    const name = `schedule_${from}_to_${to}.xlsx`;
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    await wb.xlsx.write(res);
    res.end();
  })
);

router.delete(
  '/:id',
  requireAdminRole,
  asyncHandler(async (req, res) => {
    const { rowCount } = await query('DELETE FROM shift_assignments WHERE id = $1', [
      Number(req.params.id),
    ]);
    if (!rowCount) return res.status(404).json({ error: 'Assignment not found' });
    logAction(req, { action: 'roster.unassign', entity: 'shift_assignment', entityId: Number(req.params.id) });
    res.json({ ok: true });
  })
);

export default router;
