import nodemailer from 'nodemailer';

let transporter;

const getTransporter = () => {
  if (!process.env.SMTP_HOST || !process.env.EMAIL_FROM) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === 'true',
      ...(process.env.SMTP_USER && {
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD || '' },
      }),
      disableFileAccess: true,
      disableUrlAccess: true,
    });
  }
  return transporter;
};

export const sendEmail = async ({ to, subject, text, html }) => {
  const mailer = getTransporter();
  if (!mailer) return { sent: false, reason: 'smtp_not_configured' };
  const result = await mailer.sendMail({ from: process.env.EMAIL_FROM, to, subject, text, html });
  return { sent: true, messageId: result.messageId };
};

const escapeHtml = (value) =>
  String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);

export const sendInvitationEmail = ({ to, tenantName, inviterName, invitationUrl }) =>
  sendEmail({
    to,
    subject: `Join ${tenantName} on Kaspi Automation`,
    text: `${inviterName} invited you to join ${tenantName}. Accept the invitation: ${invitationUrl}`,
    html: `<p>${escapeHtml(inviterName)} invited you to join <strong>${escapeHtml(tenantName)}</strong>.</p><p><a href="${escapeHtml(invitationUrl)}">Accept invitation</a></p><p>This link expires in 7 days.</p>`,
  });

export const sendVerificationEmail = ({ to, displayName, verificationUrl }) =>
  sendEmail({
    to,
    subject: 'Verify your Kaspi Automation email',
    text: `Hello ${displayName}. Verify your email: ${verificationUrl}`,
    html: `<p>Hello ${escapeHtml(displayName)}.</p><p><a href="${escapeHtml(verificationUrl)}">Verify your email</a></p><p>This link expires in 24 hours.</p>`,
  });

export const sendPasswordResetEmail = ({ to, displayName, resetUrl }) =>
  sendEmail({
    to,
    subject: 'Reset your Kaspi Automation password',
    text: `Hello ${displayName}. Reset your password: ${resetUrl}`,
    html: `<p>Hello ${escapeHtml(displayName)}.</p><p><a href="${escapeHtml(resetUrl)}">Reset your password</a></p><p>This link expires in 30 minutes. Ignore this message if you did not request it.</p>`,
  });
