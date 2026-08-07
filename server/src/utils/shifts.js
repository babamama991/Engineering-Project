import { DateTime } from 'luxon';
import { query } from '../db.js';
import { getSetting } from './settings.js';

/**
 * Shift + business-date resolution.
 *
 * Two rules do all the work here:
 *
 *  1. A shift whose end_time <= start_time (e.g. 22:00 -> 06:00) wraps past
 *     midnight. When "now" falls in the tail of such a shift (00:00 - 06:00),
 *     the run belongs to YESTERDAY's business_date, because that is the day the
 *     shift started. Without this, a night round splits across two report days.
 *
 *  2. The roster wins over the clock, but only within a grace window, and the
 *     clock is always the fallback so nobody is ever locked out.
 */

const GRACE_MINUTES = 90;

const toMinutes = (timeStr) => {
  const [h, m] = String(timeStr).split(':').map(Number);
  return h * 60 + m;
};

/** Load active shift types, ordered. */
export async function loadShiftTypes() {
  const { rows } = await query(
    `SELECT id, code, name_en, name_ar,
            to_char(start_time, 'HH24:MI') AS start_time,
            to_char(end_time,   'HH24:MI') AS end_time,
            crosses_midnight, sort_order
       FROM shift_types
      WHERE is_active
      ORDER BY sort_order, id`
  );
  return rows;
}

/**
 * Which shift window contains this local moment, and which business_date does
 * that run belong to?
 * @returns {{ shift: object, businessDate: string }}
 */
export function resolveShiftFromClock(shifts, localNow) {
  const minutesNow = localNow.hour * 60 + localNow.minute;
  const today = localNow.toISODate();
  const yesterday = localNow.minus({ days: 1 }).toISODate();

  for (const s of shifts) {
    const start = toMinutes(s.start_time);
    const end = toMinutes(s.end_time);

    if (start < end) {
      // Normal same-day window, e.g. 06:00 -> 14:00
      if (minutesNow >= start && minutesNow < end) {
        return { shift: s, businessDate: today };
      }
    } else {
      // Wraps midnight, e.g. 22:00 -> 06:00
      if (minutesNow >= start) return { shift: s, businessDate: today };
      if (minutesNow < end) return { shift: s, businessDate: yesterday };
    }
  }

  // Gap in coverage (shifts don't span a full 24h). Fall back to the most
  // recently started shift so the user still gets a sensible bucket.
  let best = null;
  for (const s of shifts) {
    const start = toMinutes(s.start_time);
    const elapsed = minutesNow >= start ? minutesNow - start : minutesNow + 1440 - start;
    if (!best || elapsed < best.elapsed) best = { shift: s, elapsed };
  }
  if (!best) return null;

  const startedYesterday = minutesNow < toMinutes(best.shift.start_time);
  return { shift: best.shift, businessDate: startedYesterday ? yesterday : today };
}

/**
 * Full resolution for a given user, combining roster + clock.
 *
 * @returns {{
 *   shift: object, businessDate: string, source: 'rostered'|'unscheduled',
 *   assignmentId: number|null, clockShiftCode: string, localTime: string
 * }}
 */
export async function resolveUserShift(userId, atDate = new Date()) {
  const tz = await getSetting('timezone', 'Asia/Beirut');
  const localNow = DateTime.fromJSDate(atDate, { zone: tz });

  const shifts = await loadShiftTypes();
  if (!shifts.length) {
    const err = new Error('No shift types are configured. Ask the admin to set them up.');
    err.status = 409;
    throw err;
  }

  const clock = resolveShiftFromClock(shifts, localNow);

  // Roster entries that could plausibly apply right now: the clock-derived
  // business date, plus the day either side (covers wrap-around edges).
  const { rows: assignments } = await query(
    `SELECT sa.id, sa.shift_type_id, sa.work_date::text AS work_date,
            st.code, to_char(st.start_time, 'HH24:MI') AS start_time
       FROM shift_assignments sa
       JOIN shift_types st ON st.id = sa.shift_type_id
      WHERE sa.user_id = $1
        AND sa.work_date BETWEEN $2::date - 1 AND $2::date + 1`,
    [userId, clock.businessDate]
  );

  // 1. Exact match: rostered for this shift on this business date.
  const exact = assignments.find(
    (a) => a.work_date === clock.businessDate && a.shift_type_id === clock.shift.id
  );
  if (exact) {
    return {
      shift: clock.shift,
      businessDate: clock.businessDate,
      source: 'rostered',
      assignmentId: exact.id,
      clockShiftCode: clock.shift.code,
      localTime: localNow.toISO(),
    };
  }

  // 2. Rostered for a different shift today, and we are within the grace window
  //    of its start — they arrived early / are finishing late. Honour the roster.
  const minutesNow = localNow.hour * 60 + localNow.minute;
  let graceMatch = null;
  for (const a of assignments) {
    if (a.work_date !== clock.businessDate) continue;
    const start = toMinutes(a.start_time);
    let diff = Math.abs(minutesNow - start);
    diff = Math.min(diff, 1440 - diff); // shortest way around the clock
    if (diff <= GRACE_MINUTES && (!graceMatch || diff < graceMatch.diff)) {
      graceMatch = { assignment: a, diff };
    }
  }
  if (graceMatch) {
    const shift = shifts.find((s) => s.id === graceMatch.assignment.shift_type_id);
    return {
      shift,
      businessDate: clock.businessDate,
      source: 'rostered',
      assignmentId: graceMatch.assignment.id,
      clockShiftCode: clock.shift.code,
      localTime: localNow.toISO(),
    };
  }

  // 3. Nothing on the roster — fall back to the clock and flag it.
  return {
    shift: clock.shift,
    businessDate: clock.businessDate,
    source: 'unscheduled',
    assignmentId: null,
    clockShiftCode: clock.shift.code,
    localTime: localNow.toISO(),
  };
}

/** Monday..Sunday bounds of the ISO week containing `isoDate` ('YYYY-MM-DD'). */
export function isoWeekBounds(isoDate) {
  const d = DateTime.fromISO(isoDate);
  return {
    start: d.startOf('week').toISODate(),
    end: d.endOf('week').toISODate(),
  };
}
