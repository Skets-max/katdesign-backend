const express      = require('express');
const cors         = require('cors');
const path         = require('path');

// Boot database (creates tables + seed data on first run)
const db = require('./db/database');

const authRoute         = require('./routes/auth');
const applicationsRoute = require('./routes/applications');
const trackerRoute      = require('./routes/tracker');
const dashboardRoute    = require('./routes/dashboard');
const messagesRoute     = require('./routes/messages');

const app  = express();
const PORT = process.env.PORT || 3000;

// Render (and most PaaS hosts) sit behind a reverse proxy — trust the first hop
// so req.ip reflects the real visitor, which express-rate-limit needs to work per-IP.
app.set('trust proxy', 1);

// ── Middleware ─────────────────────────────────────────────────────────────────
// Reflect whatever origin made the request (works for localhost dev, the Render
// domain, a custom domain, previews, etc.) without needing a hardcoded allowlist.
// Safe here because we use Bearer tokens, not cookies, for auth.
app.use(cors({
  origin: true,
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Log every request so Render's Logs tab shows exactly what's happening.
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    console.log(`${req.method} ${req.originalUrl} -> ${res.statusCode} (${Date.now() - start}ms)`);
  });
  next();
});

// ── Serve frontend files ───────────────────────────────────────────────────────
// Serve the HTML files from the parent directory (put your HTML files in katdesign-frontend/)
const FRONTEND_PATH = path.join(__dirname, '../katdesign-frontend');
app.use(express.static(FRONTEND_PATH));

// ── API Routes ─────────────────────────────────────────────────────────────────
app.use('/api/auth',         authRoute);
app.use('/api/applications', applicationsRoute);
app.use('/api/tracker',      trackerRoute);
app.use('/api/dashboard',    dashboardRoute);
app.use('/api/messages',     messagesRoute);

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

// Don't let an unexpected async error silently kill the whole process
// (which would make every subsequent request fail with a connection error).
process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err);
});

// ── Start ──────────────────────────────────────────────────────────────────────
// Wait for the database to finish creating tables / seeding before accepting
// requests — otherwise a request that lands during startup can hit tables
// that don't exist yet.
db.ready
  .then(() => {
    app.listen(PORT, '0.0.0.0', () => {
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
  })
  .catch((err) => {
    console.error('Fatal: could not start server, database was not ready:', err);
    process.exit(1);
  });

module.exports = app;
