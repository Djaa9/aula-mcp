import nodemailer from 'nodemailer';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

/** Proton SMTP submission: SMTP_USER is the custom-domain address the token was made for. */
export async function sendEmail(subject: string, html: string): Promise<void> {
  const transport = nodemailer.createTransport({
    host: 'smtp.protonmail.ch',
    port: 587,
    requireTLS: true,
    auth: { user: required('SMTP_USER'), pass: required('SMTP_TOKEN') },
  });
  try {
    await transport.sendMail({
      from: required('DIGEST_FROM'),
      to: required('DIGEST_TO')
        .split(',')
        .map((s) => s.trim()),
      subject,
      html,
    });
  } finally {
    transport.close();
  }
}
