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

/**
 * One run in full: what was checked, what the answer was, when, and by whom —
 * plus what is still outstanding. This is what the coverage card opens into,
 * so a manager can see the detail without building a report.
 *
 * Mounted under the admin/HOD-only router, so no extra guard is needed.
 * GET /api/dashboard/runs/:runId
 */
router.get(
  '/locations/:locationId',
  asyncHandler(async (req, res) => {
    const locationId = Number(req.params.locationId);
    if (!Number.isInteger(locationId) || locationId <= 0) {
      return res.status(400).json({ error: 'Invalid location id' });
    }
    if (req.query.date && !/^\d{4}-\d{2}-\d{2}$/.test(req.query.date)) {
      return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
    }
    const shiftIdParam = Number(req.query.shiftId);
    if (!Number.isInteger(shiftIdParam) || shiftIdParam <= 0) {
      return res.status(400).json({ error: 'shiftId is required' });
    }

    const { rows: locs } = await query(
      `SELECT l.id, l.name_en AS location_name_en, l.name_ar AS location_name_ar,
              st.code AS shift_code, st.name_en AS shift_name_en, st.name_ar AS shift_name_ar
         FROM locations l
         CROSS JOIN shift_types st
        WHERE l.id = $1 AND st.id = $2 AND l.deleted_at IS NULL`,
      [locationId, shiftIdParam]
    );
    if (!locs.length) return res.status(404).json({ error: 'Location not found' });
    const head = locs[0];
    const businessDate = req.query.date;

    // Every active task in the location, with whichever answer exists for this
    // date + shift — from ANY staff member, not one person's run. Two
    // technicians splitting a location produce one combined list, which is how
    // a manager actually reads coverage.
    //
    // The LATERAL takes the most recent answer per task: if the same task was
    // answered twice, the current state wins and the earlier one stays in
    // task_answer_history.
    const { rows } = await query(
      `SELECT t.id AS task_id, t.description_en, t.description_ar, t.is_critical,
              s.name_en AS sub_location_name_en, s.name_ar AS sub_location_name_ar,
              COALESCE(s.sort_order, 9999) AS sub_location_sort,
              t.sort_order,
              a.answer, a.comment, a.answered_at, a.revision, a.answered_by_name,
              COALESCE(ph.photos, '[]'::json) AS photos
         FROM tasks t
         LEFT JOIN sub_locations s ON s.id = t.sub_location_id AND s.deleted_at IS NULL
         LEFT JOIN LATERAL (
            SELECT ta.id, ta.answer, ta.comment, ta.answered_at, ta.revision,
                   u.full_name AS answered_by_name
              FROM task_answers ta
              JOIN checklist_runs r ON r.id = ta.run_id
              JOIN users u          ON u.id = ta.answered_by
             WHERE ta.task_id = t.id
               AND r.location_id = $1
               AND r.business_date = $2::date
               AND r.shift_type_id = $3
             ORDER BY ta.answered_at DESC
             LIMIT 1
         ) a ON TRUE
         LEFT JOIN LATERAL (
            SELECT json_agg(json_build_object('id', p.id, 'url', '/uploads/' || p.file_path)) AS photos
              FROM task_photos p WHERE p.answer_id = a.id
         ) ph ON TRUE
        WHERE t.location_id = $1 AND t.deleted_at IS NULL AND t.is_active
        ORDER BY a.answered_at DESC NULLS LAST, sub_location_sort, t.sort_order, t.id`,
      [locationId, businessDate, shiftIdParam]
    );

    const tz = await getSetting('timezone', 'Asia/Beirut');
    const local = (ts) =>
      ts ? DateTime.fromJSDate(new Date(ts)).setZone(tz).toFormat('HH:mm:ss') : null;

    const tasks = rows.map((r) => ({
      taskId: r.task_id,
      descriptionEn: r.description_en,
      descriptionAr: r.description_ar,
      subLocationNameEn: r.sub_location_name_en,
      subLocationNameAr: r.sub_location_name_ar,
      isCritical: r.is_critical,
      answered: r.answered_at !== null,
      answer: r.answer,
      comment: r.comment,
      answeredAt: r.answered_at,
      localTime: local(r.answered_at),
      answeredBy: r.answered_by_name,
      revision: r.revision,
      photos: r.photos || [],
    }));

    // Who contributed, so the header can name them without the caller
    // cross-referencing the coverage card.
    const staff = [...new Set(tasks.filter((x) => x.answeredBy).map((x) => x.answeredBy))];

    res.json({
      location: {
        id: head.id,
        businessDate,
        locationNameEn: head.location_name_en,
        locationNameAr: head.location_name_ar,
        shiftCode: head.shift_code,
        shiftNameEn: head.shift_name_en,
        shiftNameAr: head.shift_name_ar,
        staff,
      },
      tasks,
      summary: {
        total: tasks.length,
        done: tasks.filter((x) => x.answered).length,
        failed: tasks.filter((x) => x.answer === false).length,
      },
    });
  })
);

