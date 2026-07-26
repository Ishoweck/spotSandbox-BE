import 'dotenv/config';
import crypto from 'crypto';
import mongoose from 'mongoose';
import { Resend } from 'resend';

// Add ambassador emails here before running the script
const EMAILS = [
  'kayskidadenusi@gmail.com',
  'chiamakaaligo@gmail.com',
];

const FRONTEND_URL = 'https://vendorspotng.com';
const BACKEND_URL = 'https://vapp-be.onrender.com';
const LOGO_URL = `${BACKEND_URL}/logo.png`;

const emailLogo = `<img src="${LOGO_URL}" alt="VendorSpot" style="height:36px;display:block;" />`;

async function buildEmail(name: string, ambassadorCode: string, signupLink: string) {
  const firstName = name.split(' ')[0];
  return `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /></head>
<body style="margin:0;padding:0;background-color:#f4f4f4;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="100%" style="max-width:520px;background:#ffffff;border-radius:8px;border:1px solid #e5e7eb;overflow:hidden;" cellspacing="0" cellpadding="0" border="0">
          <tr><td style="padding:28px 32px 0 32px;">${emailLogo}</td></tr>
          <tr>
            <td style="padding:24px 32px 0 32px;">
              <div style="background:linear-gradient(135deg,#CC3366 0%,#99004d 100%);border-radius:10px;padding:28px 24px;text-align:center;">
                <p style="margin:0 0 6px 0;font-size:13px;font-weight:600;color:rgba(255,255,255,0.8);letter-spacing:1px;text-transform:uppercase;">You&rsquo;re In</p>
                <h1 style="margin:0;font-size:26px;font-weight:800;color:#ffffff;line-height:1.2;">Welcome to the<br/>Vendorspot Ambassador Program</h1>
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding:24px 32px 0 32px;">
              <p style="margin:0 0 14px 0;font-size:15px;color:#374151;">Hi ${firstName},</p>
              <p style="margin:0 0 14px 0;font-size:15px;color:#374151;line-height:1.6;">
                Congratulations! Your application to the Vendorspot Ambassador Program has been <strong style="color:#CC3366;">approved</strong>. We're thrilled to have you represent Vendorspot.
              </p>
              <p style="margin:0 0 20px 0;font-size:15px;color:#374151;line-height:1.6;">
                As an ambassador, you'll earn real commissions by inviting vendors and customers to the platform — and enjoy exclusive perks along the way.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:0 32px;">
              <div style="background:#f9fafb;border:2px dashed #CC3366;border-radius:10px;padding:20px 24px;text-align:center;">
                <p style="margin:0 0 6px 0;font-size:12px;font-weight:700;color:#CC3366;letter-spacing:1px;text-transform:uppercase;">Your Ambassador Code</p>
                <p style="margin:0;font-size:30px;font-weight:800;color:#111111;letter-spacing:3px;font-family:monospace;">${ambassadorCode}</p>
                <p style="margin:8px 0 0 0;font-size:12px;color:#9ca3af;">Share this code with vendors &amp; customers you refer</p>
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding:28px 32px;">
              <a href="${signupLink}" style="display:block;background:#CC3366;color:#ffffff;text-align:center;padding:15px 24px;border-radius:8px;font-size:16px;font-weight:700;text-decoration:none;">
                Complete Your Registration &rarr;
              </a>
              <p style="margin:12px 0 0 0;font-size:12px;color:#9ca3af;text-align:center;">This link expires in 48 hours</p>
            </td>
          </tr>
          <tr>
            <td style="padding:0 32px 28px 32px;border-top:1px solid #f3f4f6;">
              <p style="margin:16px 0 0 0;font-size:12px;color:#9ca3af;text-align:center;">
                &copy; ${new Date().getFullYear()} VendorSpot &bull; <a href="https://vendorspotng.com" style="color:#CC3366;text-decoration:none;">vendorspotng.com</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// Recursively retries until a unique code is found (collisions are extremely rare)
async function generateAmbassadorCode(AmbassadorModel: mongoose.Model<any>): Promise<string> {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // ambiguous chars (0, O, I, 1) excluded
  const suffix = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  const code = `AMB-${suffix}`;
  const exists = await AmbassadorModel.findOne({ ambassadorCode: code });
  if (exists) return generateAmbassadorCode(AmbassadorModel);
  return code;
}

async function main() {
  await mongoose.connect(process.env.MONGODB_URI!);
  console.log('Connected to MongoDB');

  const ambassadorSchema = new mongoose.Schema({}, { strict: false, collection: 'ambassadors' });
  const Ambassador = mongoose.models.Ambassador || mongoose.model('Ambassador', ambassadorSchema);

  const resend = new Resend(process.env.RESEND_API_KEY);

  for (const email of EMAILS) {
    let ambassador = await Ambassador.findOne({ email: email.toLowerCase() });

    if (!ambassador) {
      console.log(`No application found for ${email} — creating one...`);
      ambassador = await Ambassador.create({
        name: email.split('@')[0],
        email: email.toLowerCase(),
        status: 'approved',
        approvedAt: new Date(),
        ambassadorCode: await generateAmbassadorCode(Ambassador),
        createdAt: new Date(),
      });
    }

    if (!ambassador.ambassadorCode) {
      ambassador.ambassadorCode = await generateAmbassadorCode(Ambassador);
    }

    if (ambassador.status !== 'approved') {
      ambassador.status = 'approved';
      ambassador.approvedAt = new Date();
    }

    // Store hashed token in DB; send raw token in the link so we never expose the hash
    const rawToken = crypto.randomBytes(32).toString('hex');
    const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');
    ambassador.inviteToken = hashedToken;
    ambassador.inviteTokenExpires = new Date(Date.now() + 48 * 60 * 60 * 1000); // 48hr expiry
    await ambassador.save();

    const signupLink = `${FRONTEND_URL}/ambassador-signup?token=${rawToken}`;
    const html = await buildEmail(ambassador.name || email, ambassador.ambassadorCode, signupLink);

    const { error } = await resend.emails.send({
      from: 'VendorSpot <noreply@vendorspotng.com>',
      to: email,
      subject: '🎉 You\'re approved — Complete your Vendorspot Ambassador registration',
      html,
    });

    if (error) {
      console.error(`❌ Failed to send to ${email}:`, error);
    } else {
      console.log(`✅ Invite sent to ${email} | Code: ${ambassador.ambassadorCode}`);
    }
  }

  await mongoose.disconnect();
  console.log('Done.');
}

main().catch((e) => { console.error(e); process.exit(1); });
