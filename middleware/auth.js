// middleware/auth.js — JWT authentication middleware
'use strict';

const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET || 'regatta-screen-secret-change-in-production';

/**
 * Express middleware that validates a Bearer JWT in the Authorization header.
 * On success, sets req.userId and req.userEmail.
 */
function authMiddleware(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Niet ingelogd — token ontbreekt.' });
  }

  const token = authHeader.slice(7);
  try {
    const payload = jwt.verify(token, SECRET);
    req.userId = payload.sub;
    req.userEmail = payload.email;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token ongeldig of verlopen.' });
  }
}

/**
 * Must be used after authMiddleware. Rejects non-admin users.
 * Looks up is_admin from the database via req.db (set in server.js).
 */
function adminMiddleware(req, res, next) {
  const user = req.db.prepare('SELECT is_admin FROM users WHERE id = ?').get(req.userId);
  if (!user || !user.is_admin) {
    return res.status(403).json({ error: 'Geen beheerdersrechten.' });
  }
  next();
}

/**
 * Must be used after authMiddleware. Rejects non-super-admin users.
 * Looks up is_super_admin from the database via req.db (set in server.js).
 */
function superAdminMiddleware(req, res, next) {
  const user = req.db.prepare('SELECT is_super_admin FROM users WHERE id = ?').get(req.userId);
  if (!user || !user.is_super_admin) {
    return res.status(403).json({ error: 'Alleen de super beheerder heeft toegang.' });
  }
  next();
}

module.exports = { authMiddleware, adminMiddleware, superAdminMiddleware, SECRET };
