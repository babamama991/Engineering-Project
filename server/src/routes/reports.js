import { Router } from 'express';
import { z } from 'zod';
import { DateTime } from 'luxon';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';

import { query } from '../db.js';
import { asyncHandler } from '../middleware/error.js';
import { getSetting } from '../utils/settings.js';

// Mounted admin-only.
const router = Router();

const filterSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  userId: z.coerce.number().int().positive().optional(),
  locationId: z.coerce.number().int().positive().optional(),
  shiftTypeId: z.coerce.number().int().positive().optional(),
  // 'yes' | 'no' | undefined (both)
  answer: z.enum(['yes', 'no']).optional(),
  lang: z.enum(['en', 'ar']).default('en'),
});

/** Builds the shared WHERE clause + params for every report output. */
function buildQuery(f) {
  const where = ['business_date BETWEEN $1::date AND $2::date'];
  const params = [f.from, f.to];

  if (f.userId)      { params.push(f.userId);      where.push(`user_id = $${params.length}`); }
  if (f.locationId)    { params.push(f.locationId);    where.push(`location_id = $${params.length}`); }
  if (f.shiftTypeId) { params.push(f.shiftTypeId); where.push(`shift_code = (SELECT code FROM shift_types WHERE id = $${params.length})`); }
  if (f.answer === 'yes') where.push('answer = TRUE');
  if (f.answer === 'no')  where.push('answer = FALSE');

  return {
    // Newest check first, everywhere: on screen, in Excel, and in the PDF.
    // Shifts don't overlap, so ordering purely by time still leaves each
    // (business_date, shift) block contiguous for the PDF's page grouping.
    // answer_id breaks ties so two checks saved in the same millisecond keep a
    // stable order between requests.
    sql: `SELECT * FROM v_report_rows WHERE ${where.join(' AND ')}
          ORDER BY answered_at DESC, answer_id DESC`,
    params,
  };
}

async function fetchRows(f) {
  const { sql, params } = buildQuery(f);
  const { rows } = await query(sql, params);
  return rows;
}

const pick = (row, lang, base) => (lang === 'ar' ? row[`${base}_ar`] : row[`${base}_en`]);

// ---------------------------------------------------------------------------
// On-screen table
// ---------------------------------------------------------------------------
router.get(
  '/rows',
  asyncHandler(async (req, res) => {
    const f = filterSchema.parse(req.query);
    const tz = await getSetting('timezone', 'Asia/Beirut');
    const rows = await fetchRows(f);

    // Photo URLs for the rows that have any, so the admin can open the evidence
    // instead of only seeing a count. One extra query for the whole page rather
    // than a lateral join on every row — most rows carry no photo at all.
    const answerIds = rows.filter((r) => r.photo_count > 0).map((r) => r.answer_id);
    const photosByAnswer = new Map();
    if (answerIds.length) {
      const { rows: photos } = await query(
        `SELECT id, answer_id, file_path, original_name, uploaded_at
           FROM task_photos
          WHERE answer_id = ANY($1::int[])
          ORDER BY uploaded_at`,
        [answerIds]
      );
      for (const p of photos) {
        if (!photosByAnswer.has(p.answer_id)) photosByAnswer.set(p.answer_id, []);
        photosByAnswer.get(p.answer_id).push({
          id: p.id,
          url: `/uploads/${p.file_path}`,
          originalName: p.original_name,
          uploadedAt: p.uploaded_at,
        });
      }
    }

    res.json({
      filters: f,
      timezone: tz,
      count: rows.length,
      rows: rows.map((r) => ({
        photos: photosByAnswer.get(r.answer_id) || [],
        answerId: r.answer_id,
        runId: r.run_id,
        businessDate: r.business_date,
        shiftCode: r.shift_code,
        shiftName: pick(r, f.lang, 'shift_name'),
        runSource: r.run_source,
        userId: r.user_id,
        username: r.username,
        fullName: r.full_name,
        locationId: r.location_id,
        location: pick(r, f.lang, 'outlet_name'),
        subLocation: pick(r, f.lang, 'category_name') || '—',
        taskId: r.task_id,
        task: pick(r, f.lang, 'task_title'),
        isCritical: r.is_critical,
        answer: r.answer,
        comment: r.comment,
        answeredAt: r.answered_at,
        localTime: DateTime.fromJSDate(new Date(r.answered_at)).setZone(tz).toFormat('yyyy-LL-dd HH:mm:ss'),
        revision: r.revision,
        photoCount: r.photo_count,
      })),
    });
  })
);

