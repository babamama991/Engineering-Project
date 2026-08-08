import { Router } from 'express';
import { DateTime } from 'luxon';
import { query } from '../db.js';
import { asyncHandler } from '../middleware/error.js';
import { loadShiftTypes, resolveShiftFromClock } from '../utils/shifts.js';
import { getSetting } from '../utils/settings.js';

// Mounted admin-only.
const router = Router();

/**
 * Live picture of the shift that is happening right now: which locations are
 * covered, by whom, how far along, and what has failed.
 */
router.get(
  '/live',
  asyncHandler(async (req, res) => {
    const tz = await getSetting('timezone', 'Asia/Beirut');
    const shifts = await loadShiftTypes();
    const now = DateTime.now().setZone(tz);

    // resolveShiftFromClock returns null when no shift types are active, and
    // everything below reads clock.shift — which crashed with an unhelpful
    // "Cannot read properties of null" on a database that was never seeded.
    // resolveUserShift already guards this; the dashboard calls the raw
    // function, so it has to guard too. 409 = configuration is missing, and the
    // message says which.
    const clock = resolveShiftFromClock(shifts, now);
    if (!clock) {
      return res.status(409).json({
        error: 'No shift types are configured. Add them under Settings, or seed the database.',
        code: 'NO_SHIFT_TYPES',
      });
    }

    // Allow the admin to look at a different shift/date than "now".
    // Validate before it reaches ::date, or a typo becomes a 500.
    const dateParam = req.query.date;
    if (dateParam && !/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
      return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
    }
    const businessDate = dateParam || clock.businessDate;

    const shiftParam = Number(req.query.shiftId);
    const shiftId = Number.isInteger(shiftParam) && shiftParam > 0 ? shiftParam : clock.shift.id;

    const [locations, runs, failures, rostered] = await Promise.all([
      query(
        `SELECT id, name_en, name_ar, sort_order,
                (SELECT count(*)::int FROM tasks t
                  WHERE t.location_id = o.id AND t.deleted_at IS NULL AND t.is_active) AS total_tasks
           FROM locations o
          WHERE deleted_at IS NULL AND is_active
          ORDER BY sort_order, name_en`
      ),
      query(
        `SELECT r.id, r.location_id, r.user_id, r.status, r.source,
                r.started_at, r.completed_at,
                u.full_name, u.username,
                p.total_tasks, p.answered_tasks, p.failed_tasks,
                (SELECT max(a.answered_at) FROM task_answers a WHERE a.run_id = r.id) AS last_activity
           FROM checklist_runs r
           JOIN users u ON u.id = r.user_id
           JOIN v_run_progress p ON p.run_id = r.id
          WHERE r.business_date = $1::date AND r.shift_type_id = $2
          ORDER BY r.started_at`,
        [businessDate, shiftId]
      ),
      query(
        `SELECT * FROM v_report_rows
          WHERE business_date = $1::date AND answer = FALSE
          ORDER BY is_critical DESC, answered_at DESC
          LIMIT 100`,
        [businessDate]
      ),
      query(
        `SELECT sa.user_id, u.full_name, u.username
           FROM shift_assignments sa
           JOIN users u ON u.id = sa.user_id
          WHERE sa.work_date = $1::date AND sa.shift_type_id = $2
            AND u.deleted_at IS NULL AND u.is_active
          ORDER BY u.full_name`,
        [businessDate, shiftId]
      ),
    ]);

    const runsByOutlet = new Map();
    for (const r of runs.rows) {
      if (!runsByOutlet.has(r.location_id)) runsByOutlet.set(r.location_id, []);
      runsByOutlet.get(r.location_id).push({
        runId: r.id,
        userId: r.user_id,
        userName: r.full_name,
        username: r.username,
        status: r.status,
        source: r.source,
        total: r.total_tasks,
        answered: r.answered_tasks,
        failed: r.failed_tasks,
        startedAt: r.started_at,
        completedAt: r.completed_at,
        lastActivity: r.last_activity,
      });
    }

    const activeUserIds = new Set(runs.rows.map((r) => r.user_id));

    res.json({
      businessDate,
      shiftId,
      shifts: shifts.map((s) => ({
        id: s.id, code: s.code, nameEn: s.name_en, nameAr: s.name_ar,
        startTime: s.start_time, endTime: s.end_time,
      })),
      serverTime: now.toISO(),
      locations: locations.rows.map((o) => {
        const list = runsByOutlet.get(o.id) || [];
        return {
          id: o.id,
          nameEn: o.name_en,
          nameAr: o.name_ar,
          totalTasks: o.total_tasks,
          coverage: list.length === 0 ? 'untouched'
            : list.some((r) => r.status === 'completed') ? 'completed'
            : 'in_progress',
          runs: list,
        };
      }),
      // Rostered but hasn't opened anything yet this shift.
      notStarted: rostered.rows
        .filter((r) => !activeUserIds.has(r.user_id))
        .map((r) => ({ userId: r.user_id, userName: r.full_name, username: r.username })),
      // Working without a roster entry.
      unscheduled: runs.rows
        .filter((r) => r.source === 'unscheduled')
        .map((r) => ({ userId: r.user_id, userName: r.full_name, runId: r.id })),
      failures: failures.rows.map((f) => ({
        answerId: f.answer_id,
        userName: f.full_name,
        outletNameEn: f.location_name_en,
        outletNameAr: f.location_name_ar,
        taskTitleEn: f.task_description_en,
        taskTitleAr: f.task_description_ar,
        isCritical: f.is_critical,
        comment: f.comment,
        answeredAt: f.answered_at,
        shiftCode: f.shift_code,
        photoCount: f.photo_count,
      })),
    });
  })
);

