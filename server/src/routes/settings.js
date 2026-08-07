import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/error.js';
import { requireAdmin } from '../middleware/auth.js';
import { getSettings, setSetting } from '../utils/settings.js';
import { logAction } from '../utils/audit.js';

const router = Router();

// Only these keys are writable through the API, and each has a shape.
const WRITABLE = {
  timezone: z.string().min(1),
  hotel_name: z.string().min(1),
  allow_unscheduled: z.boolean(),
  lock_run_on_complete: z.boolean(),
};

router.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json(await getSettings());
  })
);

router.patch(
  '/',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const body = z.record(z.any()).parse(req.body);

    for (const [key, value] of Object.entries(body)) {
      const schema = WRITABLE[key];
      if (!schema) return res.status(400).json({ error: `Unknown setting: ${key}` });
      await setSetting(key, schema.parse(value), req.user.id);
    }

    logAction(req, { action: 'settings.update', entity: 'settings', details: body });
    res.json(await getSettings());
  })
);

export default router;
