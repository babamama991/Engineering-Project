-- ============================================================================
--  Seed data — run AFTER schema.sql
--
--  Configuration only: shift windows and app settings. It deliberately creates
--  NO locations, sub-locations or tasks — those come from the hotel's own
--  spreadsheet via Tasks -> Import Excel. An earlier version seeded four
--  example locations with starter tasks, which meant running this against a
--  live database injected fake data alongside the real checklists.
--
--  Safe to run on an existing database: every statement is guarded.
--
--  The admin account is created by `npm run create-admin` in /server, so no
--  password hash is ever committed to a .sql file.
-- ============================================================================

-- Guard: this file only creates ROWS, never tables, so it lands in whatever
-- database the connection points at. Running it against the wrong one used to
-- fail with a bare 'relation "shift_types" does not exist'. Name the database
-- in the error instead, since that is the thing that is actually wrong.
DO $$
BEGIN
    IF to_regclass('public.shift_types') IS NULL THEN
        RAISE EXCEPTION
            'No schema in database "%". Apply schema.sql first, or connect to smallville_engineering (in pgAdmin, open the Query Tool on that database).',
            current_database();
    END IF;
END $$;

-- --- Shift windows (editable later under Settings) ---------------------------
-- Adjust to the hotel's real hours. Windows that overlap are resolved in
-- sort_order, and a shift whose end is earlier than its start crosses midnight
-- and keeps the business_date of the day it began.
INSERT INTO shift_types (code, name_en, name_ar, start_time, end_time, sort_order) VALUES
    ('AM',    'Morning',   'صباحي', '06:00', '14:00', 1),
    ('PM',    'Afternoon', 'مسائي', '14:00', '22:00', 2),
    ('NIGHT', 'Night',     'ليلي',  '22:00', '06:00', 3)
ON CONFLICT (code) DO NOTHING;

-- --- Default settings --------------------------------------------------------
INSERT INTO app_settings (key, value) VALUES
    ('timezone',             '"Asia/Beirut"'::jsonb),
    -- "a No must be explained" is enforced by a CHECK constraint on
    -- task_answers, not by a setting, so it cannot be bypassed by the API.
    ('allow_unscheduled',     'true'::jsonb),
    ('lock_run_on_complete',  'false'::jsonb),
    ('hotel_name',           '"The SmallVille Hotel"'::jsonb)
ON CONFLICT (key) DO NOTHING;
