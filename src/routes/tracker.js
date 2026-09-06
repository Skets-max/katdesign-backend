const express   = require('express');
const rateLimit = require('express-rate-limit');
const db        = require('../db/database');

const router = express.Router();

// Max 10 lookups per 15 minutes per visitor — slows down anyone trying to
// scan through many ID numbers looking for valid ones.
const trackerLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many lookups. Please wait a few minutes and try again.' }
});

function normalisePhone(p) {
  return String(p || '').replace(/\D/g, '').slice(-8); // last 8 digits, Botswana mobile length
}

// PUBLIC: GET /api/tracker/:omang?phone=71234567
// Requires BOTH the ID number and the phone number used at application time —
// an ID number alone isn't a secret (family, employers, schools all see it),
// so a single factor isn't enough to protect someone's loan details.
router.get('/:omang', trackerLimiter, async (req, res) => {
  try {
    const { omang } = req.params;
    const { phone }  = req.query;

    if (!omang || omang.trim().length < 5)
      return res.status(400).json({ error: 'Please provide a valid ID number.' });
    if (!phone || normalisePhone(phone).length < 8)
      return res.status(400).json({ error: 'Please also provide the phone number used on your application.' });

    const loan = await db.getAsync(
      `SELECT l.id,l.reference,l.amount,l.repayable,l.interest,l.status,
              l.bank_name,l.account_type,l.applied_at,l.approved_at,
              l.disbursed_at,l.due_date,l.collected_at,
              s.first_name,s.last_name,s.omang,s.phone,
              s.institution,s.sponsoring_body,s.programme,s.year_of_study
       FROM loans l JOIN students s ON l.student_id=s.id
       WHERE s.omang=? ORDER BY l.applied_at DESC LIMIT 1`,
      [omang.trim()]
    );

    // Same generic message whether the ID doesn't exist OR the phone doesn't match —
    // this stops an attacker from using the error message to confirm a guessed ID
    // number is valid even without the right phone number.
    if (!loan || normalisePhone(loan.phone) !== normalisePhone(phone))
      return res.status(404).json({ error: 'No matching loan found. Please check your ID number and phone number and try again, or contact us.' });

    res.json({
      reference:    loan.reference,
      status:       loan.status,
      amount:       loan.amount,
      repayable:    loan.repayable,
      interest:     loan.interest,
      bank_name:    loan.bank_name,
      account_type: loan.account_type,
      applied_at:   loan.applied_at,
      approved_at:  loan.approved_at,
      disbursed_at: loan.disbursed_at,
      due_date:     loan.due_date,
      collected_at: loan.collected_at,
      student: {
        name:        `${loan.first_name} ${loan.last_name}`,
        initials:    `${loan.first_name[0]}${loan.last_name[0]}`,
        institution: loan.institution,
        sponsorship: loan.sponsoring_body,
        programme:   loan.programme,
        year:        loan.year_of_study,
        omang:       loan.omang
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error.' });
  }
});

module.exports = router;
