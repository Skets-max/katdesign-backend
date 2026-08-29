const express         = require('express');
const db              = require('../db/database');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// ADMIN: GET /api/dashboard
router.get('/', requireAuth, async (req, res) => {
  try {
    const total     = await db.getAsync(`SELECT COUNT(*) as c FROM loans`);
    const pending   = await db.getAsync(`SELECT COUNT(*) as c FROM loans WHERE status='pending'`);
    const overdue   = await db.getAsync(`SELECT COUNT(*) as c FROM loans WHERE status='overdue'`);
    const disbStats = await db.getAsync(`
      SELECT COUNT(*) as count,
             COALESCE(SUM(amount),0)    as total_disbursed,
             COALESCE(SUM(repayable),0) as total_expected,
             COALESCE(SUM(CASE WHEN status='collected' THEN repayable ELSE 0 END),0) as total_collected
      FROM loans WHERE status IN ('disbursed','overdue','collected')
    `);

    const byInstitution = await db.allAsync(`
      SELECT s.institution, COUNT(*) as count
      FROM loans l JOIN students s ON l.student_id=s.id
      GROUP BY s.institution ORDER BY count DESC
    `);

    const recentActivity = await db.allAsync(`
      SELECT a.action,a.actor,a.note,a.created_at,l.reference,
             s.first_name||' '||s.last_name as student_name
      FROM activity_log a
      JOIN loans l    ON a.loan_id=l.id
      JOIN students s ON l.student_id=s.id
      ORDER BY a.created_at DESC LIMIT 10
    `);

    const upcoming = await db.allAsync(`
      SELECT l.reference,l.repayable,l.due_date,
             s.first_name||' '||s.last_name as student_name, s.phone
      FROM loans l JOIN students s ON l.student_id=s.id
      WHERE l.status='disbursed'
        AND l.due_date BETWEEN datetime('now') AND datetime('now','+7 days')
      ORDER BY l.due_date ASC
    `);

    res.json({
      metrics: {
        total_applications: total.c,
        pending:            pending.c,
        overdue:            overdue.c,
        active_loans:       disbStats.count,
        total_disbursed:    disbStats.total_disbursed,
        total_expected:     disbStats.total_expected,
        total_collected:    disbStats.total_collected,
      },
      by_institution:  byInstitution,
      recent_activity: recentActivity,
      upcoming_due:    upcoming
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error.' });
  }
});

module.exports = router;
