const express      = require('express');
const cors         = require('cors');
const path         = require('path');

// Boot database (creates tables + seed data on first run)
require('./db/database');

const authRoute         = require('./routes/auth');
const applicationsRoute = require('./routes/applications');
const trackerRoute      = require('./routes/tracker');
const dashboardRoute    = require('./routes/dashboard');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ─────────────────────────────────────────────────────────────────
app.use(cors({
  origin: ['http://localhost:5500', 'http://127.0.0.1:5500', 'http://localhost:3000', 'null'],
  methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Serve frontend files ───────────────────────────────────────────────────────
// Serve the HTML files from the parent directory (put your HTML files in katdesign-frontend/)
const FRONTEND_PATH = path.join(__dirname, '../katdesign-frontend');
app.use(express.static(FRONTEND_PATH));

// ── API Routes ─────────────────────────────────────────────────────────────────
app.use('/api/auth',         authRoute);
app.use('/api/applications', applicationsRoute);
app.use('/api/tracker',      trackerRoute);
app.use('/api/dashboard',    dashboardRoute);

// ── Health check ───────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'KatDesign Holdings API is running', time: new Date().toISOString() });
});

// ── 404 fallback for API routes ────────────────────────────────────────────────
app.use('/api/*', (req, res) => {
  res.status(404).json({ error: 'API endpoint not found.' });
});

// ── Serve frontend 404 page for all other routes ───────────────────────────────
app.use((req, res) => {
  res.sendFile(path.join(FRONTEND_PATH, '404.html'), err => {
    if (err) res.status(404).send('Page not found.');
  });
});

// ── Global error handler ───────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Something went wrong on the server. Please try again.' });
});

// ── Start ──────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log('');
  console.log('  ╔══════════════════════════════════════════╗');
  console.log('  ║   KatDesign Holdings API  ·  Running     ║');
  console.log(`  ║   http://localhost:${PORT}                 ║`);
  console.log('  ╚══════════════════════════════════════════╝');
  console.log('');
  console.log('  Endpoints:');
  console.log(`  GET  http://localhost:${PORT}/api/health`);
  console.log(`  POST http://localhost:${PORT}/api/auth/login`);
  console.log(`  GET  http://localhost:${PORT}/api/applications      (admin)`);
  console.log(`  POST http://localhost:${PORT}/api/applications      (public)`);
  console.log(`  GET  http://localhost:${PORT}/api/tracker/:omang    (public)`);
  console.log(`  GET  http://localhost:${PORT}/api/dashboard         (admin)`);
  console.log('');
});

module.exports = app;
