-- ============================================================================
--  Seed data — run AFTER schema.sql
--  The admin account is created by `npm run create-admin` in /server, not here,
--  so no password hash is ever committed to a .sql file.
-- ============================================================================

-- --- Shift windows (editable later from the admin panel) --------------------
INSERT INTO shift_types (code, name_en, name_ar, start_time, end_time, sort_order) VALUES
    ('AM',    'Morning',   'صباحي', '06:00', '14:00', 1),
    ('PM',    'Afternoon', 'مسائي', '14:00', '22:00', 2),
    ('NIGHT', 'Night',     'ليلي',  '22:00', '06:00', 3)
ON CONFLICT (code) DO NOTHING;

-- --- Locations ----------------------------------------------------------------
INSERT INTO smallville_engineering.locations (code, name_en, name_ar, location, sort_order) VALUES
    ('PENTHOUSE', 'Penthouse', 'البنتهاوس', 'Top floor',     1),
    ('POOLHOUSE', 'Poolhouse', 'بيت المسبح', 'Pool deck',    2),
    ('DASOPHIA',  'Dasophia',  'داسوفيا',   'Ground floor',  3),
    ('MARVELOUS', 'Marvelous', 'مارفلوس',   'Mezzanine',     4)
ON CONFLICT DO NOTHING;

-- --- Task subLocations --------------------------------------------------------
-- sub_locations has no unique constraint (two locations may legitimately want
-- similarly named subLocations later), so guard on name instead of ON CONFLICT —
-- otherwise re-running this file would duplicate every subLocation.
INSERT INTO sub_locations (name_en, name_ar, icon, sort_order)
SELECT * FROM (VALUES
    ('Electrical',    'كهرباء',         '⚡',  1),
    ('Plumbing',      'سباكة',          '🚰', 2),
    ('HVAC',          'تكييف وتهوية',   '❄️', 3),
    ('Safety & Fire', 'السلامة والحريق','🧯', 4),
    ('General',       'عام',            '🔧', 5)
) AS v(name_en, name_ar, icon, sort_order)
WHERE NOT EXISTS (
    SELECT 1 FROM sub_locations c WHERE c.name_en = v.name_en AND c.deleted_at IS NULL
);

-- --- Starter tasks (a small sample per location; admin edits from the panel) ---
-- Every location gets the same starter set so there is something to click on
-- day one. Delete or replace freely from the admin panel.
--
-- The per-location NOT EXISTS guard makes this safe to re-run: an location that
-- already has tasks is skipped entirely, so `npm run db:init` never duplicates
-- a live checklist, and a NEW location added later still gets the starter set.
INSERT INTO tasks (location_id, sub_location_id, description_en, description_ar, frequency, is_critical, sort_order)
SELECT o.id, c.id, x.description_en, x.description_ar, x.frequency, x.is_critical, x.sort_order
FROM locations o
CROSS JOIN (VALUES
    ('Electrical',    'All lights working (no blown bulbs)',        'جميع الإنارة تعمل (لا يوجد لمبات محروقة)', 'every_shift', FALSE, 10),
    ('Electrical',    'Distribution board closed and labelled',      'لوحة التوزيع مقفلة ومعلّمة',              'daily',       TRUE,  20),
    ('Electrical',    'No exposed wiring or loose sockets',          'لا يوجد أسلاك مكشوفة أو مقابس مفكوكة',    'every_shift', TRUE,  30),
    ('Plumbing',      'No leaks under sinks',                        'لا يوجد تسريب تحت المغاسل',               'every_shift', FALSE, 10),
    ('Plumbing',      'Drains running freely',                       'المصارف تعمل بشكل سليم',                  'every_shift', FALSE, 20),
    ('Plumbing',      'Water heater temperature normal',             'حرارة سخان المياه طبيعية',                'daily',       FALSE, 30),
    ('HVAC',          'AC units cooling correctly',                  'وحدات التكييف تبرّد بشكل صحيح',           'every_shift', FALSE, 10),
    ('HVAC',          'Filters clean',                               'الفلاتر نظيفة',                           'weekly',      FALSE, 20),
    ('HVAC',          'No unusual noise or vibration',               'لا يوجد صوت أو اهتزاز غير طبيعي',         'every_shift', FALSE, 30),
    ('Safety & Fire', 'Fire extinguishers in place and in date',     'طفايات الحريق موجودة وصالحة',             'daily',       TRUE,  10),
    ('Safety & Fire', 'Emergency exits clear and unlocked',          'مخارج الطوارئ سالكة وغير مقفلة',          'every_shift', TRUE,  20),
    ('Safety & Fire', 'Emergency lighting operational',              'إنارة الطوارئ تعمل',                      'daily',       TRUE,  30),
    ('General',       'Area clean and free of hazards',              'المنطقة نظيفة وخالية من المخاطر',         'every_shift', FALSE, 10),
    ('General',       'Furniture and fixtures undamaged',            'الأثاث والتجهيزات سليمة',                 'every_shift', FALSE, 20)
) AS x(cat, description_en, description_ar, frequency, is_critical, sort_order)
JOIN sub_locations c ON c.name_en = x.cat AND c.deleted_at IS NULL
WHERE o.deleted_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.location_id = o.id);

-- --- Default settings -------------------------------------------------------
INSERT INTO app_settings (key, value) VALUES
    ('timezone',             '"Asia/Beirut"'::jsonb),
    -- "a No must be explained" is enforced by a CHECK constraint on
    -- task_answers, not by a setting, so it cannot be bypassed by the API.
    ('allow_unscheduled',     'true'::jsonb),
    ('lock_run_on_complete',  'false'::jsonb),
    ('hotel_name',           '"The SmallVille Hotel"'::jsonb)
ON CONFLICT (key) DO NOTHING;
