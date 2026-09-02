const express     = require('express');
const bcrypt      = require('bcryptjs');
const jwt         = require('jsonwebtoken');
const rateLimit   = require('express-rate-limit');
const db          = require('../db/database');
const { JWT_SECRET } = require('../middleware/auth');

const router = express.Router();

// Max 8 login attempts per 15 minutes per IP — slows down brute-force password guessing.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please wait a few minutes and try again.' }
});

// POST /api/auth/login
router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password)
      return res.status(400).json({ error: 'Username and password are required.' });

    const admin = await db.getAsync('SELECT * FROM admins WHERE username = ?', [username.trim()]);
    if (!admin || !bcrypt.compareSync(password, admin.password))
      return res.status(401).json({ error: 'Invalid username or password.' });

    const token = jwt.sign(
      { id: admin.id, username: admin.username, full_name: admin.full_name },
      JWT_SECRET,
      { expiresIn: '8h' }
    );
    res.json({ token, admin: { id: admin.id, username: admin.username, full_name: admin.full_name } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error.' });
  }
});

// POST /api/auth/verify
router.post('/verify', (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ valid: false });
  try {
    const decoded = jwt.verify(authHeader.split(' ')[1], JWT_SECRET);
    res.json({ valid: true, admin: decoded });
  } catch {
    res.status(401).json({ valid: false });
  }
});

module.exports = router;
