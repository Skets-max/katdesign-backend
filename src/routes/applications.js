const express         = require('express');
const db              = require('../db/database');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

async function generateRef() {
  const row = await db.getAsync('SELECT COUNT(*) as c FROM loans');
  return `KDH-${new Date().getFullYear()}-${String(row.c + 1).padStart(3, '0')}`;
}

async function logActivity(loan_id, action, actor = 'system', note = null) {
  await db.runAsync(
    'INSERT INTO activity_log (loan_id,action,actor,note) VALUES (?,?,?,?)',
    [loan_id, action, actor, note]
  );
}

// PUBLIC: POST /api/applications
router.post('/', async (req, res) => {
  try {
    const {
      first_name, last_name, omang, phone, email,
      institution, programme, year_of_study,
      sponsoring_body, sponsorship_ref,
      amount, purpose,
      bank_name, account_holder, account_number, branch_code, account_type
    } = req.body;

    const required = { first_name, last_name, omang, phone, email, institution,
      programme, year_of_study, sponsoring_body, sponsorship_ref,
      amount, bank_name, account_holder, account_number, branch_code, account_type };

    for (const [key, val] of Object.entries(required)) {
      if (!val && val !== 0)
        return res.status(400).json({ error: `Missing required field: ${key}` });
    }

    const amt = parseFloat(amount);
    if (isNaN(amt) || amt < 500 || amt > 1500)
      return res.status(400).json({ error: 'Loan amount must be between P500 and P1,500.' });

    // Check for existing active loan
    const existing = await db.getAsync(
      `SELECT l.id FROM loans l JOIN students s ON l.student_id=s.id
       WHERE s.omang=? AND l.status IN ('pending','approved','disbursed')`,
      [omang]
    );
    if (existing)
      return res.status(409).json({ error: 'You already have an active or pending loan.' });

    const repayable = parseFloat((amt * 1.3).toFixed(2));
    const interest  = parseFloat((amt * 0.3).toFixed(2));

    // Upsert student
    const existingStudent = await db.getAsync('SELECT id FROM students WHERE omang=?', [omang]);
    let studentId;
    if (existingStudent) {
      await db.runAsync(
        `UPDATE students SET first_name=?,last_name=?,phone=?,email=?,institution=?,
         programme=?,year_of_study=?,sponsoring_body=?,sponsorship_ref=? WHERE omang=?`,
        [first_name,last_name,phone,email,institution,programme,year_of_study,sponsoring_body,sponsorship_ref,omang]
      );
      studentId = existingStudent.id;
    } else {
      const result = await db.runAsync(
        `INSERT INTO students (first_name,last_name,omang,phone,email,institution,programme,year_of_study,sponsoring_body,sponsorship_ref)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [first_name,last_name,omang,phone,email,institution,programme,year_of_study,sponsoring_body,sponsorship_ref]
      );
      studentId = result.lastID;
    }

    const reference = await generateRef();
    const result = await db.runAsync(
      `INSERT INTO loans (reference,student_id,amount,repayable,interest,purpose,status,bank_name,account_holder,account_number,branch_code,account_type)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [reference,studentId,amt,repayable,interest,purpose||null,'pending',bank_name,account_holder,account_number,branch_code,account_type]
    );

    await logActivity(result.lastID, 'application_submitted', 'student');

    res.status(201).json({ success: true, reference, repayable, message: 'Application submitted. You will be contacted within 72 hours.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error.' });
  }
});

// ADMIN: GET /api/applications
router.get('/', requireAuth, async (req, res) => {
  try {
    const { status, search } = req.query;
    let sql = `SELECT l.id,l.reference,l.amount,l.repayable,l.interest,l.status,
      l.bank_name,l.applied_at,l.approved_at,l.disbursed_at,l.due_date,l.collected_at,
      s.first_name,s.last_name,s.omang,s.institution,s.sponsoring_body,
      s.programme,s.year_of_study,s.phone,s.email
      FROM loans l JOIN students s ON l.student_id=s.id`;
    const params = [];
    const conditions = [];

    if (status && status !== 'all') { conditions.push('l.status=?'); params.push(status); }
    if (search) {
      conditions.push(`(s.first_name||' '||s.last_name LIKE ? OR s.omang LIKE ? OR l.reference LIKE ? OR s.institution LIKE ?)`);
      const q = `%${search}%`;
      params.push(q, q, q, q);
    }
    if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');
    sql += ' ORDER BY l.applied_at DESC';

    const loans = await db.allAsync(sql, params);
    res.json({ loans, total: loans.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error.' });
  }
});

// ADMIN: GET /api/applications/:id
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const loan = await db.getAsync(
      `SELECT l.*,s.first_name,s.last_name,s.omang,s.institution,s.sponsoring_body,s.programme,s.year_of_study,s.phone,s.email
       FROM loans l JOIN students s ON l.student_id=s.id WHERE l.id=?`,
      [req.params.id]
    );
    if (!loan) return res.status(404).json({ error: 'Loan not found.' });
    const activity = await db.allAsync('SELECT * FROM activity_log WHERE loan_id=? ORDER BY created_at DESC', [loan.id]);
    res.json({ loan, activity });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error.' });
  }
});

// ADMIN: PATCH /api/applications/:id/status
router.patch('/:id/status', requireAuth, async (req, res) => {
  try {
    const { status, notes } = req.body;
    const valid = ['pending','approved','rejected','disbursed','collected','overdue'];
    if (!valid.includes(status))
      return res.status(400).json({ error: `Invalid status. Must be one of: ${valid.join(', ')}` });

    const loan = await db.getAsync('SELECT * FROM loans WHERE id=?', [req.params.id]);
    if (!loan) return res.status(404).json({ error: 'Loan not found.' });

    const now = new Date().toISOString();
    const updates = { status };
    if (status === 'approved')  updates.approved_at  = now;
    if (status === 'rejected')  updates.approved_at  = now;
    if (status === 'disbursed') {
      updates.disbursed_at = now;
      updates.due_date     = new Date(Date.now() + 30*24*60*60*1000).toISOString();
    }
    if (status === 'collected') updates.collected_at = now;
    if (notes) updates.notes = notes;

    const fields = Object.keys(updates).map(k => `${k}=?`).join(',');
    await db.runAsync(`UPDATE loans SET ${fields} WHERE id=?`, [...Object.values(updates), req.params.id]);
    await logActivity(loan.id, `status_changed_to_${status}`, req.admin.username, notes || null);

    const updated = await db.getAsync('SELECT * FROM loans WHERE id=?', [req.params.id]);
    res.json({ success: true, loan: updated });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error.' });
  }
});

module.exports = router;
