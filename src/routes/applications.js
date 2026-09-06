const express         = require('express');
const rateLimit       = require('express-rate-limit');
const crypto          = require('crypto');
const db              = require('../db/database');
const { requireAuth } = require('../middleware/auth');
const { sendMail }    = require('../utils/mailer');

const router = express.Router();

// Max 5 new applications per hour per visitor — enough for a genuine applicant
// to retry a typo, but not enough to script through many fake/probing submissions.
const applyLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many applications submitted from this connection. Please try again later or contact us.' }
});

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

// True if the bank account holder name doesn't look like the applicant's own name —
// a red flag for the most common fraud pattern (stolen identity, attacker's own account).
function looksLikeNameMismatch(accountHolder, firstName, lastName) {
  const norm = s => String(s || '').toLowerCase().replace(/[^a-z]/g, '');
  const holder = norm(accountHolder);
  if (!holder) return true;
  return !(holder.includes(norm(firstName)) && holder.includes(norm(lastName)));
}

// PUBLIC: POST /api/applications
router.post('/', applyLimiter, async (req, res) => {
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
    const verificationToken = crypto.randomBytes(20).toString('hex');

    const result = await db.runAsync(
      `INSERT INTO loans (reference,student_id,amount,repayable,interest,purpose,status,bank_name,account_holder,account_number,branch_code,account_type,verification_token)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [reference,studentId,amt,repayable,interest,purpose||null,'pending',bank_name,account_holder,account_number,branch_code,account_type,verificationToken]
    );

    await logActivity(result.lastID, 'application_submitted', 'student');

    // Send an email confirmation link. This is informational for the admin
    // (shown as a signal, not a hard requirement) since free email delivery
    // isn't 100% guaranteed — it must never block a genuine application.
    const verifyUrl = `${req.protocol}://${req.get('host')}/api/applications/verify-email/${verificationToken}`;
    sendMail({
      to: email,
      subject: 'Confirm your KatDesign Holdings loan application',
      html: `
        <p>Hi ${first_name},</p>
        <p>Thanks for applying for a loan with KatDesign Holdings. Please confirm this application is really from you by clicking the link below:</p>
        <p><a href="${verifyUrl}">${verifyUrl}</a></p>
        <p>Your reference number is <strong>${reference}</strong>.</p>
        <p>If you didn't apply for this loan, please ignore this email or contact us.</p>
      `,
      text: `Confirm your application (ref ${reference}) by visiting: ${verifyUrl}`
    }).catch(() => {}); // never let an email failure affect the response below

    res.status(201).json({ success: true, reference, repayable, message: 'Application submitted. Please check your email to confirm it, and you will be contacted within 72 hours.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error.' });
  }
});

// PUBLIC: GET /api/applications/verify-email/:token
router.get('/verify-email/:token', async (req, res) => {
  try {
    const loan = await db.getAsync('SELECT id,reference,email_verified FROM loans WHERE verification_token=?', [req.params.token]);
    if (!loan) {
      return res.status(404).send('<h2>Invalid or expired confirmation link.</h2><p>Please contact us if you need help with your application.</p>');
    }
    if (!loan.email_verified) {
      await db.runAsync('UPDATE loans SET email_verified=1 WHERE id=?', [loan.id]);
      await logActivity(loan.id, 'email_verified', 'student');
    }
    res.send(`<h2>Thanks — your email is confirmed \u2713</h2><p>Your application (ref ${loan.reference}) is being reviewed. You can close this page.</p>`);
  } catch (err) {
    console.error(err);
    res.status(500).send('<h2>Something went wrong.</h2>');
  }
});

// ADMIN: GET /api/applications
router.get('/', requireAuth, async (req, res) => {
  try {
    const { status, search } = req.query;
    let sql = `SELECT l.id,l.reference,l.amount,l.repayable,l.interest,l.status,
      l.bank_name,l.account_holder,l.account_number,l.branch_code,
      l.identity_verified,l.email_verified,
      l.applied_at,l.approved_at,l.disbursed_at,l.due_date,l.collected_at,
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

    // Flag bank accounts reused across more than one distinct applicant —
    // a classic sign of one person applying under several stolen identities.
    const reused = await db.allAsync(`
      SELECT l.account_number, l.branch_code
      FROM loans l
      GROUP BY l.account_number, l.branch_code
      HAVING COUNT(DISTINCT l.student_id) > 1
    `);
    const reusedSet = new Set(reused.map(r => `${r.account_number}|${r.branch_code}`));

    const annotated = loans.map(l => ({
      ...l,
      name_mismatch:  looksLikeNameMismatch(l.account_holder, l.first_name, l.last_name),
      account_reused: reusedSet.has(`${l.account_number}|${l.branch_code}`)
    }));

    res.json({ loans: annotated, total: annotated.length });
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

    const sameAccount = await db.allAsync(
      `SELECT l.id,l.reference,s.first_name,s.last_name,s.omang
       FROM loans l JOIN students s ON l.student_id=s.id
       WHERE l.account_number=? AND l.branch_code=? AND l.student_id<>?`,
      [loan.account_number, loan.branch_code, loan.student_id]
    );

    loan.name_mismatch  = looksLikeNameMismatch(loan.account_holder, loan.first_name, loan.last_name);
    loan.account_reused = sameAccount.length > 0;
    loan.reused_by      = sameAccount; // other applicants sharing this same bank account

    const activity = await db.allAsync('SELECT * FROM activity_log WHERE loan_id=? ORDER BY created_at DESC', [loan.id]);
    res.json({ loan, activity });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error.' });
  }
});

// ADMIN: PATCH /api/applications/:id/verify-identity
// A human step: the admin confirms they've actually called/verified the applicant.
// This is the real hard gate before a loan can be approved — everything else
// (name-mismatch flag, email confirmation) is a signal to help this decision,
// not a substitute for it.
router.patch('/:id/verify-identity', requireAuth, async (req, res) => {
  try {
    const loan = await db.getAsync('SELECT id FROM loans WHERE id=?', [req.params.id]);
    if (!loan) return res.status(404).json({ error: 'Loan not found.' });
    await db.runAsync('UPDATE loans SET identity_verified=1 WHERE id=?', [req.params.id]);
    await logActivity(loan.id, 'identity_verified', req.admin.username, 'Admin confirmed applicant identity (e.g. by phone)');
    res.json({ success: true });
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

    // Hard gate: an applicant's identity must be manually verified (by phone,
    // typically) before a loan can be approved. This is the main protection
    // against someone applying using a stolen identity.
    if (status === 'approved' && !loan.identity_verified) {
      return res.status(400).json({ error: "Please verify the applicant's identity first (see the Verify Identity button) before approving this loan." });
    }

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
