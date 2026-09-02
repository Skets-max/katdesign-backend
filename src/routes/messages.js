const express         = require('express');
const db              = require('../db/database');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// PUBLIC: POST /api/messages  (contact form)
router.post('/', async (req, res) => {
  try {
    const { name, email, subject, message } = req.body;

    const required = { name, email, subject, message };
    for (const [key, val] of Object.entries(required)) {
      if (!val) return res.status(400).json({ error: `Missing required field: ${key}` });
    }

    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailPattern.test(email))
      return res.status(400).json({ error: 'Please enter a valid email address.' });

    await db.runAsync(
      'INSERT INTO contact_messages (name,email,subject,message) VALUES (?,?,?,?)',
      [name, email, subject, message]
    );

    res.status(201).json({ success: true, message: "Thank you for reaching out. We'll get back to you within one business day." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error.' });
  }
});

// ADMIN: GET /api/messages
router.get('/', requireAuth, async (req, res) => {
  try {
    const messages = await db.allAsync('SELECT * FROM contact_messages ORDER BY created_at DESC');
    const unread = messages.filter(m => !m.read).length;
    res.json({ messages, total: messages.length, unread });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error.' });
  }
});

// ADMIN: PATCH /api/messages/:id/read
router.patch('/:id/read', requireAuth, async (req, res) => {
  try {
    const msg = await db.getAsync('SELECT id FROM contact_messages WHERE id=?', [req.params.id]);
    if (!msg) return res.status(404).json({ error: 'Message not found.' });
    await db.runAsync('UPDATE contact_messages SET read=1 WHERE id=?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error.' });
  }
});

module.exports = router;