/** Headline numbers for a date range — the cards at the top of the dashboard. */
router.get(
  '/stats',
  asyncHandler(async (req, res) => {
    const from = req.query.from || DateTime.now().minus({ days: 6 }).toISODate();
    const to = req.query.to || DateTime.now().toISODate();

    const { rows } = await query(
      `SELECT
         (SELECT count(*)::int FROM checklist_runs
           WHERE business_date BETWEEN $1::date AND $2::date)                        AS runs,
         (SELECT count(*)::int FROM checklist_runs
           WHERE business_date BETWEEN $1::date AND $2::date AND status = 'completed') AS completed_runs,
         (SELECT count(*)::int FROM checklist_runs
           WHERE business_date BETWEEN $1::date AND $2::date AND source = 'unscheduled') AS unscheduled_runs,
         (SELECT count(*)::int FROM v_report_rows
           WHERE business_date BETWEEN $1::date AND $2::date)                        AS answers,
         (SELECT count(*)::int FROM v_report_rows
           WHERE business_date BETWEEN $1::date AND $2::date AND answer = FALSE)     AS failures,
         (SELECT count(*)::int FROM v_report_rows
           WHERE business_date BETWEEN $1::date AND $2::date
             AND answer = FALSE AND is_critical)                                     AS critical_failures,
         (SELECT count(DISTINCT user_id)::int FROM checklist_runs
           WHERE business_date BETWEEN $1::date AND $2::date)                        AS active_users`,
      [from, to]
    );

    const byDay = await query(
      `SELECT business_date::text AS date,
              count(*)::int                                     AS answers,
              count(*) FILTER (WHERE answer = FALSE)::int       AS failures
         FROM v_report_rows
        WHERE business_date BETWEEN $1::date AND $2::date
        GROUP BY business_date ORDER BY business_date`,
      [from, to]
    );

    res.json({ from, to, ...rows[0], byDay: byDay.rows });
  })
);

/** Recent admin actions — the audit trail view. */
router.get(
  '/activity',
  asyncHandler(async (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const { rows } = await query(
      `SELECT a.*, u.full_name FROM audit_log a
         LEFT JOIN users u ON u.id = a.actor_id
        ORDER BY a.created_at DESC LIMIT $1`,
      [limit]
    );
    res.json(
      rows.map((r) => ({
        id: r.id,
        actor: r.full_name || 'system',
        action: r.action,
        entity: r.entity,
        entityId: r.entity_id,
        details: r.details,
        createdAt: r.created_at,
      }))
    );
  })
);

export default router;
