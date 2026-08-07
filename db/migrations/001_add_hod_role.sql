-- ============================================================================
--  001 — add the 'hod' (Head of Department) role
--
--  Roles after this migration:
--    admin : IT. Superuser — everything, including Settings and managing admins.
--    hod   : Head of Department. Full admin panel EXCEPT Settings and shift
--            times, and may only create/edit STAFF accounts.
--    staff : technician. Staff app only.
--
--  Safe to re-run: the constraint is dropped by name before being recreated,
--  and DROP ... IF EXISTS is a no-op when it isn't there.
-- ============================================================================

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;

ALTER TABLE users
    ADD CONSTRAINT users_role_check
    CHECK (role IN ('admin', 'hod', 'staff'));
