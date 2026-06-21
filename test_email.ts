import * as nodemailer from 'nodemailer';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '.env') });

async function main() {
  const host = process.env.SMTP_HOST;
  const port = process.env.SMTP_PORT;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM || 'no-reply@novahire.com';

  console.log('SMTP Config:', { host, port, user, pass: pass ? '***' : null, from });

  if (!host || !user || !pass) {
    console.error('Missing SMTP credentials in .env');
    return;
  }

  const transporter = nodemailer.createTransport({
    host,
    port: parseInt(port || '587'),
    secure: port === '465',
    auth: { user, pass },
    debug: true,
    logger: true
  });

  try {
    console.log('Sending test email...');
    const info = await transporter.sendMail({
      from: `"NovaHire AI Test" <${from}>`,
      to: 'yashureddy076@gmail.com',
      subject: 'Test SMTP Connection',
      text: 'This is a test email to verify the SMTP connection.',
      html: '<p>This is a test email to verify the SMTP connection.</p>'
    });
    console.log('Email sent successfully!');
    console.log('Message ID:', info.messageId);
    console.log('Envelope:', info.envelope);
    console.log('Response:', info.response);
  } catch (error) {
    console.error('Failed to send email:', error);
  }
}

main();