/** Per-user / per-location totals for the same filters. */
router.get(
  '/summary',
  asyncHandler(async (req, res) => {
    const f = filterSchema.parse(req.query);
    const rows = await fetchRows(f);

    const group = (keyFn, labelFn) => {
      const m = new Map();
      for (const r of rows) {
        const k = keyFn(r);
        if (!m.has(k)) m.set(k, { key: k, label: labelFn(r), total: 0, yes: 0, no: 0, critical: 0 });
        const g = m.get(k);
        g.total += 1;
        if (r.answer) g.yes += 1;
        else {
          g.no += 1;
          if (r.is_critical) g.critical += 1;
        }
      }
      return [...m.values()].sort((a, b) => b.total - a.total);
    };

    res.json({
      filters: f,
      totals: {
        answers: rows.length,
        yes: rows.filter((r) => r.answer).length,
        no: rows.filter((r) => !r.answer).length,
        critical: rows.filter((r) => !r.answer && r.is_critical).length,
      },
      byUser: group((r) => r.user_id, (r) => r.full_name),
      byOutlet: group((r) => r.location_id, (r) => pick(r, f.lang, 'outlet_name')),
      byShift: group((r) => r.shift_code, (r) => pick(r, f.lang, 'shift_name')),
      byDate: group((r) => r.business_date, (r) => r.business_date),
    });
  })
);

// ---------------------------------------------------------------------------
// Excel export
// ---------------------------------------------------------------------------
router.get(
  '/export.xlsx',
  asyncHandler(async (req, res) => {
    const f = filterSchema.parse(req.query);
    const tz = await getSetting('timezone', 'Asia/Beirut');
    const hotel = await getSetting('hotel_name', 'The SmallVille Hotel');
    const rows = await fetchRows(f);

    const wb = new ExcelJS.Workbook();
    wb.creator = hotel;
    wb.created = new Date();

    // --- Sheet 1: every tick -------------------------------------------------
    const ws = wb.addWorksheet('Checklist Log', {
      views: [{ state: 'frozen', ySplit: 1 }],
    });
    ws.columns = [
      { header: 'Date',       key: 'date',     width: 12 },
      { header: 'Shift',      key: 'shift',    width: 10 },
      { header: 'Time',       key: 'time',     width: 10 },
      { header: 'Staff',      key: 'staff',    width: 24 },
      { header: 'Username',   key: 'username', width: 16 },
      { header: 'Location',     key: 'location',   width: 18 },
      { header: 'SubLocation',   key: 'subLocation', width: 18 },
      { header: 'Task',       key: 'task',     width: 48 },
      { header: 'Critical',   key: 'critical', width: 10 },
      { header: 'Answer',     key: 'answer',   width: 10 },
      { header: 'Comment',    key: 'comment',  width: 46 },
      { header: 'Photos',     key: 'photos',   width: 8 },
      { header: 'Edited',     key: 'edited',   width: 9 },
      { header: 'Roster',     key: 'source',   width: 13 },
    ];

    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3A5F' } };
    ws.getRow(1).alignment = { vertical: 'middle' };
    ws.getRow(1).height = 22;

    for (const r of rows) {
      const dt = DateTime.fromJSDate(new Date(r.answered_at)).setZone(tz);
      const row = ws.addRow({
        date: r.business_date,
        shift: r.shift_code,
        time: dt.toFormat('HH:mm:ss'),
        staff: r.full_name,
        username: r.username,
        location: pick(r, f.lang, 'outlet_name'),
        subLocation: pick(r, f.lang, 'category_name') || '—',
        task: pick(r, f.lang, 'task_title'),
        critical: r.is_critical ? 'YES' : '',
        answer: r.answer ? 'Yes' : 'No',
        comment: r.comment || '',
        photos: r.photo_count || '',
        edited: r.revision > 1 ? `rev ${r.revision}` : '',
        source: r.run_source === 'unscheduled' ? 'Unscheduled' : 'Rostered',
      });
      row.alignment = { vertical: 'top', wrapText: true };

      // Red for a failed check, darker red if it was a critical task.
      if (!r.answer) {
        const argb = r.is_critical ? 'FFFFC7CE' : 'FFFFE8E8';
        ['answer', 'task', 'comment'].forEach((k) => {
          row.getCell(k).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } };
        });
        row.getCell('answer').font = { bold: true, color: { argb: 'FF9C0006' } };
      } else {
        row.getCell('answer').font = { color: { argb: 'FF1E7B34' } };
      }
    }

    ws.autoFilter = { from: 'A1', to: `N1` };

    // --- Sheet 2: per-staff summary -----------------------------------------
    const sum = wb.addWorksheet('Summary');
    sum.columns = [
      { header: 'Staff',    key: 'staff',    width: 24 },
      { header: 'Location',   key: 'location',   width: 18 },
      { header: 'Checked',  key: 'total',    width: 10 },
      { header: 'Yes',      key: 'yes',      width: 8 },
      { header: 'No',       key: 'no',       width: 8 },
      { header: 'Critical', key: 'critical', width: 10 },
    ];
    sum.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sum.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3A5F' } };

    const agg = new Map();
    for (const r of rows) {
      const key = `${r.user_id}|${r.location_id}`;
      if (!agg.has(key)) {
        agg.set(key, {
          staff: r.full_name, location: pick(r, f.lang, 'outlet_name'),
          total: 0, yes: 0, no: 0, critical: 0,
        });
      }
      const g = agg.get(key);
      g.total += 1;
      if (r.answer) g.yes += 1;
      else { g.no += 1; if (r.is_critical) g.critical += 1; }
    }
    [...agg.values()]
      .sort((a, b) => a.staff.localeCompare(b.staff) || a.location.localeCompare(b.location))
      .forEach((g) => sum.addRow(g));

    // --- Sheet 3: what was asked for -----------------------------------------
    const meta = wb.addWorksheet('Report Info');
    meta.columns = [{ width: 22 }, { width: 44 }];
    [
      ['Hotel', hotel],
      ['Report', 'Engineering checklist log'],
      ['Date range', `${f.from}  to  ${f.to}`],
      ['Staff filter', f.userId ? rows[0]?.full_name || `user #${f.userId}` : 'All staff'],
      ['Location filter', f.locationId ? rows[0]?.[`outlet_name_${f.lang}`] || `location #${f.locationId}` : 'All locations'],
      ['Answer filter', f.answer ? f.answer.toUpperCase() : 'All'],
      ['Rows', String(rows.length)],
      ['Timezone', tz],
      ['Generated', DateTime.now().setZone(tz).toFormat('yyyy-LL-dd HH:mm:ss')],
      ['Generated by', req.user.full_name],
    ].forEach(([k, v]) => {
      const row = meta.addRow([k, v]);
      row.getCell(1).font = { bold: true };
    });

    const name = `checklist_${f.from}_to_${f.to}${f.userId ? `_user${f.userId}` : ''}.xlsx`;
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    await wb.xlsx.write(res);
    res.end();
  })
);

