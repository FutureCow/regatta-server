// routes/classes.js — Class management + join-by-code
'use strict';

const express = require('express');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');

// Leesbare tekens: geen 0/O, 1/I/L verwarring
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function generateCode(db) {
  for (let attempt = 0; attempt < 20; attempt++) {
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    }
    const existing = db.prepare('SELECT id FROM classes WHERE code = ?').get(code);
    if (!existing) return code;
  }
  throw new Error('Kon geen unieke code genereren.');
}

function createClassesRouter(db) {
  const router = express.Router();
  router.use((req, res, next) => { req.db = db; next(); });
  router.use(authMiddleware);

  // ── POST /api/races/:raceId/classes — admin maakt klasse aan ─────────────
  router.post('/races/:raceId/classes', adminMiddleware, (req, res) => {
    const race = db.prepare('SELECT id FROM races WHERE id = ?').get(req.params.raceId);
    if (!race) return res.status(404).json({ error: 'Wedstrijd niet gevonden.' });

    const { name } = req.body || {};
    if (!name || !name.trim()) return res.status(400).json({ error: 'Naam is verplicht.' });

    const code = generateCode(db);
    const result = db.prepare(
      'INSERT INTO classes (race_id, name, code, created_by) VALUES (?, ?, ?, ?)'
    ).run(req.params.raceId, name.trim(), code, req.userId);

    return res.status(201).json({ id: result.lastInsertRowid, code });
  });

  // ── GET /api/races/:raceId/classes — klassen van een wedstrijd ────────────
  router.get('/races/:raceId/classes', (req, res) => {
    const classes = db.prepare(`
      SELECT c.id, c.name, c.code,
             COUNT(rt.track_id) AS participant_count
      FROM classes c
      LEFT JOIN race_tracks rt ON rt.class_id = c.id
      WHERE c.race_id = ?
      GROUP BY c.id
      ORDER BY c.name ASC
    `).all(req.params.raceId);
    return res.json(classes);
  });

  // ── DELETE /api/classes/:id — admin verwijdert klasse ────────────────────
  router.delete('/classes/:id', adminMiddleware, (req, res) => {
    const cls = db.prepare('SELECT id FROM classes WHERE id = ?').get(req.params.id);
    if (!cls) return res.status(404).json({ error: 'Klasse niet gevonden.' });
    db.prepare('DELETE FROM classes WHERE id = ?').run(req.params.id);
    return res.json({ ok: true });
  });

  // ── GET /api/join/:code — code opzoeken, geeft wedstrijd+klasse terug ─────
  router.get('/join/:code', (req, res) => {
    const row = db.prepare(`
      SELECT c.id AS class_id, c.name AS class_name, c.code,
             r.id AS race_id, r.name AS race_name, r.race_date,
             s.name AS series_name
      FROM classes c
      JOIN races r ON r.id = c.race_id
      LEFT JOIN series s ON s.id = r.series_id
      WHERE c.code = ?
    `).get(req.params.code.toUpperCase());
    if (!row) return res.status(404).json({ error: 'Onbekende code.' });
    return res.json(row);
  });

  // ── POST /api/join — track koppelen via code ──────────────────────────────
  router.post('/join', (req, res) => {
    const { code, track_id } = req.body || {};
    if (!code || !track_id) return res.status(400).json({ error: 'code en track_id zijn verplicht.' });

    const cls = db.prepare(`
      SELECT c.id AS class_id, c.race_id
      FROM classes c WHERE c.code = ?
    `).get(code.toUpperCase());
    if (!cls) return res.status(404).json({ error: 'Onbekende code.' });

    // Track moet van deze gebruiker zijn
    const track = db.prepare('SELECT id FROM tracks WHERE id = ? AND user_id = ?').get(track_id, req.userId);
    if (!track) return res.status(404).json({ error: 'Track niet gevonden.' });

    // Al gekoppeld aan deze wedstrijd?
    const existing = db.prepare(
      'SELECT 1 FROM race_tracks WHERE race_id = ? AND track_id = ?'
    ).get(cls.race_id, track_id);
    if (existing) {
      // Update klasse als die nog niet ingesteld was
      db.prepare('UPDATE race_tracks SET class_id = ? WHERE race_id = ? AND track_id = ?')
        .run(cls.class_id, cls.race_id, track_id);
      return res.json({ ok: true, updated: true });
    }

    db.prepare(
      'INSERT INTO race_tracks (race_id, track_id, user_id, class_id) VALUES (?, ?, ?, ?)'
    ).run(cls.race_id, track_id, req.userId, cls.class_id);

    return res.status(201).json({ ok: true });
  });

  // ── GET /api/races/:raceId/classes/:classId/tracks — resultaten per klasse
  router.get('/races/:raceId/classes/:classId/tracks', (req, res) => {
    const cls = db.prepare(
      'SELECT id FROM classes WHERE id = ? AND race_id = ?'
    ).get(req.params.classId, req.params.raceId);
    if (!cls) return res.status(404).json({ error: 'Klasse niet gevonden.' });

    const tracks = db.prepare(`
      SELECT t.id, t.name, t.recorded_at, t.duration_seconds, t.distance_meters,
             t.max_speed_knots, t.avg_speed_knots, t.wind_direction_deg, t.point_count,
             u.email AS user_email, rt.linked_at
      FROM race_tracks rt
      JOIN tracks t ON t.id = rt.track_id
      JOIN users u ON u.id = rt.user_id
      WHERE rt.race_id = ? AND rt.class_id = ?
      ORDER BY t.avg_speed_knots DESC
    `).all(req.params.raceId, req.params.classId);

    return res.json(tracks);
  });

  return router;
}

module.exports = createClassesRouter;
