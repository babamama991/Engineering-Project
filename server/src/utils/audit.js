import { query } from '../db.js';

/** Fire-and-forget admin action log. Never blocks or fails the request. */
export function logAction(req, { action, entity, entityId = null, details = null }) {
  query(
    `INSERT INTO audit_log (actor_id, action, entity, entity_id, details, ip_address)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
    [
      req.user?.id ?? null,
      action,
      entity,
      entityId,
      details ? JSON.stringify(details) : null,
      req.ip,
    ]
  ).catch((err) => console.error('[audit] failed to log', action, err.message));
}
