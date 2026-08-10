-- ============================================================================
--  004 — a task can belong to one shift
--
--  Until now every task appeared on every shift's checklist. Some work is
--  shift-specific: a generator test at night, a pool check in the morning.
--
--    shift_type_id NULL  -> every shift (what all existing tasks get)
--    shift_type_id = N    -> only that shift's checklist
--
--  v_run_progress has to change with it. It counted every active task in the
--  location, so a Night-only task would have inflated the denominator on the
--  Morning round — "0/40" for a checklist that only has 39 items.
-- ============================================================================

BEGIN;

ALTER TABLE tasks
    ADD COLUMN IF NOT EXISTS shift_type_id INTEGER
    REFERENCES shift_types(id) ON DELETE SET NULL;

COMMENT ON COLUMN tasks.shift_type_id IS
    'NULL = appears on every shift; otherwise only on that shift''s checklist.';

-- Partial index: most tasks stay NULL, so only the targeted ones are indexed.
CREATE INDEX IF NOT EXISTS tasks_shift_idx
    ON tasks (shift_type_id) WHERE shift_type_id IS NOT NULL;

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
      WHERE t.location_id = r.location_id
        AND t.deleted_at IS NULL AND t.is_active
        -- Only what this shift is actually asked to do.
        AND (t.shift_type_id IS NULL OR t.shift_type_id = r.shift_type_id)) AS total_tasks,
    (SELECT count(*) FROM task_answers a WHERE a.run_id = r.id)                     AS answered_tasks,
    (SELECT count(*) FROM task_answers a WHERE a.run_id = r.id AND a.answer = FALSE) AS failed_tasks
FROM checklist_runs r;

COMMIT;
