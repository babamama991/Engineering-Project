-- ============================================================================
--  003 — record cleared answers, and drop the unused location code
--
--  1. Clearing an answer deleted the row and left no trace. Two problems:
--     the history row pointed at the deleted answer and was cascade-deleted
--     with it, and there was no way to represent "cleared" (new_answer was
--     NOT NULL). The schema's stated rule is that an original answer is never
--     lost — a delete broke that.
--
--     After this: answer_id survives the delete as NULL, and a history row
--     with new_answer IS NULL means "this was cleared".
--
--  2. locations.code was a short key ('PENTHOUSE') that nothing reads. The
--     import generated it, the admin form asked for it, and no query used it.
-- ============================================================================

BEGIN;

-- --- 1. keep history when an answer is deleted ------------------------------
ALTER TABLE task_answer_history
    DROP CONSTRAINT IF EXISTS task_answer_history_answer_id_fkey;

ALTER TABLE task_answer_history
    ALTER COLUMN answer_id DROP NOT NULL,
    ALTER COLUMN new_answer DROP NOT NULL;

ALTER TABLE task_answer_history
    ADD CONSTRAINT task_answer_history_answer_id_fkey
    FOREIGN KEY (answer_id) REFERENCES task_answers(id) ON DELETE SET NULL;

COMMENT ON COLUMN task_answer_history.new_answer IS
    'NULL means the answer was cleared; old_answer holds what it was.';

-- --- 2. drop the unused location code ---------------------------------------
DROP INDEX IF EXISTS locations_code_live_uidx;
ALTER TABLE locations DROP COLUMN IF EXISTS code;

COMMIT;
