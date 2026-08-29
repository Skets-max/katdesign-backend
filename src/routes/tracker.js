const express = require('express');
const db      = require('../db/database');

const router = express.Router();

// PUBLIC: GET /api/tracker/:omang
router.get('/:omang', async (req, res) => {
  try {
    const { omang } = req.params;
    if (!omang || omang.trim().length < 5)
      return res.status(400).json({ error: 'Please provide a valid ID number.' });

    const loan = await db.getAsync(
      `SELECT l.id,l.reference,l.amount,l.repayable,l.interest,l.status,
              l.bank_name,l.account_type,l.applied_at,l.approved_at,
              l.disbursed_at,l.due_date,l.collected_at,
              s.first_name,s.last_name,s.omang,
              s.institution,s.sponsoring_body,s.programme,s.year_of_study
       FROM loans l JOIN students s ON l.student_id=s.id
       WHERE s.omang=? ORDER BY l.applied_at DESC LIMIT 1`,
      [omang.trim()]
    );

    if (!loan)
      return res.status(404).json({ error: 'No loan found for this ID number. Please check and try again, or contact us.' });

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
