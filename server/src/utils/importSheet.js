/**
 * Parsing for the checklist spreadsheet.
 *
 * The sheet the hotel maintains looks like this:
 *
 *   Location | Sub-Location | Description                | Checked | Comment
 *   GF       | GF           | SMDB-GF-Floor              |         |
 *   GF       | Red Street   | Wiring-ويرينغ               |         |
 *
 * Location     -> outlet
 * Sub-Location -> task category
 * Description  -> task title, English and Arabic in one cell
 * Checked      -> filled in by the technician in the app, ignored on import
 * Comment      -> same
 */

/** Arabic block, including Arabic-Indic digits and presentation forms. */
const ARABIC = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/;

/** Normalise a header cell so "Sub-Location", "sub location" and "SubLocation" all match. */
const normaliseHeader = (s) =>
  String(s ?? '')
    .toLowerCase()
    .replace(/[\s_-]+/g, '');

const HEADER_ALIASES = {
  location: 'location',
  sublocation: 'subLocation',
  description: 'description',
  checked: 'checked',
  comment: 'comment',
  comments: 'comment',
};

/**
 * Split a Description cell into English and Arabic.
 *
 * "Wiring-ويرينغ"                    -> { en: 'Wiring', ar: 'ويرينغ' }
 * "Disconnect Switch for VRV-ديسكونكت" -> { en: 'Disconnect Switch for VRV', ar: 'ديسكونكت' }
 * "SMDB-GF-Floor"                   -> { en: 'SMDB-GF-Floor', ar: null }
 *
 * The split point is the last hyphen BEFORE the first Arabic character, so
 * English text that legitimately contains hyphens ("DB-GF-Kitchen",
 * "MCP-GF-1-VRV") is never cut in half.
 *
 * When the cell carries no Arabic, `ar` is NULL rather than a copy of the
 * English. Storing a copy would look like a finished translation forever; NULL
 * records the truth — nobody has translated this yet — so the admin panel can
 * surface it and a HOD can fill it in. Both apps fall back to English when
 * rendering, so a technician still sees a usable line either way.
 */
export function splitTitle(raw) {
  const text = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return null;

  const firstArabic = text.search(ARABIC);
  if (firstArabic === -1) return { en: text, ar: null, hasArabic: false };

  const hyphen = text.lastIndexOf('-', firstArabic);
  if (hyphen === -1) {
    // Arabic only, no English half — the Arabic has to serve as both.
    return { en: text, ar: text, hasArabic: true };
  }

  const en = text.slice(0, hyphen).trim();
  const ar = text.slice(hyphen + 1).trim();
  if (!en) return { en: ar, ar, hasArabic: true };
  if (!ar) return { en, ar: null, hasArabic: false };
  return { en, ar, hasArabic: true };
}

/** Plain string out of an ExcelJS cell value (handles rich text and formulas). */
export function cellText(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    if (Array.isArray(value.richText)) return value.richText.map((t) => t.text).join('');
    if (value.text !== undefined) return String(value.text);
    if (value.result !== undefined) return String(value.result);
    if (value instanceof Date) return value.toISOString();
    return '';
  }
  return String(value);
}

/**
 * Find the header row and map column numbers to field names. The header is not
 * assumed to be row 1 — sheets often carry a title or a blank row first.
 *
 * @returns {{ headerRow: number, columns: Record<string, number> }}
 * @throws when Location / Sub-Location / Description can't all be found
 */
export function findHeader(worksheet) {
  const limit = Math.min(worksheet.rowCount, 20);

  for (let n = 1; n <= limit; n++) {
    const row = worksheet.getRow(n);
    const columns = {};
    for (let c = 1; c <= worksheet.columnCount; c++) {
      const field = HEADER_ALIASES[normaliseHeader(cellText(row.getCell(c).value))];
      if (field && !columns[field]) columns[field] = c;
    }
    if (columns.location && columns.subLocation && columns.description) {
      return { headerRow: n, columns };
    }
  }

  const err = new Error(
    'Could not find the header row. The sheet needs columns named ' +
      'Location, Sub-Location and Description.'
  );
  err.status = 400;
  throw err;
}

/**
 * Read every data row below the header.
 *
 * Location and Sub-Location are carried down when blank, so a sheet that only
 * writes "GF" once at the top of a block imports the same as one that repeats
 * it on every line.
 *
 * @returns {{ rows: Array, skipped: Array }}
 */
export function readRows(worksheet, { headerRow, columns }) {
  const rows = [];
  const skipped = [];

  let lastLocation = '';
  let lastSubLocation = '';

  for (let n = headerRow + 1; n <= worksheet.rowCount; n++) {
    const row = worksheet.getRow(n);
    // Collapse internal whitespace, not just the ends. Cells in these sheets
    // often wrap ("Da-sophia\nKitchen"), and the newline has to go before the
    // value is used as a lookup key — otherwise a re-import fails to match the
    // category it created last time and duplicates it.
    const get = (field) =>
      columns[field]
        ? cellText(row.getCell(columns[field]).value).replace(/\s+/g, ' ').trim()
        : '';

    const location = get('location') || lastLocation;
    const subLocation = get('subLocation') || lastSubLocation;
    const description = get('description');

    if (!location && !subLocation && !description) continue; // blank spacer row

    if (!description) {
      skipped.push({ row: n, reason: 'No Description' });
      continue;
    }
    if (!location) {
      skipped.push({ row: n, reason: 'No Location' });
      continue;
    }

    const title = splitTitle(description);
    if (!title) {
      skipped.push({ row: n, reason: 'Description is empty' });
      continue;
    }

    lastLocation = location;
    lastSubLocation = subLocation;

    rows.push({
      excelRow: n,
      location,
      subLocation: subLocation || null,
      descriptionEn: title.en,
      descriptionAr: title.ar, // null when the sheet had no Arabic
      hasArabic: title.hasArabic,
    });
  }

  return { rows, skipped };
}
