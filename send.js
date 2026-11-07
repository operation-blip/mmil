import nodemailer from 'nodemailer';
import crypto from 'crypto';

function randomString(length = 8, type = 'alnum') {
  let chars = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  if (type === 'num') chars = '0123456789';
  if (type === 'alpha') chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let res = '';
  for (let i = 0; i < length; i++) {
    res += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return res;
}

function replaceMacros(text = '', email = '') {
  const parts = email.split('@');
  const user = parts[0] || '';
  const domain = parts[1] || '';
  return text
    .replaceAll('[-email-]', email)
    .replaceAll('[-user-]', user)
    .replaceAll('[-domain-]', domain)
    .replaceAll('[-time-]', new Date().toISOString().replace('T', ' ').substring(0, 19))
    .replaceAll('[-randomnumber-]', randomString(6, 'num'))
    .replaceAll('[-randomletters-]', randomString(8, 'alpha'))
    .replaceAll('[-randomstring-]', randomString(10, 'alnum'))
    .replaceAll('[-randommd5-]', crypto.randomBytes(16).toString('hex'));
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const {
    to,
    senderEmail,
    senderName,
    replyTo,
    subject,
    letter,
    letterType,
    priority,
    attachmentName,
    attachmentData,
    engine,
    gasUrl,
    smtpHost,
    smtpPort,
    smtpUser,
    smtpPass
  } = req.body;

  if (!to || !subject || !letter) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const finalSubject = replaceMacros(subject, to);
  const finalLetter = replaceMacros(letter, to);
  const finalSenderName = replaceMacros(senderName || 'Support', to);
  const finalSenderEmail = senderEmail || smtpUser || 'noreply@vercel.app';

  try {
    // Engine 1: Google Relay (Works on Vercel without SMTP credentials)
    if (engine === 'gas' || (!smtpUser && (gasUrl || process.env.GAS_WEBHOOK_URL))) {
      const targetUrl = gasUrl || process.env.GAS_WEBHOOK_URL;
      if (!targetUrl) {
        return res.status(400).json({ error: 'ضع رابط Google Script في خانة Relay URL أعلى اللوحة (أو اختر Direct / SMTP)' });
      }
      const resp = await fetch(targetUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: to.trim(),
          subject: finalSubject,
          html: finalLetter,
          senderName: finalSenderName,
          replyTo: replyTo || ''
        })
      });
      if (!resp.ok) throw new Error('Relay returned error');
      return res.status(200).json({ ok: true });
    }

    // Engine 2: Direct MX Mode (No SMTP account, connects directly to recipient MX like PHP mail)
    // Or Custom SMTP if provided
    let transporter;
    if (engine === 'smtp' || smtpUser || process.env.SMTP_USER) {
      const u = smtpUser || process.env.SMTP_USER;
      const p = smtpPass || process.env.SMTP_PASS;
      const h = smtpHost || process.env.SMTP_HOST || 'smtp.gmail.com';
      const port = Number(smtpPort || process.env.SMTP_PORT || 465);
      transporter = nodemailer.createTransport({
        host: h,
        port,
        secure: port === 465,
        auth: { user: u, pass: p }
      });
    } else {
      // Direct mode (no SMTP login)
      const domain = finalSenderEmail.split('@')[1] || 'vercel.app';
      transporter = nodemailer.createTransport({
        direct: true,
        name: domain
      });
    }

    const mailOptions = {
      from: `"${finalSenderName}" <${finalSenderEmail}>`,
      to: to.trim(),
      subject: finalSubject,
      replyTo: replyTo || undefined,
      priority: priority === '1' ? 'high' : priority === '5' ? 'low' : 'normal'
    };

    if (letterType === 'plain') {
      mailOptions.text = finalLetter;
    } else {
      mailOptions.html = finalLetter;
    }

    if (attachmentName && attachmentData) {
      const base64Content = attachmentData.includes(',')
        ? attachmentData.split(',')[1]
        : attachmentData;
      mailOptions.attachments = [
        {
          filename: attachmentName,
          content: base64Content,
          encoding: 'base64'
        }
      ];
    }

    await transporter.sendMail(mailOptions);
    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}
