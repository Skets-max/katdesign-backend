// Thin wrapper around nodemailer using a Gmail account + App Password.
// If GMAIL_USER / GMAIL_APP_PASSWORD aren't set, email sending is a no-op —
// the rest of the app must not depend on email actually working, since it's
// an optional extra layer, not a required one.

const GMAIL_USER = process.env.GMAIL_USER;
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;

const isConfigured = !!(GMAIL_USER && GMAIL_APP_PASSWORD);

let transporter = null;
if (isConfigured) {
  const nodemailer = require('nodemailer');
  transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD }
  });
} else {
  console.warn('⚠ GMAIL_USER / GMAIL_APP_PASSWORD not set — email sending is disabled. Applications will still work, just without the email-confirmation step.');
}

async function sendMail({ to, subject, html, text }) {
  if (!isConfigured) {
    console.log(`[mailer] (disabled) would have sent "${subject}" to ${to}`);
    return { sent: false, reason: 'not_configured' };
  }
  try {
    await transporter.sendMail({ from: `KatDesign Holdings <${GMAIL_USER}>`, to, subject, html, text });
    return { sent: true };
  } catch (err) {
    console.error('Email send failed:', err.message);
    return { sent: false, reason: err.message };
  }
}

module.exports = { sendMail, isConfigured };
