// server.js — Regatta Screen API server
'use strict';

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const { initDb } = require('./db');
const createAuthRouter = require('./routes/auth');
const createTracksRouter = require('./routes/tracks');
const createRacesRouter = require('./routes/races');

// ── Directory setup ────────────────────────────────────────────────────────
const DATA_DIR = path.join(__dirname, 'data');
const TRACKS_DIR = path.join(DATA_DIR, 'tracks');
const DB_PATH = path.join(DATA_DIR, 'regatta.db');
const WEB_DIR = path.join(__dirname, 'web');

fs.mkdirSync(TRACKS_DIR, { recursive: true });

// ── Database ───────────────────────────────────────────────────────────────
const db = initDb(DB_PATH);

// ── Express app ───────────────────────────────────────────────────────────
const app = express();

app.use(cors({
  origin: true,
  credentials: true,
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Static web frontend ────────────────────────────────────────────────────
app.use(express.static(WEB_DIR));

// Attach db to every request so middleware can access it
app.use((req, res, next) => { req.db = db; next(); });

// ── API routes ─────────────────────────────────────────────────────────────
app.use('/api/auth', createAuthRouter(db));
app.use('/api/tracks', createTracksRouter(db, TRACKS_DIR));
app.use('/api/races', createRacesRouter(db, TRACKS_DIR));

// ── Fallback: serve index.html for SPA-like navigation ────────────────────
app.get('*', (req, res) => {
  const indexPath = path.join(WEB_DIR, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).send('Not found');
  }
});

// ── Start server ───────────────────────────────────────────────────────────
const HOST = '127.0.0.1';
const PORT = 3000;

app.listen(PORT, HOST, () => {
  console.log(`Regatta Server running at http://${HOST}:${PORT}`);
});
