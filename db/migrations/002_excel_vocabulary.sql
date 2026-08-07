-- ============================================================================
--  002 — speak the spreadsheet's language, and let Arabic be absent
--
--  The hotel maintains its checklists in Excel with these columns:
--      Location | Sub-Location | Description | Checked | Comment
--  so the tables now carry those names instead of outlet / category / title.
--
--    outlets              -> locations
--    task_categories      -> sub_locations
--    tasks.outlet_id      -> location_id
--    tasks.category_id    -> sub_location_id
--    tasks.title_en/ar    -> description_en/ar     (the Excel "Description")
--    tasks.description_*  -> notes_en/ar           (the old optional long text)
--
--  Arabic becomes optional everywhere. A row imported without Arabic stores
--  NULL rather than a copy of the English, so "nobody has translated this yet"
--  is a fact in the data instead of a guess. The apps fall back to English when
--  rendering, and a HOD can fill the Arabic in afterwards.
-- ============================================================================

BEGIN;

-- --- tables ----------------------------------------------------------------
ALTER TABLE outlets         RENAME TO locations;
ALTER TABLE task_categories RENAME TO sub_locations;

-- --- foreign keys ----------------------------------------------------------
ALTER TABLE tasks          RENAME COLUMN outlet_id   TO location_id;
ALTER TABLE tasks          RENAME COLUMN category_id TO sub_location_id;
ALTER TABLE checklist_runs RENAME COLUMN outlet_id   TO location_id;

-- --- task text -------------------------------------------------------------
-- Two-step: the old description_* columns move out of the way first, then the
-- titles take their name. Doing it in the other order collides.
ALTER TABLE tasks RENAME COLUMN description_en TO notes_en;
ALTER TABLE tasks RENAME COLUMN description_ar TO notes_ar;
ALTER TABLE tasks RENAME COLUMN title_en       TO description_en;
ALTER TABLE tasks RENAME COLUMN title_ar       TO description_ar;

-- --- Arabic is optional ----------------------------------------------------
ALTER TABLE tasks         ALTER COLUMN description_ar DROP NOT NULL;
ALTER TABLE locations     ALTER COLUMN name_ar        DROP NOT NULL;
ALTER TABLE sub_locations ALTER COLUMN name_ar        DROP NOT NULL;

-- Rows that were imported before Arabic could be NULL carry a copy of the
-- English. That copy is indistinguishable from a real translation on screen but
-- it isn't one, so clear it — the apps show English either way, and now the
-- admin panel can flag what still needs translating.
UPDATE tasks         SET description_ar = NULL WHERE description_ar = description_en;
UPDATE locations     SET name_ar        = NULL WHERE name_ar        = name_en;
UPDATE sub_locations SET name_ar        = NULL WHERE name_ar        = name_en;

-- --- indexes, renamed to match their tables --------------------------------
ALTER INDEX IF EXISTS outlets_code_live_uidx RENAME TO locations_code_live_uidx;
ALTER INDEX IF EXISTS tasks_outlet_idx       RENAME TO tasks_location_idx;
ALTER INDEX IF EXISTS tasks_category_idx     RENAME TO tasks_sub_location_idx;
ALTER INDEX IF EXISTS checklist_runs_outlet_date_idx
                                             RENAME TO checklist_runs_location_date_idx;

-- --- views -----------------------------------------------------------------
-- Postgres rewrites a view's internals on rename, but its OUTPUT column names
-- are fixed at creation. Recreate both so consumers see the new vocabulary.
DROP VIEW IF EXISTS v_report_rows;
DROP VIEW IF EXISTS v_run_progress;

CREATE VIEW v_report_rows AS
SELECT
    a.id                AS answer_id,
    r.id                AS run_id,
    r.business_date,
    st.code             AS shift_code,
    st.name_en          AS shift_name_en,
    st.name_ar          AS shift_name_ar,
    r.source            AS run_source,
    r.status            AS run_status,
    u.id                AS user_id,
    u.username,
    u.full_name,
    l.id                AS location_id,
    l.name_en           AS location_name_en,
    l.name_ar           AS location_name_ar,
    s.name_en           AS sub_location_name_en,
    s.name_ar           AS sub_location_name_ar,
    t.id                AS task_id,
    t.description_en    AS task_description_en,
    t.description_ar    AS task_description_ar,
    t.is_critical,
    a.answer,
    a.comment,
    a.answered_at,
    a.revision,
    (SELECT count(*) FROM task_photos p WHERE p.answer_id = a.id) AS photo_count
FROM task_answers a
JOIN checklist_runs r ON r.id = a.run_id
JOIN users u          ON u.id = r.user_id
JOIN locations l      ON l.id = r.location_id
JOIN shift_types st   ON st.id = r.shift_type_id
JOIN tasks t          ON t.id = a.task_id
LEFT JOIN sub_locations s ON s.id = t.sub_location_id;

CREATE VIEW v_run_progress AS
SELECT
    r.id AS run_id,
    r.business_date,
    r.user_id,
    r.location_id,
    r.shift_type_id,
    r.status,
    r.started_at,
    r.completed_at,
    (SELECT count(*) FROM tasks t
      WHERE t.location_id = r.location_id AND t.deleted_at IS NULL AND t.is_active) AS total_tasks,
    (SELECT count(*) FROM task_answers a WHERE a.run_id = r.id)                     AS answered_tasks,
    (SELECT count(*) FROM task_answers a WHERE a.run_id = r.id AND a.answer = FALSE) AS failed_tasks
FROM checklist_runs r;

COMMIT;