/**
 * What's behind a headline number. Each stat card opens into the rows it counted,
 * so "3 critical issues" becomes three named tasks rather than a number to go
 * hunting for in Reports.
 *
 * Three shapes come back, flagged by `kind`, because the useful columns differ:
 *   answers — one row per check      (checks / issues / critical)
 *   staff   — one row per person     (activeStaff)
 *   runs    — one row per round      (unscheduled)
 *
 * GET /api/dashboard/stats/:metric?from=&to=
 */
router.get(
  '/stats/:metric',
  asyncHandler(async (req, res) => {
    const { metric } = req.params;
    const from = req.query.from || DateTime.now().minus({ days: 6 }).toISODate();
    const to = req.query.to || DateTime.now().toISODate();
    for (const d of [from, to]) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) {
        return res.status(400).json({ error: 'from/to must be YYYY-MM-DD' });
      }
    }

    const tz = await getSetting('timezone', 'Asia/Beirut');
    const local = (ts) =>
      ts ? DateTime.fromJSDate(new Date(ts)).setZone(tz).toFormat('yyyy-LL-dd HH:mm:ss') : null;

    // Capped: these are a glance at what happened, not an export. Reports does
    // the exhaustive version with filters and Excel.
    const LIMIT = 300;

    if (['checks', 'issues', 'critical'].includes(metric)) {
      const where = ['business_date BETWEEN $1::date AND $2::date'];
      if (metric !== 'checks') where.push('answer = FALSE');
      if (metric === 'critical') where.push('is_critical');

      const { rows } = await query(
        `SELECT * FROM v_report_rows
          WHERE ${where.join(' AND ')}
          ORDER BY answered_at DESC, answer_id DESC
          LIMIT ${LIMIT}`,
        [from, to]
      );

      return res.json({
        kind: 'answers',
        metric, from, to,
        count: rows.length,
        truncated: rows.length === LIMIT,
        rows: rows.map((r) => ({
          answerId: r.answer_id,
          businessDate: r.business_date,
          localTime: local(r.answered_at),
          shiftCode: r.shift_code,
          staff: r.full_name,
          locationEn: r.location_name_en,
          locationAr: r.location_name_ar,
          subLocationEn: r.sub_location_name_en,
          subLocationAr: r.sub_location_name_ar,
          taskEn: r.task_description_en,
          taskAr: r.task_description_ar,
          isCritical: r.is_critical,
          answer: r.answer,
          comment: r.comment,
          photoCount: r.photo_count,
        })),
      });
    }

    if (metric === 'activeStaff') {
      const { rows } = await query(
        // Driven off checklist_runs, matching how the headline counts
        // active_users — otherwise someone who opened a location and ticked
        // nothing is in the number but missing from the list. LEFT JOIN so they
        // appear with 0 checks, which is exactly who a manager wants to spot.
        `SELECT u.id, u.full_name, u.username, u.role,
                count(a.id)::int AS checks,
                count(a.id) FILTER (WHERE a.answer = FALSE)::int AS issues,
                max(a.answered_at) AS last_activity
           FROM checklist_runs r
           JOIN users u             ON u.id = r.user_id
           LEFT JOIN task_answers a ON a.run_id = r.id
          WHERE r.business_date BETWEEN $1::date AND $2::date
          GROUP BY u.id, u.full_name, u.username, u.role
          ORDER BY checks DESC, u.full_name`,
        [from, to]
      );
      return res.json({
        kind: 'staff',
        metric, from, to,
        count: rows.length,
        rows: rows.map((r) => ({
          userId: r.id,
          staff: r.full_name,
          username: r.username,
          role: r.role,
          checks: r.checks,
          issues: r.issues,
          lastActivity: local(r.last_activity),
        })),
      });
    }

    if (metric === 'unscheduled') {
      const { rows } = await query(
        `SELECT r.id, r.business_date::text AS business_date, r.status,
                u.full_name, l.name_en AS location_en, l.name_ar AS location_ar,
                st.code AS shift_code, r.started_at,
                p.total_tasks, p.answered_tasks, p.failed_tasks
           FROM checklist_runs r
           JOIN users u          ON u.id = r.user_id
           JOIN locations l      ON l.id = r.location_id
           JOIN shift_types st   ON st.id = r.shift_type_id
           JOIN v_run_progress p ON p.run_id = r.id
          WHERE r.business_date BETWEEN $1::date AND $2::date
            AND r.source = 'unscheduled'
          ORDER BY r.started_at DESC
          LIMIT ${LIMIT}`,
        [from, to]
      );
      return res.json({
        kind: 'runs',
        metric, from, to,
        count: rows.length,
        rows: rows.map((r) => ({
          runId: r.id,
          businessDate: r.business_date,
          staff: r.full_name,
          locationEn: r.location_en,
          locationAr: r.location_ar,
          shiftCode: r.shift_code,
          startedAt: local(r.started_at),
          answered: r.answered_tasks,
          total: r.total_tasks,
          failed: r.failed_tasks,
          status: r.status,
        })),
      });
    }

    return res.status(400).json({ error: `Unknown metric: ${metric}` });
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
