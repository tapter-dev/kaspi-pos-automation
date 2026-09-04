import { DASHBOARD_COOKIE, hashSessionToken } from '../security/dashboardSessions.js';
import { getPool } from '../database/client.js';

export const createDashboardAuth = ({ pool, secret = process.env.DASHBOARD_SESSION_SECRET || '' } = {}) =>
  async (req, res, next) => {
    const token = req.cookies?.[DASHBOARD_COOKIE];
    if (!token) return res.status(401).json({ error: 'Dashboard authentication required.' });

    try {
      const database = pool || getPool();
      const result = await database.query('SELECT * FROM authenticate_dashboard_session($1)', [
        hashSessionToken(token, secret),
      ]);
      if (!result.rows[0]) return res.status(401).json({ error: 'Dashboard session expired.' });
      req.auth = { type: 'dashboard', ...result.rows[0] };
      next();
    } catch (err) {
      next(err);
    }
  };

export const requireRole = (...roles) => (req, res, next) => {
  if (!req.auth || !roles.includes(req.auth.role)) {
    return res.status(403).json({ error: 'You do not have permission to perform this action.' });
  }
  next();
};