// ---------------------------------------------------------------------------
// PDF export
// ---------------------------------------------------------------------------
router.get(
  '/export.pdf',
  asyncHandler(async (req, res) => {
    const f = filterSchema.parse(req.query);
    const tz = await getSetting('timezone', 'Asia/Beirut');
    const hotel = await getSetting('hotel_name', 'The SmallVille Hotel');
    const rows = await fetchRows(f);

    const name = `checklist_${f.from}_to_${f.to}${f.userId ? `_user${f.userId}` : ''}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);

    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 32 });
    doc.pipe(res);

    const COLS = [
      { key: 'time',     label: 'Time',     w: 52 },
      { key: 'staff',    label: 'Staff',    w: 92 },
      { key: 'location',   label: 'Location',   w: 72 },
      { key: 'subLocation', label: 'SubLocation', w: 78 },
      { key: 'task',     label: 'Task',     w: 220 },
      { key: 'answer',   label: 'Answer',   w: 46 },
      { key: 'comment',  label: 'Comment',  w: 208 },
    ];
    const TABLE_W = COLS.reduce((s, c) => s + c.w, 0);
    const LEFT = doc.page.margins.left;

    const header = (dateLabel, shiftLabel) => {
      doc.fontSize(15).fillColor('#1f3a5f').text(hotel, LEFT, 28);
      doc.fontSize(10).fillColor('#444')
         .text(`Engineering checklist  ·  ${f.from} to ${f.to}  ·  ${tz}`, LEFT, 48);
      doc.moveTo(LEFT, 66).lineTo(LEFT + TABLE_W, 66).strokeColor('#1f3a5f').lineWidth(1).stroke();
      doc.y = 76;
      if (dateLabel) {
        doc.fontSize(11).fillColor('#1f3a5f').text(`${dateLabel}  —  ${shiftLabel}`, LEFT, doc.y);
        doc.moveDown(0.3);
      }
    };

    const tableHead = () => {
      const y = doc.y;
      doc.rect(LEFT, y, TABLE_W, 18).fill('#1f3a5f');
      let x = LEFT;
      doc.fontSize(8).fillColor('#fff');
      for (const c of COLS) {
        doc.text(c.label, x + 4, y + 5, { width: c.w - 8, ellipsis: true });
        x += c.w;
      }
      doc.y = y + 20;
      doc.fillColor('#000');
    };

    if (!rows.length) {
      header();
      doc.fontSize(11).fillColor('#666')
         .text('No checklist activity matched these filters.', LEFT, doc.y + 20);
      doc.end();
      return;
    }

    // Group by date + shift so the PDF reads like a shift report, not a dump.
    const groups = new Map();
    for (const r of rows) {
      const k = `${r.business_date}|${r.shift_code}`;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(r);
    }

    let first = true;
    for (const [key, list] of groups) {
      const [date, shiftCode] = key.split('|');
      const shiftLabel = `${shiftCode} shift`;

      if (!first) doc.addPage();
      header(date, shiftLabel);
      tableHead();
      first = false;

      for (const r of list) {
        const dt = DateTime.fromJSDate(new Date(r.answered_at)).setZone(tz);
        const cells = {
          time: dt.toFormat('HH:mm'),
          staff: r.full_name,
          location: pick(r, f.lang, 'outlet_name'),
          subLocation: pick(r, f.lang, 'category_name') || '—',
          task: pick(r, f.lang, 'task_title'),
          answer: r.answer ? 'Yes' : 'NO',
          comment: r.comment || '',
        };

        // Measure the tallest cell so wrapped text never overlaps the next row.
        doc.fontSize(8);
        const h = Math.max(
          ...COLS.map((c) => doc.heightOfString(String(cells[c.key]), { width: c.w - 8 }))
        ) + 6;

        if (doc.y + h > doc.page.height - doc.page.margins.bottom) {
          doc.addPage();
          header(date, shiftLabel);
          tableHead();
        }

        const y = doc.y;
        if (!r.answer) {
          doc.rect(LEFT, y, TABLE_W, h).fill(r.is_critical ? '#ffd9dd' : '#fdeeee');
        }

        let x = LEFT;
        for (const c of COLS) {
          const isAnswer = c.key === 'answer';
          doc.fillColor(isAnswer ? (r.answer ? '#1e7b34' : '#9c0006') : '#111')
             .font(isAnswer && !r.answer ? 'Helvetica-Bold' : 'Helvetica')
             .fontSize(8)
             .text(String(cells[c.key]), x + 4, y + 3, { width: c.w - 8 });
          x += c.w;
        }

        doc.y = y + h;
        doc.moveTo(LEFT, doc.y).lineTo(LEFT + TABLE_W, doc.y)
           .strokeColor('#e2e2e2').lineWidth(0.5).stroke();
      }

      const yes = list.filter((r) => r.answer).length;
      doc.moveDown(0.6);
      doc.fontSize(9).fillColor('#444').font('Helvetica-Bold')
         .text(`${list.length} checks  ·  ${yes} Yes  ·  ${list.length - yes} No`, LEFT, doc.y);
    }

    doc.end();
  })
);

/** Everything one staff member did on one day — the "spot check a person" view. */
router.get(
  '/user-day',
  asyncHandler(async (req, res) => {
    const { userId, date, lang } = z
      .object({
        userId: z.coerce.number().int().positive(),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        lang: z.enum(['en', 'ar']).default('en'),
      })
      .parse(req.query);

    const tz = await getSetting('timezone', 'Asia/Beirut');

    const [user, runs, answers] = await Promise.all([
      query('SELECT id, username, full_name FROM users WHERE id = $1', [userId]),
      query(
        `SELECT r.*, st.code AS shift_code, o.name_en, o.name_ar,
                p.total_tasks, p.answered_tasks, p.failed_tasks
           FROM checklist_runs r
           JOIN shift_types st ON st.id = r.shift_type_id
           JOIN locations o      ON o.id = r.location_id
           JOIN v_run_progress p ON p.run_id = r.id
          WHERE r.user_id = $1 AND r.business_date = $2::date
          ORDER BY st.sort_order, o.sort_order`,
        [userId, date]
      ),
      query(
        `SELECT * FROM v_report_rows
          WHERE user_id = $1 AND business_date = $2::date
          ORDER BY answered_at DESC, answer_id DESC`,
        [userId, date]
      ),
    ]);

    if (!user.rows.length) return res.status(404).json({ error: 'User not found' });

    res.json({
      user: { id: user.rows[0].id, username: user.rows[0].username, fullName: user.rows[0].full_name },
      date,
      timezone: tz,
      runs: runs.rows.map((r) => ({
        runId: r.id,
        shiftCode: r.shift_code,
        location: lang === 'ar' ? r.name_ar : r.name_en,
        source: r.source,
        status: r.status,
        startedAt: r.started_at,
        completedAt: r.completed_at,
        total: r.total_tasks,
        answered: r.answered_tasks,
        failed: r.failed_tasks,
      })),
      timeline: answers.rows.map((a) => ({
        time: DateTime.fromJSDate(new Date(a.answered_at)).setZone(tz).toFormat('HH:mm:ss'),
        answeredAt: a.answered_at,
        location: pick(a, lang, 'outlet_name'),
        subLocation: pick(a, lang, 'category_name') || '—',
        task: pick(a, lang, 'task_title'),
        answer: a.answer,
        comment: a.comment,
        isCritical: a.is_critical,
        photoCount: a.photo_count,
        shiftCode: a.shift_code,
      })),
    });
  })
);

export default router;
