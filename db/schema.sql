-- ============================================================================
--  SmallVille Hotel — Engineering Checklist System
--  PostgreSQL schema
--
--  Design notes
--  ------------
--  * SOFT DELETE everywhere (deleted_at). Admin "deleting" a task must never
--    orphan or rewrite historical answers — the task disappears from today's
--    checklist but every past report still resolves its title.
--  * business_date vs answered_at. A Night shift starting 22:00 on Aug-05 runs
--    to 06:00 on Aug-06. business_date pins the whole run to Aug-05 (the day
--    the shift STARTED) so the Aug-05 report is complete, while answered_at
--    keeps the true wall-clock moment (01:47) for the timestamp column.
--  * One checklist_run per (user, location, business_date, shift). That tuple IS
--    the reset unit: new shift => new run => fresh unticked list.
--  * All timestamps are timestamptz. Hotel local timezone lives in app_settings
--    ('timezone', default Asia/Beirut) and is applied at render/report time.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- Enum-ish domains (kept as CHECK constraints — easier to extend than ENUM)
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. USERS
-- ---------------------------------------------------------------------------
CREATE TABLE users (
    id                   SERIAL PRIMARY KEY,
    username             CITEXT       NOT NULL,
    password_hash        TEXT         NOT NULL,
    full_name            TEXT         NOT NULL,
    -- admin : IT. Superuser — everything, including Settings and managing admins.
    -- hod   : Head of Department. Full admin panel EXCEPT Settings and shift
    --         times; may only create/edit STAFF accounts.
    -- staff : technician. Staff app only.
    role                 TEXT         NOT NULL DEFAULT 'staff'
                                      CHECK (role IN ('admin', 'hod', 'staff')),
    job_title            TEXT,
    phone                TEXT,
    preferred_lang       TEXT         NOT NULL DEFAULT 'en'
                                      CHECK (preferred_lang IN ('en', 'ar')),
    is_active            BOOLEAN      NOT NULL DEFAULT TRUE,
    must_change_password BOOLEAN      NOT NULL DEFAULT TRUE,
    last_login_at        TIMESTAMPTZ,
    created_by           INTEGER      REFERENCES users(id) ON DELETE SET NULL,
    created_at           TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ  NOT NULL DEFAULT now(),
    deleted_at           TIMESTAMPTZ
);

-- Username unique only among live accounts, so a deleted 'ahmad.k' can be reissued.
CREATE UNIQUE INDEX users_username_live_uidx
    ON users (username) WHERE deleted_at IS NULL;
CREATE INDEX users_role_idx ON users (role) WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- 2. OUTLETS  (Penthouse, Poolhouse, Dasophia, Marvelous, ...)
-- ---------------------------------------------------------------------------
CREATE TABLE locations (
    id          SERIAL PRIMARY KEY,
    code        TEXT        NOT NULL,          -- short stable key, e.g. 'PENTHOUSE'
    name_en     TEXT        NOT NULL,
    name_ar     TEXT        NOT NULL,
    location    TEXT,                          -- free text: "Roof, 12th floor"
    sort_order  INTEGER     NOT NULL DEFAULT 0,
    is_active   BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at  TIMESTAMPTZ
);

CREATE UNIQUE INDEX outlets_code_live_uidx
    ON locations (code) WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- 3. TASK CATEGORIES  (global & reusable: Electrical, Plumbing, HVAC, Safety…)
--    Global rather than per-location so the admin defines "Electrical" once and
--    reuses it in every location; the grouping on screen comes from task.location_id.
-- ---------------------------------------------------------------------------
CREATE TABLE sub_locations (
    id          SERIAL PRIMARY KEY,
    name_en     TEXT        NOT NULL,
    name_ar     TEXT        NOT NULL,
    icon        TEXT,                          -- optional emoji / icon key
    sort_order  INTEGER     NOT NULL DEFAULT 0,
    is_active   BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at  TIMESTAMPTZ
);

