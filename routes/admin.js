// routes/admin.js — Super admin routes (user management)
'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const { authMiddleware, superAdminMiddleware } = require('../middleware/auth');

/**
 * Returns an Express router with super-admin user management routes.
 * All routes require authMiddleware + superAdminMiddleware.
 */
function createAdminRouter(db) {
  const router = express.Router();

  // ── All routes require auth + super admin ──────────────────────────────────
  router.use(authMiddleware);
  router.use(superAdminMiddleware);

  // ── GET /api/admin/users ──────────────────────────────────────────────────
  // List all users with role, boat info, and track count.
  router.get('/users', (req, res) => {
    const users = db.prepare(`
      SELECT
        u.id, u.email, u.is_admin, u.is_super_admin,
        u.boat_type, u.boat_name, u.team_name,
        u.created_at,
        COUNT(t.id) AS track_count
      FROM users u
      LEFT JOIN tracks t ON t.user_id = u.id
      GROUP BY u.id
      ORDER BY u.created_at DESC
    `).all();

    const result = users.map(u => ({
      id: u.id,
      email: u.email,
      role: u.is_super_admin ? 'Super Admin' : u.is_admin ? 'Beheerder' : 'Zeiler',
      boatType: u.boat_type,
      boatName: u.boat_name,
      teamName: u.team_name,
      trackCount: u.track_count,
      createdAt: u.created_at,
    }));

    return res.json(result);
  });

  // ── GET /api/admin/users/:id ──────────────────────────────────────────────
  // Get a single user's details including their tracks.
  router.get('/users/:id', (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Ongeldige gebruikers-ID.' });

    const user = db.prepare(`
      SELECT
        u.id, u.email, u.is_admin, u.is_super_admin,
        u.boat_type, u.boat_name, u.team_name,
        u.created_at,
        COUNT(t.id) AS track_count
      FROM users u
      LEFT JOIN tracks t ON t.user_id = u.id
      WHERE u.id = ?
      GROUP BY u.id
    `).get(id);

    if (!user) return res.status(404).json({ error: 'Gebruiker niet gevonden.' });

    return res.json({
      id: user.id,
      email: user.email,
      role: user.is_super_admin ? 'Super Admin' : user.is_admin ? 'Beheerder' : 'Zeiler',
      isAdmin: !!user.is_admin,
      isSuperAdmin: !!user.is_super_admin,
      boatType: user.boat_type,
      boatName: user.boat_name,
      teamName: user.team_name,
      trackCount: user.track_count,
      createdAt: user.created_at,
    });
  });

  // ── PUT /api/admin/users/:id/role ─────────────────────────────────────────
  // Change a user's role. Body: { role: "zeiler" | "beheerder" | "super_admin" }
  router.put('/users/:id/role', (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Ongeldige gebruikers-ID.' });

    const { role } = req.body || {};
    const validRoles = ['zeiler', 'beheerder', 'super_admin'];
    if (!role || !validRoles.includes(role)) {
      return res.status(400).json({ error: `Rol moet één van zijn: ${validRoles.join(', ')}.` });
    }

    const user = db.prepare('SELECT id FROM users WHERE id = ?').get(id);
    if (!user) return res.status(404).json({ error: 'Gebruiker niet gevonden.' });

    // Prevent removing your own super admin rights (safety net)
    if (id === req.userId && role !== 'super_admin') {
      return res.status(400).json({ error: 'Je kunt je eigen super admin-rechten niet intrekken.' });
    }

    const isAdmin = role === 'beheerder' || role === 'super_admin' ? 1 : 0;
    const isSuperAdmin = role === 'super_admin' ? 1 : 0;

    db.prepare('UPDATE users SET is_admin = ?, is_super_admin = ? WHERE id = ?')
      .run(isAdmin, isSuperAdmin, id);

    const updated = db.prepare('SELECT id, email, is_admin, is_super_admin FROM users WHERE id = ?').get(id);
    const newRole = updated.is_super_admin ? 'Super Admin' : updated.is_admin ? 'Beheerder' : 'Zeiler';

    return res.json({ id: updated.id, email: updated.email, role: newRole });
  });

  // ── DELETE /api/admin/users/:id ───────────────────────────────────────────
  // Delete a user and all their data (tracks, etc.).
  router.delete('/users/:id', (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Ongeldige gebruikers-ID.' });

    if (id === req.userId) {
      return res.status(400).json({ error: 'Je kunt je eigen account niet verwijderen via dit endpoint.' });
    }

    const user = db.prepare('SELECT id, email FROM users WHERE id = ?').get(id);
    if (!user) return res.status(404).json({ error: 'Gebruiker niet gevonden.' });

    // CASCADE handles tracks, race_tracks via FK
    db.prepare('DELETE FROM users WHERE id = ?').run(id);

    return res.json({ deleted: { id: user.id, email: user.email } });
  });

  // ── POST /api/admin/users ─────────────────────────────────────────────────
  // Create a new user (admin-driven registration). Body: { email, password, role?, boat_type?, boat_name?, team_name? }
  router.post('/users', async (req, res) => {
    const { email, password, role, boat_type, boat_name, team_name } = req.body || {};

    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return res.status(400).json({ error: 'Ongeldig e-mailadres.' });
    }
    if (!password || typeof password !== 'string' || password.length < 6) {
      return res.status(400).json({ error: 'Wachtwoord moet minimaal 6 tekens bevatten.' });
    }

    const normalised = email.trim().toLowerCase();

    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(normalised);
    if (existing) {
      return res.status(409).json({ error: 'Er bestaat al een account met dit e-mailadres.' });
    }

    const validRoles = ['zeiler', 'beheerder', 'super_admin'];
    const targetRole = role && validRoles.includes(role) ? role : 'zeiler';
    const isAdmin = targetRole === 'beheerder' || targetRole === 'super_admin' ? 1 : 0;
    const isSuperAdmin = targetRole === 'super_admin' ? 1 : 0;

    try {
      const passwordHash = await bcrypt.hash(password, 12);
      const result = db.prepare(`
        INSERT INTO users (email, password_hash, is_admin, is_super_admin, boat_type, boat_name, team_name)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(normalised, passwordHash, isAdmin, isSuperAdmin,
        boat_type || null, boat_name || null, team_name || null);

      return res.status(201).json({
        id: result.lastInsertRowid,
        email: normalised,
        role: targetRole === 'super_admin' ? 'Super Admin' : targetRole === 'beheerder' ? 'Beheerder' : 'Zeiler',
      });
    } catch (err) {
      console.error('Admin create user error:', err);
      return res.status(500).json({ error: 'Interne serverfout bij aanmaken gebruiker.' });
    }
  });

  return router;
}

module.exports = createAdminRouter;