-- ---------------------------------------------------------------------------
-- 4. TASKS  (the master checklist the admin maintains)
-- ---------------------------------------------------------------------------
CREATE TABLE tasks (
    id              SERIAL PRIMARY KEY,
    location_id       INTEGER     NOT NULL REFERENCES locations(id) ON DELETE RESTRICT,
    sub_location_id     INTEGER     REFERENCES sub_locations(id) ON DELETE SET NULL,
    description_en        TEXT        NOT NULL,
    description_ar        TEXT        NOT NULL,
    notes_en  TEXT,
    notes_ar  TEXT,

    -- How often this task needs answering. Drives carry-over:
    --   every_shift : fresh on every run (default)
    --   daily       : once per business_date for the location — later shifts see
    --                 it already answered (read-only, with who/when)
    --   weekly      : once per ISO week for the location
    frequency       TEXT        NOT NULL DEFAULT 'every_shift'
                                CHECK (frequency IN ('every_shift', 'daily', 'weekly')),

    requires_photo  BOOLEAN     NOT NULL DEFAULT FALSE,
    is_critical     BOOLEAN     NOT NULL DEFAULT FALSE,  -- a "No" here is escalated
    sort_order      INTEGER     NOT NULL DEFAULT 0,
    is_active       BOOLEAN     NOT NULL DEFAULT TRUE,
    created_by      INTEGER     REFERENCES users(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at      TIMESTAMPTZ
);

CREATE INDEX tasks_outlet_idx
    ON tasks (location_id, sort_order) WHERE deleted_at IS NULL;
CREATE INDEX tasks_category_idx ON tasks (sub_location_id);

-- ---------------------------------------------------------------------------
-- 5. SHIFT TYPES  (AM / PM / NIGHT — times are editable by the admin)
--    end_time < start_time means the shift crosses midnight.
-- ---------------------------------------------------------------------------
CREATE TABLE shift_types (
    id          SERIAL PRIMARY KEY,
    code        TEXT        NOT NULL UNIQUE,   -- 'AM' | 'PM' | 'NIGHT'
    name_en     TEXT        NOT NULL,
    name_ar     TEXT        NOT NULL,
    start_time  TIME        NOT NULL,
    end_time    TIME        NOT NULL,
    sort_order  INTEGER     NOT NULL DEFAULT 0,
    is_active   BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- TRUE when the window wraps past midnight (e.g. 22:00 -> 06:00)
    crosses_midnight BOOLEAN GENERATED ALWAYS AS (end_time <= start_time) STORED
);

-- ---------------------------------------------------------------------------
-- 6. SHIFT ASSIGNMENTS  (the weekly roster the admin fills in)
-- ---------------------------------------------------------------------------
CREATE TABLE shift_assignments (
    id             SERIAL PRIMARY KEY,
    user_id        INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    shift_type_id  INTEGER     NOT NULL REFERENCES shift_types(id) ON DELETE RESTRICT,
    work_date      DATE        NOT NULL,       -- the business_date the shift starts on
    notes          TEXT,
    created_by     INTEGER     REFERENCES users(id) ON DELETE SET NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT shift_assignments_uniq UNIQUE (user_id, work_date, shift_type_id)
);

CREATE INDEX shift_assignments_date_idx ON shift_assignments (work_date);
CREATE INDEX shift_assignments_user_date_idx ON shift_assignments (user_id, work_date);

-- ---------------------------------------------------------------------------
-- 7. CHECKLIST RUNS  ★ the reset unit ★
--    One row per (user, location, business_date, shift). Created lazily the first
--    time the user opens that location during that shift.
-- ---------------------------------------------------------------------------
CREATE TABLE checklist_runs (
    id                   SERIAL PRIMARY KEY,
    user_id              INTEGER     NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    location_id            INTEGER     NOT NULL REFERENCES locations(id) ON DELETE RESTRICT,
    shift_type_id        INTEGER     NOT NULL REFERENCES shift_types(id) ON DELETE RESTRICT,
    business_date        DATE        NOT NULL,

    -- 'rostered'    : matched a shift_assignments row
    -- 'unscheduled' : no roster entry; shift inferred from the clock. Surfaced
    --                 to the admin as "worked outside the roster".
    source               TEXT        NOT NULL DEFAULT 'rostered'
                                     CHECK (source IN ('rostered', 'unscheduled')),
    shift_assignment_id  INTEGER     REFERENCES shift_assignments(id) ON DELETE SET NULL,

    status               TEXT        NOT NULL DEFAULT 'in_progress'
                                     CHECK (status IN ('in_progress', 'completed')),
    started_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at         TIMESTAMPTZ,
    CONSTRAINT checklist_runs_uniq
        UNIQUE (user_id, location_id, business_date, shift_type_id)
);

CREATE INDEX checklist_runs_date_idx        ON checklist_runs (business_date);
CREATE INDEX checklist_runs_user_date_idx   ON checklist_runs (user_id, business_date);
CREATE INDEX checklist_runs_outlet_date_idx ON checklist_runs (location_id, business_date);

-- ---------------------------------------------------------------------------
-- 8. TASK ANSWERS  (one tick = one row, saved the instant it is pressed)
-- ---------------------------------------------------------------------------
CREATE TABLE task_answers (
    id           SERIAL PRIMARY KEY,
    run_id       INTEGER     NOT NULL REFERENCES checklist_runs(id) ON DELETE CASCADE,
    task_id      INTEGER     NOT NULL REFERENCES tasks(id) ON DELETE RESTRICT,
    answer       BOOLEAN     NOT NULL,          -- TRUE = Yes / OK, FALSE = No / fault
    comment      TEXT,                          -- mandatory when answer = FALSE
    answered_at  TIMESTAMPTZ NOT NULL DEFAULT now(),  -- ★ the report timestamp ★
    answered_by  INTEGER     NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    revision     INTEGER     NOT NULL DEFAULT 1, -- bumped on every edit
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT task_answers_uniq UNIQUE (run_id, task_id),
    -- Enforce "a No must be explained" at the database level, not just the UI.
    CONSTRAINT task_answers_no_needs_comment
        CHECK (answer = TRUE OR (comment IS NOT NULL AND length(btrim(comment)) > 0))
);

CREATE INDEX task_answers_run_idx     ON task_answers (run_id);
CREATE INDEX task_answers_task_idx    ON task_answers (task_id);
CREATE INDEX task_answers_time_idx    ON task_answers (answered_at);
CREATE INDEX task_answers_negative_idx ON task_answers (answered_at) WHERE answer = FALSE;

-- ---------------------------------------------------------------------------
-- 9. ANSWER HISTORY  (audit trail — the original answer is never lost)
-- ---------------------------------------------------------------------------
CREATE TABLE task_answer_history (
    id           SERIAL PRIMARY KEY,
    answer_id    INTEGER     NOT NULL REFERENCES task_answers(id) ON DELETE CASCADE,
    run_id       INTEGER     NOT NULL,
    task_id      INTEGER     NOT NULL,
    old_answer   BOOLEAN,
    new_answer   BOOLEAN     NOT NULL,
    old_comment  TEXT,
    new_comment  TEXT,
    revision     INTEGER     NOT NULL,
    changed_by   INTEGER     NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    changed_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX task_answer_history_answer_idx ON task_answer_history (answer_id);

-- ---------------------------------------------------------------------------
-- 10. PHOTOS  (evidence attached to an answer)
-- ---------------------------------------------------------------------------
CREATE TABLE task_photos (
    id             SERIAL PRIMARY KEY,
    answer_id      INTEGER     NOT NULL REFERENCES task_answers(id) ON DELETE CASCADE,
    run_id         INTEGER     NOT NULL,
    task_id        INTEGER     NOT NULL,
    file_path      TEXT        NOT NULL,   -- relative to UPLOAD_DIR
    original_name  TEXT,
    mime_type      TEXT        NOT NULL,
    size_bytes     INTEGER     NOT NULL,
    uploaded_by    INTEGER     NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    uploaded_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX task_photos_answer_idx ON task_photos (answer_id);

-- ---------------------------------------------------------------------------
-- 11. APP SETTINGS  (single-row-per-key config the admin can edit)
-- ---------------------------------------------------------------------------
CREATE TABLE app_settings (
    key         TEXT        PRIMARY KEY,
    value       JSONB       NOT NULL,
    updated_by  INTEGER     REFERENCES users(id) ON DELETE SET NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 12. AUDIT LOG  (who changed what in the admin panel)
-- ---------------------------------------------------------------------------
CREATE TABLE audit_log (
    id          BIGSERIAL PRIMARY KEY,
    actor_id    INTEGER     REFERENCES users(id) ON DELETE SET NULL,
    action      TEXT        NOT NULL,          -- 'task.create', 'user.deactivate', ...
    entity      TEXT        NOT NULL,          -- 'task' | 'user' | 'location' | ...
    entity_id   INTEGER,
    details     JSONB,
    ip_address  TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX audit_log_time_idx  ON audit_log (created_at DESC);
CREATE INDEX audit_log_actor_idx ON audit_log (actor_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- 13. LOGIN AUDIT
-- ---------------------------------------------------------------------------
CREATE TABLE login_audit (
    id          BIGSERIAL PRIMARY KEY,
    user_id     INTEGER     REFERENCES users(id) ON DELETE SET NULL,
    username    TEXT        NOT NULL,
    success     BOOLEAN     NOT NULL,
    ip_address  TEXT,
    user_agent  TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX login_audit_time_idx ON login_audit (created_at DESC);

-- ---------------------------------------------------------------------------
-- Triggers: keep updated_at honest
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'users','locations','sub_locations','tasks','shift_types',
        'shift_assignments','task_answers'
    ] LOOP
        EXECUTE format(
            'CREATE TRIGGER %I_touch BEFORE UPDATE ON %I
             FOR EACH ROW EXECUTE FUNCTION touch_updated_at()', t, t);
    END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- Trigger: every answer edit writes an audit row automatically
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION log_answer_change() RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO task_answer_history
            (answer_id, run_id, task_id, old_answer, new_answer,
             old_comment, new_comment, revision, changed_by, changed_at)
        VALUES (NEW.id, NEW.run_id, NEW.task_id, NULL, NEW.answer,
                NULL, NEW.comment, NEW.revision, NEW.answered_by, NEW.answered_at);
    ELSIF NEW.answer IS DISTINCT FROM OLD.answer
       OR NEW.comment IS DISTINCT FROM OLD.comment THEN
        INSERT INTO task_answer_history
            (answer_id, run_id, task_id, old_answer, new_answer,
             old_comment, new_comment, revision, changed_by, changed_at)
        VALUES (NEW.id, NEW.run_id, NEW.task_id, OLD.answer, NEW.answer,
                OLD.comment, NEW.comment, NEW.revision, NEW.answered_by, now());
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER task_answers_history
    AFTER INSERT OR UPDATE ON task_answers
    FOR EACH ROW EXECUTE FUNCTION log_answer_change();

-- ---------------------------------------------------------------------------
-- Reporting view: one flat row per tick. This is what the Excel / PDF export
-- and the on-screen report table both read from.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_report_rows AS
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
    o.id                AS location_id,
    o.name_en           AS location_name_en,
    o.name_ar           AS location_name_ar,
    c.name_en           AS sub_location_name_en,
    c.name_ar           AS sub_location_name_ar,
    t.id                AS task_id,
    t.description_en          AS task_description_en,
    t.description_ar          AS task_description_ar,
    t.is_critical,
    a.answer,
    a.comment,
    a.answered_at,
    a.revision,
    (SELECT count(*) FROM task_photos p WHERE p.answer_id = a.id) AS photo_count
FROM task_answers a
JOIN checklist_runs r  ON r.id = a.run_id
JOIN users u           ON u.id = r.user_id
JOIN locations o         ON o.id = r.location_id
JOIN shift_types st    ON st.id = r.shift_type_id
JOIN tasks t           ON t.id = a.task_id
LEFT JOIN sub_locations c ON c.id = t.sub_location_id;

-- Progress per run — powers the live admin dashboard.
CREATE OR REPLACE VIEW v_run_progress AS
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
    (SELECT count(*) FROM task_answers a WHERE a.run_id = r.id)                 AS answered_tasks,
    (SELECT count(*) FROM task_answers a WHERE a.run_id = r.id AND a.answer = FALSE) AS failed_tasks
FROM checklist_runs r;
