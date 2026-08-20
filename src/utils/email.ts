import { Resend } from 'resend';
import { logger } from './logger';
import { isAutomatedContext } from './email-context';

import dotenv from "dotenv"

dotenv.config()

const resend = new Resend(process.env.RESEND_API_KEY);

// Vendorspot logo served from the backend's public/ folder
const LOGO_URL = `${process.env.BACKEND_URL || 'https://vapp-be.onrender.com'}/logo.png`;

// Shared logo HTML used in all email headers
const emailLogo = `
  <table role="presentation" cellspacing="0" cellpadding="0" border="0">
    <tr>
      <td style="vertical-align:middle;padding-right:10px;">
        <img src="${LOGO_URL}" alt="Vendorspot" width="38" height="38" style="display:block;width:38px;height:38px;" />
      </td>
      <td style="vertical-align:middle;">
        <span style="font-size:22px;font-weight:800;color:#111111;letter-spacing:-0.5px;">Vendorspot</span>
      </td>
    </tr>
  </table>`;

type EmailAudience = 'vendor' | 'customer' | 'admin' | 'ambassador';

function footerLineFor(audience: EmailAudience): string {
  switch (audience) {
    case 'customer':   return "You're receiving this email because you have a Vendorspot account.";
    case 'admin':      return "You're receiving this email because you're an administrator on Vendorspot.";
    case 'ambassador': return "You're receiving this email because you're a Vendorspot ambassador.";
    case 'vendor':
    default:           return "You're receiving this email because you're a vendor on Vendorspot.";
  }
}

function wrapEmail(titleText: string, bodyHtml: string, audience: EmailAudience = 'vendor'): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
</head>
<body style="margin:0;padding:0;background-color:#f4f4f4;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="100%" style="max-width:520px;background:#ffffff;border-radius:8px;border:1px solid #e5e7eb;overflow:hidden;" cellspacing="0" cellpadding="0" border="0">

          <tr>
            <td style="padding:28px 32px 0 32px;">
              ${emailLogo}
            </td>
          </tr>

          <tr>
            <td style="padding:24px 32px 0 32px;">
              <h1 style="margin:0;font-size:24px;font-weight:700;color:#111111;line-height:1.3;">${titleText}</h1>
            </td>
          </tr>

          <tr>
            <td style="padding:20px 32px 0 32px;">
              <hr style="border:none;border-top:1px solid #e5e7eb;margin:0;" />
            </td>
          </tr>

          <tr>
            <td style="padding:24px 32px 0 32px;">
              ${bodyHtml}
            </td>
          </tr>

          <tr>
            <td style="padding:24px 32px 0 32px;">
              <hr style="border:none;border-top:1px solid #e5e7eb;margin:0;" />
            </td>
          </tr>

          <tr>
            <td style="padding:20px 32px;">
              <p style="margin:0 0 6px 0;font-size:13px;color:#6b7280;">
                Need help? <a href="mailto:support@vendorspotng.com" style="color:#CC3366;text-decoration:none;">support@vendorspotng.com</a>
              </p>
              <p style="margin:0;font-size:13px;color:#374151;">
                <strong>Vendorspot</strong> — Confidence in every click.
              </p>
            </td>
          </tr>

          <tr>
            <td style="padding:0 32px 24px 32px;">
              <p style="margin:0;font-size:11px;color:#9ca3af;line-height:1.6;">
                ${footerLineFor(audience)}<br />
                &copy; ${new Date().getFullYear()} Vendorspot (TheSpot) Ltd. All rights reserved.
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

interface EmailOptions {
  to: string;
  subject: string;
  text?: string;
  html?: string;
  attachments?: Array<{ filename: string; content: Buffer }>;
  /** Skip the audit BCC (rarely needed — e.g. an email TO the audit inbox itself). */
  skipAudit?: boolean;
}

// Automated/scheduled emails are BCC'd to the audit inbox for an internal audit trail.
// Transactional emails (OTP, welcome, order confirmations) are NOT audited.
// The "automated" flag is set by the email worker via AsyncLocalStorage — see email-context.ts.
// Override the address with EMAIL_AUDIT_BCC in .env; set to empty string to disable entirely.
const AUDIT_BCC = process.env.EMAIL_AUDIT_BCC ?? 'support@vendorspotng.com';

export const sendEmail = async (options: EmailOptions): Promise<void> => {
  try {
    const payload: any = {
      from: process.env.EMAIL_FROM || 'VendorSpot <noreply@vendorspotng.com>',
      to: options.to,
      subject: options.subject,
      text: options.text,
      html: options.html,
      attachments: options.attachments,
    };

    // Audit BCC — only when the send happens inside the email worker (automated context).
    // Skipped when: (a) not in an automated context, (b) recipient IS the audit inbox,
    // (c) caller explicitly opts out via skipAudit.
    const shouldAudit =
      AUDIT_BCC &&
      isAutomatedContext() &&
      !options.skipAudit &&
      options.to.toLowerCase() !== AUDIT_BCC.toLowerCase();

    if (shouldAudit) {
      payload.bcc = AUDIT_BCC;
    }

    const { data, error } = await resend.emails.send(payload);

    if (error) {
      logger.error('Resend error:', error);
      throw new Error(`Failed to send email: ${error.message}`);
    }

    logger.info(`Email sent to ${options.to}`, { emailId: data?.id, audited: !!payload.bcc });
  } catch (error) {
    logger.error('Email sending error:', error);
    throw new Error('Failed to send email');
  }
};

export const sendOTPEmail = async (email: string, otp: string, name?: string): Promise<void> => {
  const displayName = name || 'there';
  const formattedOtp = `${otp.slice(0, 3)} ${otp.slice(3)}`;

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
</head>
<body style="margin:0;padding:0;background-color:#f4f4f4;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="100%" style="max-width:520px;background:#ffffff;border-radius:8px;border:1px solid #e5e7eb;overflow:hidden;" cellspacing="0" cellpadding="0" border="0">

          <!-- Logo -->
          <tr>
            <td style="padding:28px 32px 0 32px;">
              ${emailLogo}
            </td>
          </tr>

          <!-- Title -->
          <tr>
            <td style="padding:24px 32px 0 32px;">
              <h1 style="margin:0;font-size:24px;font-weight:700;color:#111111;line-height:1.3;">OTP / Email Verification</h1>
            </td>
          </tr>

          <!-- Divider -->
          <tr>
            <td style="padding:20px 32px 0 32px;">
              <hr style="border:none;border-top:1px solid #e5e7eb;margin:0;" />
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:24px 32px 0 32px;">
              <p style="margin:0 0 16px 0;font-size:15px;color:#374151;">Hello ${displayName},</p>
              <p style="margin:0 0 12px 0;font-size:15px;color:#374151;line-height:1.6;">
                Welcome to Vendorspot. We are excited to have you as part of our trust system!
              </p>
              <p style="margin:0;font-size:15px;color:#374151;line-height:1.6;">
                To continue with your account, use this code to verify your email address.
              </p>
            </td>
          </tr>

          <!-- OTP Box -->
          <tr>
            <td style="padding:24px 32px 0 32px;">
              <div style="background:#f3f4f6;border-radius:8px;padding:20px;text-align:center;">
                <span style="font-size:36px;font-weight:800;color:#CC3366;letter-spacing:6px;">${formattedOtp}</span>
              </div>
              <p style="margin:10px 0 0 0;font-size:12px;color:#9ca3af;text-align:center;">
                This code expires in 10 minutes and is valid for one use only
              </p>
            </td>
          </tr>

          <!-- Ignore notice -->
          <tr>
            <td style="padding:24px 32px 0 32px;">
              <p style="margin:0 0 8px 0;font-size:14px;color:#374151;">If you didn't request this, please ignore this email.</p>
              <p style="margin:0;font-size:14px;color:#374151;font-weight:600;">Stay protected.</p>
            </td>
          </tr>

          <!-- Divider -->
          <tr>
            <td style="padding:24px 32px 0 32px;">
              <hr style="border:none;border-top:1px solid #e5e7eb;margin:0;" />
            </td>
          </tr>

          <!-- Support footer -->
          <tr>
            <td style="padding:20px 32px;">
              <p style="margin:0 0 6px 0;font-size:13px;color:#6b7280;">
                Need help? <a href="mailto:support@vendorspotng.com" style="color:#CC3366;text-decoration:none;">support@vendorspotng.com</a>
              </p>
              <p style="margin:0;font-size:13px;color:#374151;">
                <strong>Vendorspot</strong> — Confidence in every click.
              </p>
            </td>
          </tr>

          <!-- Legal footer -->
          <tr>
            <td style="padding:0 32px 24px 32px;">
              <p style="margin:0;font-size:11px;color:#9ca3af;line-height:1.6;">
                You're receiving this email because you created a Vendorspot account.<br />
                &copy; ${new Date().getFullYear()} Vendorspot (TheSpot) Ltd. All rights reserved.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;

  await sendEmail({
    to: email,
    subject: 'VendorSpot - Email Verification',
    html,
  });
};

export const sendPasswordResetEmail = async (email: string, resetCode: string, name?: string): Promise<void> => {
  const displayName = name || 'there';
  const frontendUrl = process.env.FRONTEND_URL || 'https://vendorspotng.com';
  const resetLink = `${frontendUrl}/reset-password?code=${resetCode}`;

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
</head>
<body style="margin:0;padding:0;background-color:#f4f4f4;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="100%" style="max-width:520px;background:#ffffff;border-radius:8px;border:1px solid #e5e7eb;overflow:hidden;" cellspacing="0" cellpadding="0" border="0">

          <!-- Logo -->
          <tr>
            <td style="padding:28px 32px 0 32px;">
              ${emailLogo}
            </td>
          </tr>

          <!-- Title -->
          <tr>
            <td style="padding:24px 32px 0 32px;">
              <h1 style="margin:0;font-size:24px;font-weight:700;color:#111111;line-height:1.3;">Reset your Vendorspot password</h1>
            </td>
          </tr>

          <!-- Divider -->
          <tr>
            <td style="padding:20px 32px 0 32px;">
              <hr style="border:none;border-top:1px solid #e5e7eb;margin:0;" />
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:24px 32px 0 32px;">
              <p style="margin:0 0 16px 0;font-size:15px;color:#374151;">Hello ${displayName},</p>
              <p style="margin:0 0 12px 0;font-size:15px;color:#374151;line-height:1.6;">
                We received a request to reset the password for your Vendorspot account linked to this email address.
              </p>
              <p style="margin:0 0 16px 0;font-size:15px;color:#374151;line-height:1.6;">
                Click the button below to create a new password:
              </p>

              <!-- Reset link -->
              <a href="${resetLink}" style="display:block;color:#CC3366;font-size:14px;font-weight:600;word-break:break-all;text-decoration:none;margin-bottom:8px;">${resetLink}</a>
              <p style="margin:0 0 20px 0;font-size:12px;color:#9ca3af;">
                This link is valid for 1 hour and can only be used once.
              </p>

              <p style="margin:0;font-size:14px;color:#374151;line-height:1.7;">
                If you did not request this reset, please ignore this email, your password and account remain unchanged.
                If you suspect unusual activity, contact us immediately.
              </p>
            </td>
          </tr>

          <!-- Divider -->
          <tr>
            <td style="padding:24px 32px 0 32px;">
              <hr style="border:none;border-top:1px solid #e5e7eb;margin:0;" />
            </td>
          </tr>

          <!-- Support footer -->
          <tr>
            <td style="padding:20px 32px;">
              <p style="margin:0 0 6px 0;font-size:13px;color:#6b7280;">
                Need help? <a href="mailto:support@vendorspotng.com" style="color:#CC3366;text-decoration:none;">support@vendorspotng.com</a>
              </p>
              <p style="margin:0;font-size:13px;color:#374151;">
                <strong>Vendorspot</strong> — Confidence in every click.
              </p>
            </td>
          </tr>

          <!-- Legal footer -->
          <tr>
            <td style="padding:0 32px 24px 32px;">
              <p style="margin:0;font-size:11px;color:#9ca3af;line-height:1.6;">
                You're receiving this email because you created a Vendorspot account.<br />
                &copy; ${new Date().getFullYear()} Vendorspot (TheSpot) Ltd. All rights reserved.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;

  await sendEmail({
    to: email,
    subject: 'Reset your Vendorspot password',
    html,
  });
};

export const sendWelcomeEmail = async (email: string, name: string): Promise<void> => {
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #ff6600;">Welcome to VendorSpot!</h2>
      <p>Hi ${name},</p>
      <p>Thank you for joining VendorSpot - your one-stop marketplace for everything!</p>
      <p>Get started by:</p>
      <ul>
        <li>Browsing our products</li>
        <li>Setting up your profile</li>
        <li>Becoming a vendor or affiliate</li>
      </ul>
      <p>Happy shopping!</p>
    </div>
  `;

  await sendEmail({
    to: email,
    subject: 'Welcome to VendorSpot!',
    html,
  });
};

interface OrderEmailItem {
  productName: string;
  productImage: string;
  quantity: number;
  price: number;
  vendorName?: string;
}

export const sendOrderConfirmationEmail = async (
  email: string,
  orderNumber: string,
  total: number,
  name?: string,
  items?: OrderEmailItem[],
  receiptPdf?: Buffer,
): Promise<void> => {
  const displayName = name || 'there';
  const frontendUrl = process.env.FRONTEND_URL || 'https://vendorspotng.com';
  const orderUrl = `${frontendUrl}/orders/${orderNumber}`;

  // Unique vendor names for summary
  const vendorNames = [...new Set((items || []).map((i) => i.vendorName).filter(Boolean))];
  const vendorLine = vendorNames.length > 0 ? vendorNames.join(', ') : null;

  const itemRowsHtml = (items || []).map((item) => `
    <tr>
      <td style="padding:10px 0;border-bottom:1px solid #f3f4f6;vertical-align:middle;">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
          <tr>
            <td style="width:72px;vertical-align:middle;padding-right:14px;">
              <img
                src="${item.productImage}"
                alt="${item.productName}"
                width="72"
                height="72"
                style="display:block;border-radius:8px;object-fit:cover;width:72px;height:72px;background:#f3f4f6;"
              />
            </td>
            <td style="vertical-align:middle;">
              <p style="margin:0 0 4px 0;font-size:14px;font-weight:600;color:#111111;">${item.productName}</p>
              <p style="margin:0;font-size:12px;color:#6b7280;">Qty: ${item.quantity}</p>
            </td>
            <td style="vertical-align:middle;text-align:right;white-space:nowrap;">
              <p style="margin:0;font-size:14px;font-weight:600;color:#111111;">₦${(item.price * item.quantity).toLocaleString()}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  `).join('');

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
</head>
<body style="margin:0;padding:0;background-color:#f4f4f4;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="100%" style="max-width:520px;background:#ffffff;border-radius:8px;border:1px solid #e5e7eb;overflow:hidden;" cellspacing="0" cellpadding="0" border="0">

          <!-- Logo -->
          <tr>
            <td style="padding:28px 32px 0 32px;">
              ${emailLogo}
            </td>
          </tr>

          <!-- Title -->
          <tr>
            <td style="padding:24px 32px 0 32px;">
              <h1 style="margin:0;font-size:24px;font-weight:700;color:#111111;line-height:1.3;">Order confirmed</h1>
            </td>
          </tr>

          <!-- Greeting & message -->
          <tr>
            <td style="padding:20px 32px 0 32px;">
              <p style="margin:0 0 12px 0;font-size:15px;color:#374151;">Hi ${displayName},</p>
              <p style="margin:0;font-size:15px;color:#374151;line-height:1.6;">
                Thank you for purchasing and trusting Vendorspot. Your payment is now held safely until you receive and complete your order.
              </p>
            </td>
          </tr>

          ${items && items.length > 0 ? `
          <!-- Product images & items -->
          <tr>
            <td style="padding:20px 32px 0 32px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                ${itemRowsHtml}
              </table>
            </td>
          </tr>
          ` : ''}

          <!-- Order Summary box -->
          <tr>
            <td style="padding:20px 32px 0 32px;">
              <div style="background:#f9fafb;border-radius:8px;padding:16px 20px;">
                <p style="margin:0 0 10px 0;font-size:12px;font-weight:700;color:#111111;letter-spacing:0.5px;text-transform:uppercase;">Order Summary</p>
                <p style="margin:0 0 6px 0;font-size:14px;color:#374151;">
                  <span style="color:#6b7280;">Order number:</span>&nbsp;&nbsp;<strong>#${orderNumber}</strong>
                </p>
                ${items && items.length === 1 ? `
                <p style="margin:0 0 6px 0;font-size:14px;color:#374151;">
                  <span style="color:#6b7280;">Item:</span>&nbsp;&nbsp;<strong>${items[0].productName}</strong>
                </p>
                ` : items && items.length > 1 ? `
                <p style="margin:0 0 6px 0;font-size:14px;color:#374151;">
                  <span style="color:#6b7280;">Items:</span>&nbsp;&nbsp;<strong>${items.length} items</strong>
                </p>
                ` : ''}
                <p style="margin:0 0 6px 0;font-size:14px;color:#374151;">
                  <span style="color:#6b7280;">Total:</span>&nbsp;&nbsp;<strong>₦${total.toLocaleString()}</strong>
                </p>
                ${vendorLine ? `
                <p style="margin:0;font-size:14px;color:#374151;">
                  <span style="color:#6b7280;">Vendor:</span>&nbsp;&nbsp;<strong>${vendorLine}</strong>
                </p>
                ` : ''}
              </div>
            </td>
          </tr>

          <!-- Ships message & CTA -->
          <tr>
            <td style="padding:24px 32px 0 32px;">
              <p style="margin:0 0 20px 0;font-size:14px;color:#374151;">We will send you another email when your order ships.</p>
              <a href="${orderUrl}"
                style="display:inline-block;background-color:#CC3366;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;padding:12px 28px;border-radius:6px;">
                View Order
              </a>
            </td>
          </tr>

          <!-- Divider -->
          <tr>
            <td style="padding:28px 32px 0 32px;">
              <hr style="border:none;border-top:1px solid #e5e7eb;margin:0;" />
            </td>
          </tr>

          <!-- Support footer -->
          <tr>
            <td style="padding:20px 32px;">
              <p style="margin:0 0 6px 0;font-size:13px;color:#6b7280;">
                Need help? <a href="mailto:support@vendorspotng.com" style="color:#CC3366;text-decoration:none;">support@vendorspotng.com</a>
              </p>
              <p style="margin:0;font-size:13px;color:#374151;">
                <strong>Vendorspot</strong> — Confidence in every click.
              </p>
            </td>
          </tr>

          <!-- Legal footer -->
          <tr>
            <td style="padding:0 32px 24px 32px;">
              <p style="margin:0;font-size:11px;color:#9ca3af;line-height:1.6;">
                You're receiving this email because you created a Vendorspot account.<br />
                &copy; ${new Date().getFullYear()} Vendorspot (TheSpot) Ltd. All rights reserved.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;

  await sendEmail({
    to: email,
    subject: `Order Confirmed - #${orderNumber}`,
    html,
    ...(receiptPdf ? {
      attachments: [{ filename: `receipt-${orderNumber}.pdf`, content: receiptPdf }],
    } : {}),
  });
};

export const sendVendorWelcomeEmail = async (email: string, firstName?: string): Promise<void> => {
  const displayName = firstName || 'there';
  const frontendUrl = process.env.FRONTEND_URL || 'https://vendorspotng.com';
  const dashboardLink = `${frontendUrl}/dashboard`;

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
</head>
<body style="margin:0;padding:0;background-color:#f4f4f4;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="100%" style="max-width:520px;background:#ffffff;border-radius:8px;border:1px solid #e5e7eb;overflow:hidden;" cellspacing="0" cellpadding="0" border="0">

          <!-- Logo -->
          <tr>
            <td style="padding:28px 32px 0 32px;">
              ${emailLogo}
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:28px 32px 0 32px;">
              <p style="margin:0 0 16px 0;font-size:15px;color:#374151;">Hi ${displayName},</p>
              <p style="margin:0 0 14px 0;font-size:15px;color:#374151;line-height:1.6;">Congratulations, your Vendorspot storefront is now active.</p>
              <p style="margin:0 0 20px 0;font-size:15px;color:#374151;line-height:1.6;">You're joining a marketplace built on trust, where buyers shop with full confidence because every payment is held safely until delivery is confirmed. This means more buyers, fewer disputes, and a platform that works for you and helps you build credibility.</p>
              <p style="margin:0 0 12px 0;font-size:15px;font-weight:700;color:#111111;">Here's what you get as a Vendorspot vendor:</p>
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-bottom:20px;">
                ${['Safe and fast payouts after a completed order.','A public Trust Score that helps you grow','Rewards when you hit sales milestones','Priority visibility as your Trust Score rises','Dedicated vendor support when you need it'].map((item) => `<tr><td style="padding:3px 0;font-size:14px;color:#374151;line-height:1.6;"><span style="color:#CC3366;margin-right:8px;">&#10003;</span>${item}</td></tr>`).join('')}
              </table>
              <p style="margin:0 0 16px 0;font-size:15px;color:#374151;line-height:1.6;">Your next step: complete your KYC, add your first listing, and start selling.</p>
              <p style="margin:0 0 20px 0;font-size:15px;">
                <span style="color:#CC3366;margin-right:6px;">&#8594;</span>
                <a href="${dashboardLink}" style="color:#CC3366;font-weight:600;text-decoration:none;">${dashboardLink}</a>
              </p>
              <p style="margin:0 0 10px 0;font-size:15px;font-weight:700;color:#111111;">Quick start guides:</p>
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-bottom:20px;">
                <tr>
                  <td style="padding:4px 0;font-size:14px;color:#374151;line-height:1.6;">
                    <span style="color:#CC3366;margin-right:8px;">&#9654;</span>
                    <a href="https://youtube.com/shorts/K9XQcO7syTY?feature=share" style="color:#CC3366;text-decoration:none;font-weight:600;">How to create your storefront on Vendorspot</a>
                  </td>
                </tr>
                <tr>
                  <td style="padding:4px 0;font-size:14px;color:#374151;line-height:1.6;">
                    <span style="color:#CC3366;margin-right:8px;">&#9654;</span>
                    <a href="https://youtu.be/gVgJkesq1_0" style="color:#CC3366;text-decoration:none;font-weight:600;">How to post your products</a>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 20px 0;font-size:15px;color:#374151;line-height:1.6;">The stronger your Trust Score, the more buyers will choose you. Every on-time delivery, every satisfied customer, and every quick response builds your reputation on Vendorspot.</p>
              <p style="margin:0 0 4px 0;font-size:15px;color:#374151;">Let's grow together,</p>
              <p style="margin:0 0 28px 0;font-size:15px;color:#374151;font-weight:600;">The Vendorspot Team</p>
            </td>
          </tr>

          <!-- Divider -->
          <tr><td style="padding:0 32px;"><hr style="border:none;border-top:1px solid #e5e7eb;margin:0;" /></td></tr>

          <!-- Support footer -->
          <tr>
            <td style="padding:20px 32px;">
              <p style="margin:0 0 6px 0;font-size:13px;color:#6b7280;">Need help? <a href="mailto:support@vendorspotng.com" style="color:#CC3366;text-decoration:none;">support@vendorspotng.com</a></p>
              <p style="margin:0;font-size:13px;color:#374151;"><strong>Vendorspot</strong> — Confidence in every click.</p>
            </td>
          </tr>

          <!-- Legal footer -->
          <tr>
            <td style="padding:0 32px 24px 32px;">
              <p style="margin:0;font-size:11px;color:#9ca3af;line-height:1.6;">
                You're receiving this email because you created a Vendorspot account.<br />
                &copy; ${new Date().getFullYear()} Vendorspot (TheSpot) Ltd. All rights reserved.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;

  await sendEmail({
    to: email,
    subject: 'Your Vendorspot storefront is now active',
    html,
  });
};

// Sent by admins for vendors whose automated NIN verification (Dojah)
// couldn't complete — asks them to upload their NIN manually via the
// store profile / KYC screen. Admin triggers this from the vendor detail
// modal when they see an orphan / rejected NIN document.
export const sendNinReuploadRequestEmail = async (
  email: string,
  firstName?: string,
): Promise<void> => {
  const displayName = firstName || 'there';
  const frontendUrl = process.env.FRONTEND_URL || 'https://vendorspotng.com';
  const kycLink = `${frontendUrl}/vendor/kyc`;

  const html = `
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
            <td style="padding:28px 32px 0 32px;">
              <p style="margin:0 0 16px 0;font-size:15px;color:#374151;">Hi ${displayName},</p>
              <p style="margin:0 0 14px 0;font-size:15px;color:#374151;line-height:1.6;">We tried to verify your NIN automatically, but couldn't complete the check. To finish setting up your vendor account, please upload a clear photo of your NIN slip or card.</p>
              <p style="margin:0 0 20px 0;font-size:15px;color:#374151;line-height:1.6;">
                <strong>How to upload:</strong> open your Vendorspot app or dashboard, go to your store profile, tap <strong>KYC Verification</strong>, then upload your NIN document.
              </p>
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 24px 0;">
                <tr>
                  <td style="background:#CC3366;border-radius:8px;">
                    <a href="${kycLink}" style="display:inline-block;padding:12px 24px;font-size:14px;font-weight:700;color:#ffffff;text-decoration:none;">Upload NIN document</a>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 16px 0;font-size:14px;color:#6b7280;line-height:1.6;">Once uploaded, our team will review it and activate your storefront within 24 hours.</p>
              <p style="margin:0 0 4px 0;font-size:15px;color:#374151;">Thank you,</p>
              <p style="margin:0 0 28px 0;font-size:15px;color:#374151;font-weight:600;">The Vendorspot Team</p>
            </td>
          </tr>
          <tr><td style="padding:0 32px;"><hr style="border:none;border-top:1px solid #e5e7eb;margin:0;" /></td></tr>
          <tr>
            <td style="padding:20px 32px;">
              <p style="margin:0 0 6px 0;font-size:13px;color:#6b7280;">Need help? <a href="mailto:support@vendorspotng.com" style="color:#CC3366;text-decoration:none;">support@vendorspotng.com</a></p>
              <p style="margin:0;font-size:13px;color:#374151;"><strong>Vendorspot</strong> — Confidence in every click.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:0 32px 24px 32px;">
              <p style="margin:0;font-size:11px;color:#9ca3af;line-height:1.6;">
                You're receiving this email because your Vendorspot account needs additional verification.<br />
                &copy; ${new Date().getFullYear()} Vendorspot (TheSpot) Ltd. All rights reserved.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;

  await sendEmail({
    to: email,
    subject: 'Action needed — upload your NIN to activate your Vendorspot storefront',
    html,
  });
};

export const sendFounderWelcomeEmail = async (email: string, firstName?: string): Promise<void> => {
  const frontendUrl = process.env.FRONTEND_URL || 'https://vendorspotng.com';
  const ceoPhotoUrl = `${frontendUrl}/team/ceo.png`;

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
</head>
<body style="margin:0;padding:0;background-color:#f4f4f4;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="100%" style="max-width:520px;background:#ffffff;border-radius:8px;border:1px solid #e5e7eb;overflow:hidden;" cellspacing="0" cellpadding="0" border="0">

          <!-- Logo -->
          <tr>
            <td style="padding:28px 32px 0 32px;">
              ${emailLogo}
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:28px 32px 0 32px;">
              <h2 style="margin:0 0 20px 0;font-size:20px;font-weight:700;color:#111111;line-height:1.3;">
                Hello and welcome to Vendorspot,
              </h2>

              <p style="margin:0 0 16px 0;font-size:15px;color:#374151;line-height:1.7;">
                I'm personally excited to have you onboard as a vendor. Thank you for creating your store and trusting Vendorspot as a platform to grow your business.
              </p>

              <p style="margin:0 0 16px 0;font-size:15px;color:#374151;line-height:1.7;">
                Vendorspot was built to help businesses like yours sell with confidence, reach the right customers, build credibility, and operate in a safer, more structured online marketplace. Our team is committed to supporting you every step of the way.
              </p>

              <p style="margin:0 0 16px 0;font-size:15px;color:#374151;line-height:1.7;">
                Keep listing your products, share your store link, and stay active on the platform to unlock more visibility and opportunities.
              </p>

              <p style="margin:0 0 24px 0;font-size:15px;color:#374151;line-height:1.7;">
                We're glad to have you here, and we look forward to growing together.
              </p>

              <p style="margin:0 0 16px 0;font-size:15px;color:#374151;">Warm regards,</p>

              <!-- Founder signature -->
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin-bottom:28px;">
                <tr>
                  <td style="vertical-align:middle;padding-right:14px;">
                    <img
                      src="${ceoPhotoUrl}"
                      alt="Olayinka Olasunkanmi"
                      width="52"
                      height="52"
                      style="display:block;width:52px;height:52px;border-radius:50%;object-fit:cover;background:#f3f4f6;"
                    />
                  </td>
                  <td style="vertical-align:middle;">
                    <p style="margin:0 0 2px 0;font-size:14px;font-weight:700;color:#111111;">Olayinka Olasunkanmi</p>
                    <p style="margin:0;font-size:13px;color:#6b7280;">Founder, Vendorspot</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Divider -->
          <tr>
            <td style="padding:0 32px;">
              <hr style="border:none;border-top:1px solid #e5e7eb;margin:0;" />
            </td>
          </tr>

          <!-- Support footer -->
          <tr>
            <td style="padding:20px 32px;">
              <p style="margin:0 0 6px 0;font-size:13px;color:#6b7280;">
                Need help? <a href="mailto:support@vendorspotng.com" style="color:#CC3366;text-decoration:none;">support@vendorspotng.com</a>
              </p>
              <p style="margin:0;font-size:13px;color:#374151;">
                <strong>Vendorspot</strong> — Confidence in every click.
              </p>
            </td>
          </tr>

          <!-- Legal footer -->
          <tr>
            <td style="padding:0 32px 24px 32px;">
              <p style="margin:0;font-size:11px;color:#9ca3af;line-height:1.6;">
                You're receiving this email because you created a Vendorspot account.<br />
                &copy; ${new Date().getFullYear()} Vendorspot (TheSpot) Ltd. All rights reserved.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;

  await sendEmail({
    to: email,
    subject: 'A personal welcome from our Founder',
    html,
  });
};

export const sendBuyerFounderWelcomeEmail = async (email: string, firstName: string): Promise<void> => {
  const frontendUrl = process.env.FRONTEND_URL || 'https://vendorspotng.com';
  const shopLink = `${frontendUrl}/products`;

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
</head>
<body style="margin:0;padding:0;background-color:#f4f4f4;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="100%" style="max-width:520px;background:#ffffff;border-radius:8px;border:1px solid #e5e7eb;overflow:hidden;" cellspacing="0" cellpadding="0" border="0">

          <!-- Logo -->
          <tr>
            <td style="padding:28px 32px 0 32px;">
              ${emailLogo}
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:28px 32px 0 32px;">
              <p style="margin:0 0 16px 0;font-size:15px;color:#374151;">Hi ${firstName},</p>

              <p style="margin:0 0 14px 0;font-size:15px;color:#374151;line-height:1.6;">
                Welcome to Vendorspot — platform built to protect shoppers like you from scammers.
              </p>

              <p style="margin:0 0 20px 0;font-size:15px;color:#374151;line-height:1.6;">
                You can now shop from verified vendors knowing your money is fully protected until you receive and complete your order. No risk. No stress. Just safe shopping.
              </p>

              <p style="margin:0 0 12px 0;font-size:15px;font-weight:700;color:#111111;">
                Here's what makes shopping on Vendorspot different:
              </p>

              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-bottom:20px;">
                ${[
                  'Escrow protection on every order',
                  'Verified vendors with public Trust Scores',
                  'Earn rewards on every purchase you make',
                  'Earn more by referring friends and leaving reviews',
                  'Dispute support if anything ever goes wrong',
                ].map((item) => `
                <tr>
                  <td style="padding:3px 0;font-size:14px;color:#374151;line-height:1.6;">
                    <span style="color:#CC3366;margin-right:8px;">&#10003;</span>${item}
                  </td>
                </tr>`).join('')}
              </table>

              <p style="margin:0 0 16px 0;font-size:15px;color:#374151;line-height:1.6;">
                Your account is ready. Start exploring trusted vendors today.
              </p>

              <!-- CTA link -->
              <p style="margin:0 0 20px 0;font-size:15px;">
                <span style="color:#CC3366;margin-right:6px;">&#8594;</span>
                <a href="${shopLink}" style="color:#CC3366;font-weight:600;text-decoration:none;">${shopLink}</a>
              </p>

              <p style="margin:0 0 20px 0;font-size:15px;color:#374151;line-height:1.6;">
                If you ever have questions or need help, our team is always here.
              </p>

              <p style="margin:0 0 4px 0;font-size:15px;color:#374151;">Welcome aboard,</p>
              <p style="margin:0 0 28px 0;font-size:15px;color:#374151;font-weight:600;">The Vendorspot Team</p>
            </td>
          </tr>

          <!-- Divider -->
          <tr>
            <td style="padding:0 32px;">
              <hr style="border:none;border-top:1px solid #e5e7eb;margin:0;" />
            </td>
          </tr>

          <!-- Support footer -->
          <tr>
            <td style="padding:20px 32px;">
              <p style="margin:0 0 6px 0;font-size:13px;color:#6b7280;">
                Need help? <a href="mailto:support@vendorspotng.com" style="color:#CC3366;text-decoration:none;">support@vendorspotng.com</a>
              </p>
              <p style="margin:0;font-size:13px;color:#374151;">
                <strong>Vendorspot</strong> — Confidence in every click.
              </p>
            </td>
          </tr>

          <!-- Legal footer -->
          <tr>
            <td style="padding:0 32px 24px 32px;">
              <p style="margin:0;font-size:11px;color:#9ca3af;line-height:1.6;">
                You're receiving this email because you created a Vendorspot account.<br />
                &copy; ${new Date().getFullYear()} Vendorspot (TheSpot) Ltd. All rights reserved.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;

  await sendEmail({
    to: email,
    subject: "Welcome to Vendorspot — Start shopping safely today",
    html,
  });
};

export const sendProductPostingGuideEmail = async (email: string): Promise<void> => {
  const steps = [
    {
      title: 'Access Your Product Dashboard',
      points: [
        'Log in to your Vendorspot account.',
        'From your dashboard, click <strong>"My Products"</strong>.',
        'Click <strong>"Add New Product"</strong>.',
      ],
    },
    {
      title: 'Upload Product Images',
      points: [
        'Upload a minimum of <strong>2 clear product images</strong>.',
        'You can upload up to 5 images per product.',
        'Use high-quality photos with good lighting to increase customer trust and improve sales.',
      ],
    },
    {
      title: 'Enter Your Product Name',
      points: [
        'Add a clear and descriptive product name.',
        'You may use the <strong>AI Generate</strong> feature to improve or optimize your product title for better visibility.',
        '<em>Example: Instead of "Sneakers," use "Men\'s White Casual Sneakers – Lightweight &amp; Comfortable."</em>',
      ],
    },
    {
      title: 'Select a Product Category',
      points: [
        'Choose the category that best matches your product to help customers find it easily.',
      ],
    },
    {
      title: 'Select Product Type',
      points: [
        '<strong>Physical Product</strong> – For items that require delivery.',
        '<strong>Digital Product</strong> – For courses, eBooks, software, templates, digital downloads, and other virtual products.',
      ],
    },
    {
      title: 'Add a Product Description',
      points: [
        'Enter a detailed description of your product.',
        'Highlight important features, specifications, benefits, and usage information.',
        'You may use the <strong>AI Generate</strong> feature to create or improve your description.',
      ],
    },
    {
      title: 'Set Product Pricing',
      points: [
        '<strong>Original Price</strong> (optional)',
        '<strong>Selling Price</strong>',
        'Displaying both prices can help customers see the value of your offer.',
      ],
    },
    {
      title: 'Add Available Stock',
      points: [
        'Enter the quantity currently available.',
        'Set a <strong>Low Stock Threshold</strong> to receive notifications when your inventory is running low.',
      ],
    },
    {
      title: 'Enter Product Weight (Optional)',
      points: [
        'If known, enter the product weight in kilograms (KG).',
        'This helps improve shipping and delivery calculations.',
        'If you do not know the weight, you may skip this section.',
      ],
    },
    {
      title: 'Add Product Tags and Keywords',
      points: [
        'Tags help customers discover your products through search.',
        'Use words customers are likely to search for.',
        '<em>Example for Sneakers: Shoes, Sneakers, Men\'s Footwear, Sports Shoes, Casual Shoes, Palm Slippers</em>',
        'Adding relevant tags improves your product visibility and increases your chances of making sales.',
      ],
    },
    {
      title: 'Add Product Variations',
      points: [
        'If your product comes in different options, add: Sizes, Colors, Styles, or Variants.',
        'This allows customers to select their preferred option before placing an order.',
      ],
    },
    {
      title: 'Enable Affiliate Selling (Optional)',
      points: [
        'You can allow affiliates and resellers to help promote and sell your products.',
        'Enable <strong>Affiliate Selling</strong> and set the commission percentage you would like to pay for each successful sale.',
        '<em>Note: The commission will be deducted from the product sale and paid to the affiliate who generated the order.</em>',
      ],
    },
    {
      title: 'Verify Product Pickup Location',
      points: [
        'Update the pickup address only if the product is stored at a different location from your default store address.',
        'Useful for dropshippers, multiple warehouse locations, or supplier pickup arrangements.',
        'You may add up to <strong>3 pickup locations</strong>. Ensure the address, postal code, and location details are accurate.',
      ],
    },
    {
      title: 'Submit for Review',
      points: [
        'Review your product details carefully.',
        'Click <strong>"Submit for Review"</strong>.',
        'Our team will review your product to ensure it complies with Vendorspot\'s marketplace policies before it goes live.',
      ],
    },
  ];

  const tips = [
    'Use clear, professional product images.',
    'Write detailed product descriptions.',
    'Add accurate tags and keywords.',
    'Keep your stock updated.',
    'Enable affiliate selling to get more people promoting your products.',
    'Respond quickly to customer inquiries and orders.',
  ];

  const stepsHtml = steps.map((step, i) => `
    <tr>
      <td style="padding:0 0 20px 0;">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
          <tr>
            <td style="vertical-align:top;padding-right:12px;width:28px;">
              <div style="width:26px;height:26px;border-radius:50%;background:#CC3366;text-align:center;line-height:26px;font-size:12px;font-weight:700;color:#ffffff;">${i + 1}</div>
            </td>
            <td style="vertical-align:top;">
              <p style="margin:0 0 8px 0;font-size:14px;font-weight:700;color:#111111;">${step.title}</p>
              ${step.points.map((p) => `
              <p style="margin:0 0 5px 0;font-size:13px;color:#374151;line-height:1.6;padding-left:12px;border-left:2px solid #f3f4f6;">
                ${p}
              </p>`).join('')}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  `).join('');

  const tipsHtml = tips.map((tip) => `
    <tr>
      <td style="padding:3px 0;font-size:13px;color:#374151;line-height:1.6;">
        <span style="color:#22C55E;margin-right:8px;font-size:14px;">&#10003;</span>${tip}
      </td>
    </tr>
  `).join('');

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
</head>
<body style="margin:0;padding:0;background-color:#f4f4f4;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="100%" style="max-width:560px;background:#ffffff;border-radius:8px;border:1px solid #e5e7eb;overflow:hidden;" cellspacing="0" cellpadding="0" border="0">

          <!-- Logo -->
          <tr>
            <td style="padding:28px 32px 0 32px;">
              ${emailLogo}
            </td>
          </tr>

          <!-- Title -->
          <tr>
            <td style="padding:20px 32px 0 32px;">
              <h1 style="margin:0;font-size:20px;font-weight:700;color:#111111;line-height:1.3;">How to Post Your Products on Vendorspot and Start Selling</h1>
            </td>
          </tr>

          <!-- Intro -->
          <tr>
            <td style="padding:16px 32px 0 32px;">
              <p style="margin:0;font-size:14px;color:#374151;line-height:1.7;">
                Welcome to Vendorspot! We are excited to have you join our marketplace. To help you get started, follow the simple steps below to upload your products and make them available to customers across Nigeria.
              </p>
            </td>
          </tr>

          <!-- Divider -->
          <tr>
            <td style="padding:20px 32px 0 32px;">
              <hr style="border:none;border-top:1px solid #e5e7eb;margin:0;" />
            </td>
          </tr>

          <!-- Steps heading -->
          <tr>
            <td style="padding:20px 32px 4px 32px;">
              <p style="margin:0;font-size:15px;font-weight:700;color:#CC3366;">How to Post a Product — 14 Steps</p>
            </td>
          </tr>

          <!-- Steps -->
          <tr>
            <td style="padding:16px 32px 0 32px;">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                ${stepsHtml}
              </table>
            </td>
          </tr>

          <!-- Tips heading -->
          <tr>
            <td style="padding:4px 32px 0 32px;">
              <hr style="border:none;border-top:1px solid #e5e7eb;margin:0 0 16px 0;" />
              <p style="margin:0 0 12px 0;font-size:15px;font-weight:700;color:#111111;">Tips to Increase Your Sales</p>
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                ${tipsHtml}
              </table>
            </td>
          </tr>

          <!-- Sign-off -->
          <tr>
            <td style="padding:24px 32px 0 32px;">
              <p style="margin:0 0 4px 0;font-size:14px;color:#374151;">Thank you for choosing Vendorspot.</p>
              <p style="margin:0 0 4px 0;font-size:14px;color:#374151;">Warm regards,</p>
              <p style="margin:0;font-size:14px;font-weight:600;color:#374151;">The Vendorspot Team</p>
            </td>
          </tr>

          <!-- Divider -->
          <tr>
            <td style="padding:24px 32px 0 32px;">
              <hr style="border:none;border-top:1px solid #e5e7eb;margin:0;" />
            </td>
          </tr>

          <!-- Support footer -->
          <tr>
            <td style="padding:20px 32px;">
              <p style="margin:0 0 6px 0;font-size:13px;color:#6b7280;">
                Need help? <a href="mailto:support@vendorspotng.com" style="color:#CC3366;text-decoration:none;">support@vendorspotng.com</a>
              </p>
              <p style="margin:0;font-size:13px;color:#374151;">
                <strong>Vendorspot</strong> — Confidence in every click.
              </p>
            </td>
          </tr>

          <!-- Legal footer -->
          <tr>
            <td style="padding:0 32px 24px 32px;">
              <p style="margin:0;font-size:11px;color:#9ca3af;line-height:1.6;">
                You're receiving this email because you created a Vendorspot account.<br />
                &copy; ${new Date().getFullYear()} Vendorspot (TheSpot) Ltd. All rights reserved.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;

  await sendEmail({
    to: email,
    subject: 'How to Post Your Products on Vendorspot and Start Selling',
    html,
  });
};

export const sendActivationEmail = async (email: string, name: string | undefined, activationLink: string): Promise<void> => {
  const displayName = name || 'there';

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
</head>
<body style="margin:0;padding:0;background-color:#f4f4f4;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="100%" style="max-width:520px;background:#ffffff;border-radius:8px;border:1px solid #e5e7eb;overflow:hidden;" cellspacing="0" cellpadding="0" border="0">

          <!-- Logo -->
          <tr>
            <td style="padding:28px 32px 0 32px;">
              ${emailLogo}
            </td>
          </tr>

          <!-- Title -->
          <tr>
            <td style="padding:24px 32px 0 32px;">
              <h1 style="margin:0;font-size:24px;font-weight:700;color:#111111;line-height:1.3;">Activate your account</h1>
            </td>
          </tr>

          <!-- Divider -->
          <tr>
            <td style="padding:20px 32px 0 32px;">
              <hr style="border:none;border-top:1px solid #e5e7eb;margin:0;" />
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:24px 32px 0 32px;">
              <p style="margin:0 0 16px 0;font-size:15px;color:#374151;">Hello ${displayName},</p>
              <p style="margin:0 0 16px 0;font-size:15px;color:#374151;line-height:1.6;">
                We received a request to activate your Vendorspot account. Click the button below to activate your account and get started.
              </p>
              <p style="margin:0 0 20px 0;font-size:13px;color:#9ca3af;">
                This link expires in 48 hours and can only be used once.
              </p>
            </td>
          </tr>

          <!-- CTA Button -->
          <tr>
            <td style="padding:0 32px 0 32px;">
              <a href="${activationLink}"
                style="display:inline-block;background-color:#CC3366;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;padding:14px 32px;border-radius:8px;">
                Activate Account
              </a>
            </td>
          </tr>

          <!-- Fallback link -->
          <tr>
            <td style="padding:16px 32px 0 32px;">
              <p style="margin:0 0 4px 0;font-size:12px;color:#9ca3af;">Or copy and paste this link into your browser:</p>
              <a href="${activationLink}" style="font-size:12px;color:#CC3366;word-break:break-all;text-decoration:none;">${activationLink}</a>
            </td>
          </tr>

          <!-- Ignore notice -->
          <tr>
            <td style="padding:24px 32px 0 32px;">
              <p style="margin:0;font-size:14px;color:#374151;">If you did not request this, you can safely ignore this email.</p>
            </td>
          </tr>

          <!-- Divider -->
          <tr>
            <td style="padding:24px 32px 0 32px;">
              <hr style="border:none;border-top:1px solid #e5e7eb;margin:0;" />
            </td>
          </tr>

          <!-- Support footer -->
          <tr>
            <td style="padding:20px 32px;">
              <p style="margin:0 0 6px 0;font-size:13px;color:#6b7280;">
                Need help? <a href="mailto:support@vendorspotng.com" style="color:#CC3366;text-decoration:none;">support@vendorspotng.com</a>
              </p>
              <p style="margin:0;font-size:13px;color:#374151;">
                <strong>Vendorspot</strong> — Confidence in every click.
              </p>
            </td>
          </tr>

          <!-- Legal footer -->
          <tr>
            <td style="padding:0 32px 24px 32px;">
              <p style="margin:0;font-size:11px;color:#9ca3af;line-height:1.6;">
                You're receiving this email because you created a Vendorspot account.<br />
                &copy; ${new Date().getFullYear()} Vendorspot (TheSpot) Ltd. All rights reserved.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;

  await sendEmail({
    to: email,
    subject: 'Activate your Vendorspot account',
    html,
  });
};

export const sendAmbassadorApprovalEmail = async (
  email: string,
  name: string,
  ambassadorCode: string,
  signupLink: string
): Promise<void> => {
  const firstName = name.split(' ')[0];

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
</head>
<body style="margin:0;padding:0;background-color:#f4f4f4;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="100%" style="max-width:520px;background:#ffffff;border-radius:8px;border:1px solid #e5e7eb;overflow:hidden;" cellspacing="0" cellpadding="0" border="0">

          <!-- Logo -->
          <tr>
            <td style="padding:28px 32px 0 32px;">
              ${emailLogo}
            </td>
          </tr>

          <!-- Hero banner -->
          <tr>
            <td style="padding:24px 32px 0 32px;">
              <div style="background:linear-gradient(135deg,#CC3366 0%,#99004d 100%);border-radius:10px;padding:28px 24px;text-align:center;">
                <p style="margin:0 0 6px 0;font-size:13px;font-weight:600;color:rgba(255,255,255,0.8);letter-spacing:1px;text-transform:uppercase;">You&rsquo;re In</p>
                <h1 style="margin:0;font-size:26px;font-weight:800;color:#ffffff;line-height:1.2;">Welcome to the<br/>Vendorspot Ambassador Program</h1>
              </div>
            </td>
          </tr>

          <!-- Body -->
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

          <!-- Ambassador Code box -->
          <tr>
            <td style="padding:0 32px;">
              <div style="background:#f9fafb;border:2px dashed #CC3366;border-radius:10px;padding:20px 24px;text-align:center;">
                <p style="margin:0 0 6px 0;font-size:12px;font-weight:700;color:#CC3366;letter-spacing:1px;text-transform:uppercase;">Your Ambassador Code</p>
                <p style="margin:0;font-size:30px;font-weight:800;color:#111111;letter-spacing:3px;font-family:monospace;">${ambassadorCode}</p>
                <p style="margin:8px 0 0 0;font-size:12px;color:#9ca3af;">Share this code with vendors &amp; customers you refer</p>
              </div>
            </td>
          </tr>

          <!-- What you earn -->
          <tr>
            <td style="padding:24px 32px 0 32px;">
              <p style="margin:0 0 12px 0;font-size:14px;font-weight:700;color:#111111;">What you earn:</p>
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                <tr>
                  <td style="padding:5px 0;font-size:13px;color:#374151;line-height:1.6;">
                    <span style="color:#CC3366;margin-right:8px;">&#10003;</span>
                    <strong>Vendor referrals:</strong> Earn up to ₦300/vendor as they grow on the platform
                  </td>
                </tr>
                <tr>
                  <td style="padding:5px 0;font-size:13px;color:#374151;line-height:1.6;">
                    <span style="color:#CC3366;margin-right:8px;">&#10003;</span>
                    <strong>Customer referrals:</strong> Earn 3% commission on their first 3 completed orders
                  </td>
                </tr>
                <tr>
                  <td style="padding:5px 0;font-size:13px;color:#374151;line-height:1.6;">
                    <span style="color:#CC3366;margin-right:8px;">&#10003;</span>
                    <strong>Monthly awards:</strong> Top Ambassador ₦25,000 · Top Campus ₦30,000 · Most Improved ₦10,000
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- CTA -->
          <tr>
            <td style="padding:28px 32px 0 32px;">
              <p style="margin:0 0 16px 0;font-size:14px;color:#374151;">
                Click the button below to create your Vendorspot account and activate your ambassador profile:
              </p>
              <a href="${signupLink}"
                style="display:inline-block;background-color:#CC3366;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;padding:14px 32px;border-radius:8px;">
                Create My Account
              </a>
              <p style="margin:12px 0 0 0;font-size:12px;color:#9ca3af;">This link expires in 48 hours and can only be used once.</p>
            </td>
          </tr>

          <!-- Fallback link -->
          <tr>
            <td style="padding:12px 32px 0 32px;">
              <p style="margin:0 0 4px 0;font-size:12px;color:#9ca3af;">Or copy and paste this link:</p>
              <a href="${signupLink}" style="font-size:12px;color:#CC3366;word-break:break-all;text-decoration:none;">${signupLink}</a>
            </td>
          </tr>

          <!-- Divider -->
          <tr>
            <td style="padding:28px 32px 0 32px;">
              <hr style="border:none;border-top:1px solid #e5e7eb;margin:0;" />
            </td>
          </tr>

          <!-- Support footer -->
          <tr>
            <td style="padding:20px 32px;">
              <p style="margin:0 0 6px 0;font-size:13px;color:#6b7280;">
                Questions? <a href="mailto:support@vendorspotng.com" style="color:#CC3366;text-decoration:none;">support@vendorspotng.com</a>
              </p>
              <p style="margin:0;font-size:13px;color:#374151;"><strong>Vendorspot</strong> — Confidence in every click.</p>
            </td>
          </tr>

          <!-- Legal footer -->
          <tr>
            <td style="padding:0 32px 24px 32px;">
              <p style="margin:0;font-size:11px;color:#9ca3af;line-height:1.6;">
                You applied to the Vendorspot Ambassador Program and were approved.<br />
                &copy; ${new Date().getFullYear()} Vendorspot (TheSpot) Ltd. All rights reserved.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;

  await sendEmail({
    to: email,
    subject: '🎉 You\'ve been approved — Welcome to the Vendorspot Ambassador Program',
    html,
  });
};

// ─── Plan Activation Email ────────────────────────────────────────────────────
// Sent to free-plan vendors whose products were deactivated when plans went live

export const sendPlanActivationEmail = async (
  email: string,
  firstName: string,
  businessName: string,
  deactivatedProducts: Array<{ name: string; id: string }>,
  freeLimit: number
): Promise<void> => {
  const APP_URL = process.env.FRONTEND_URL || 'https://vendorspotng.com';
  const productRows = deactivatedProducts
    .map(
      p => `<tr>
              <td style="padding:10px 0;border-bottom:1px solid #F3F4F6;font-size:14px;color:#374151;">${p.name}</td>
              <td style="padding:10px 0;border-bottom:1px solid #F3F4F6;text-align:right;">
                <span style="font-size:12px;background:#FEE2E2;color:#DC2626;padding:2px 8px;border-radius:12px;font-weight:600;">Inactive</span>
              </td>
            </tr>`
    )
    .join('');

  const html = `
  <!DOCTYPE html>
  <html>
  <body style="margin:0;padding:0;background:#F9FAFB;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#F9FAFB;padding:40px 20px;">
      <tr><td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">

          <!-- Header -->
          <tr><td style="background:linear-gradient(135deg,#CC3366,#F97316);padding:32px 40px;">
            ${emailLogo}
            <h1 style="margin:20px 0 0;font-size:22px;font-weight:800;color:#ffffff;">Important Update About Your Store</h1>
          </td></tr>

          <!-- Body -->
          <tr><td style="padding:36px 40px;">
            <p style="font-size:15px;color:#374151;margin:0 0 20px;">Hi <strong>${firstName}</strong>,</p>
            <p style="font-size:15px;color:#374151;margin:0 0 20px;">
              We've introduced <strong>subscription plans</strong> on VendorSpot to give vendors more tools, visibility, and features as you grow.
            </p>
            <p style="font-size:15px;color:#374151;margin:0 0 20px;">
              As part of the <strong>Free Plan</strong>, you can keep up to <strong>${freeLimit} active product listings</strong>.
              Because your store (<strong>${businessName}</strong>) had more than ${freeLimit} active products,
              we've temporarily set the following ${deactivatedProducts.length} product${deactivatedProducts.length !== 1 ? 's' : ''} to <em>inactive</em>:
            </p>

            <!-- Products table -->
            <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 28px;">
              <thead>
                <tr>
                  <th style="text-align:left;font-size:12px;font-weight:700;color:#6B7280;text-transform:uppercase;letter-spacing:0.5px;padding-bottom:8px;border-bottom:2px solid #E5E7EB;">Product Name</th>
                  <th style="text-align:right;font-size:12px;font-weight:700;color:#6B7280;text-transform:uppercase;letter-spacing:0.5px;padding-bottom:8px;border-bottom:2px solid #E5E7EB;">Status</th>
                </tr>
              </thead>
              <tbody>${productRows}</tbody>
            </table>

            <p style="font-size:14px;color:#374151;margin:0 0 28px;">
              Your top ${freeLimit} products (by sales) remain active. To reactivate all your products and unlock unlimited listings,
              upgrade to the <strong>Growth</strong> or <strong>Pro</strong> plan.
            </p>

            <!-- CTA Buttons -->
            <table cellpadding="0" cellspacing="0" style="margin:0 0 28px;">
              <tr>
                <td style="padding-right:12px;">
                  <a href="${APP_URL}/vendor/upgrade" style="display:inline-block;background:#CC3366;color:#ffffff;font-weight:700;font-size:14px;padding:14px 28px;border-radius:10px;text-decoration:none;">Upgrade My Plan</a>
                </td>
                <td>
                  <a href="${APP_URL}/vendor/products" style="display:inline-block;background:#F3F4F6;color:#374151;font-weight:600;font-size:14px;padding:14px 28px;border-radius:10px;text-decoration:none;">Manage Products</a>
                </td>
              </tr>
            </table>

            <p style="font-size:13px;color:#6B7280;margin:0;">
              If you have questions, reply to this email or contact us at
              <a href="mailto:support@vendorspotng.com" style="color:#CC3366;">support@vendorspotng.com</a>.
            </p>
          </td></tr>

          <!-- Footer -->
          <tr><td style="background:#F9FAFB;padding:24px 40px;text-align:center;border-top:1px solid #E5E7EB;">
            <p style="font-size:12px;color:#9CA3AF;margin:0;">© ${new Date().getFullYear()} VendorSpot. All rights reserved.</p>
          </td></tr>

        </table>
      </td></tr>
    </table>
  </body>
  </html>`;

  await sendEmail({
    to: email,
    subject: `Action Required: Your VendorSpot plan limits are now active`,
    html,
  });
};

// ─── Plan Assigned Email ──────────────────────────────────────────────────────
// Sent when an admin manually upgrades or changes a vendor's plan

export const sendPlanAssignedEmail = async (
  email: string,
  firstName: string,
  businessName: string,
  newPlan: string,
  previousPlan: string,
  reason?: string
): Promise<void> => {
  const APP_URL = process.env.FRONTEND_URL || 'https://vendorspotng.com';

  const planLabels: Record<string, { name: string; color: string }> = {
    free:   { name: 'Free Plan',   color: '#F59E0B' },
    growth: { name: 'Growth Plan', color: '#3B82F6' },
    pro:    { name: 'Pro Plan',    color: '#10B981' },
  };

  const { name: planName, color: planColor } = planLabels[newPlan] || { name: newPlan, color: '#CC3366' };
  const isUpgrade = newPlan !== 'free' && previousPlan === 'free';

  const html = `
  <!DOCTYPE html>
  <html>
  <body style="margin:0;padding:0;background:#F9FAFB;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#F9FAFB;padding:40px 20px;">
      <tr><td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">

          <tr><td style="background:linear-gradient(135deg,${planColor},#CC3366);padding:32px 40px;">
            ${emailLogo}
            <h1 style="margin:20px 0 0;font-size:22px;font-weight:800;color:#ffffff;">
              ${isUpgrade ? '🚀 Your Plan Has Been Upgraded!' : 'Your VendorSpot Plan Has Changed'}
            </h1>
          </td></tr>

          <tr><td style="padding:36px 40px;">
            <p style="font-size:15px;color:#374151;margin:0 0 20px;">Hi <strong>${firstName}</strong>,</p>
            <p style="font-size:15px;color:#374151;margin:0 0 20px;">
              Your store <strong>${businessName}</strong> has been moved to the
              <span style="background:${planColor}22;color:${planColor};font-weight:700;padding:3px 10px;border-radius:12px;">${planName}</span>.
            </p>
            ${reason ? `<p style="font-size:14px;color:#6B7280;background:#F9FAFB;border-left:3px solid ${planColor};padding:12px 16px;border-radius:4px;margin:0 0 24px;">Note: ${reason}</p>` : ''}
            ${isUpgrade ? `
            <p style="font-size:15px;color:#374151;margin:0 0 24px;">
              You now have access to all <strong>${planName}</strong> features — including unlimited product listings,
              a reduced commission rate, and more. Log in to explore your new capabilities.
            </p>` : ''}

            <a href="${APP_URL}/vendor/dashboard" style="display:inline-block;background:${planColor};color:#ffffff;font-weight:700;font-size:14px;padding:14px 32px;border-radius:10px;text-decoration:none;margin-bottom:28px;">
              Go to My Dashboard
            </a>

            <p style="font-size:13px;color:#6B7280;margin:0;">
              Questions? Email us at <a href="mailto:support@vendorspotng.com" style="color:#CC3366;">support@vendorspotng.com</a>.
            </p>
          </td></tr>

          <tr><td style="background:#F9FAFB;padding:24px 40px;text-align:center;border-top:1px solid #E5E7EB;">
            <p style="font-size:12px;color:#9CA3AF;margin:0;">© ${new Date().getFullYear()} VendorSpot. All rights reserved.</p>
          </td></tr>

        </table>
      </td></tr>
    </table>
  </body>
  </html>`;

  await sendEmail({
    to: email,
    subject: isUpgrade ? `🚀 Your ${planName} is now active on VendorSpot` : `Your VendorSpot plan has been updated`,
    html,
  });
};

// ─── Vendor Reminder Emails ───────────────────────────────────────────────────

export const sendVendorKycReminderEmail = async (
  email: string,
  firstName: string,
  businessName: string,
): Promise<void> => {
  const frontendUrl = process.env.FRONTEND_URL || 'https://vendorspotng.com';
  const kycLink = `${frontendUrl}/vendor/kyc`;

  const body = `
    <p style="margin:0 0 16px 0;font-size:15px;color:#374151;">Hi ${firstName},</p>
    <p style="margin:0 0 14px 0;font-size:15px;color:#374151;line-height:1.6;">
      Your store <strong>${businessName}</strong> is active, but you haven't uploaded your KYC documents yet.
      Completing KYC builds buyer trust and unlocks higher selling limits.
    </p>
    <p style="margin:0 0 12px 0;font-size:14px;font-weight:700;color:#111111;">Accepted documents:</p>
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-bottom:20px;">
      ${['National Identity Number (NIN)', 'CAC Certificate', 'Government-issued ID Card', 'International Passport', 'Driver\'s Licence', 'Utility Bill'].map(doc => `
      <tr>
        <td style="padding:3px 0;font-size:14px;color:#374151;line-height:1.6;">
          <span style="color:#CC3366;margin-right:8px;">&#10003;</span>${doc}
        </td>
      </tr>`).join('')}
    </table>
    <a href="${kycLink}" style="display:inline-block;background-color:#CC3366;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;padding:12px 28px;border-radius:6px;margin-bottom:20px;">
      Upload KYC Documents
    </a>`;

  await sendEmail({
    to: email,
    subject: 'Complete your KYC to build buyer trust on Vendorspot',
    html: wrapEmail('Complete your KYC verification', body),
  });
};

export const sendVendorKycPendingReminderEmail = async (
  email: string,
  firstName: string,
): Promise<void> => {
  const body = `
    <p style="margin:0 0 16px 0;font-size:15px;color:#374151;">Hi ${firstName},</p>
    <p style="margin:0 0 14px 0;font-size:15px;color:#374151;line-height:1.6;">
      We have received your KYC documents and they are currently under review. Thank you for submitting them.
    </p>
    <p style="margin:0 0 14px 0;font-size:15px;color:#374151;line-height:1.6;">
      Our team typically completes KYC reviews within <strong>2–5 business days</strong>. You'll receive an email
      as soon as your verification is approved.
    </p>
    <p style="margin:0 0 20px 0;font-size:15px;color:#374151;line-height:1.6;">
      In the meantime, you can continue setting up your store and adding products.
    </p>`;

  await sendEmail({
    to: email,
    subject: 'Your KYC is under review — we\'ll update you soon',
    html: wrapEmail('Your KYC is being reviewed', body),
  });
};

export const sendVendorFirstProductReminderEmail = async (
  email: string,
  firstName: string,
  businessName: string,
): Promise<void> => {
  const frontendUrl = process.env.FRONTEND_URL || 'https://vendorspotng.com';
  const addProductLink = `${frontendUrl}/vendor/products/new`;

  const body = `
    <p style="margin:0 0 16px 0;font-size:15px;color:#374151;">Hi ${firstName},</p>
    <p style="margin:0 0 14px 0;font-size:15px;color:#374151;line-height:1.6;">
      Your store <strong>${businessName}</strong> has been open for over 24 hours but you haven't added any products yet.
    </p>
    <p style="margin:0 0 20px 0;font-size:15px;color:#374151;line-height:1.6;">
      Buyers can't find you until you have at least one product live. Add your first product now and start selling today.
    </p>
    <a href="${addProductLink}" style="display:inline-block;background-color:#CC3366;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;padding:12px 28px;border-radius:6px;margin-bottom:20px;">
      Add Your First Product
    </a>`;

  await sendEmail({
    to: email,
    subject: 'Your store is empty — add your first product now',
    html: wrapEmail('Add your first product', body),
  });
};

export const sendVendorFirstProductFollowupEmail = async (
  email: string,
  firstName: string,
  businessName: string,
): Promise<void> => {
  const frontendUrl = process.env.FRONTEND_URL || 'https://vendorspotng.com';
  const addProductLink = `${frontendUrl}/vendor/products/new`;

  const body = `
    <p style="margin:0 0 16px 0;font-size:15px;color:#374151;">Hi ${firstName},</p>
    <p style="margin:0 0 14px 0;font-size:15px;color:#374151;line-height:1.6;">
      It's been 3 days since <strong>${businessName}</strong> opened on Vendorspot and your store still has no products.
    </p>
    <p style="margin:0 0 14px 0;font-size:15px;color:#374151;line-height:1.6;">
      Every day without a product is a day without sales. Even a single listing gets you in front of buyers
      actively shopping on Vendorspot right now.
    </p>
    <p style="margin:0 0 20px 0;font-size:15px;color:#374151;line-height:1.6;">
      Take 5 minutes to add your first product — we'll walk you through every step.
    </p>
    <a href="${addProductLink}" style="display:inline-block;background-color:#CC3366;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;padding:12px 28px;border-radius:6px;margin-bottom:20px;">
      List a Product Now
    </a>`;

  await sendEmail({
    to: email,
    subject: '3 days in — your store still has no products',
    html: wrapEmail('Your store needs products', body),
  });
};

export const sendVendorCompleteProfileReminderEmail = async (
  email: string,
  firstName: string,
  businessName: string,
  missing: string[],
): Promise<void> => {
  const frontendUrl = process.env.FRONTEND_URL || 'https://vendorspotng.com';
  const profileLink = `${frontendUrl}/vendor/settings`;

  const body = `
    <p style="margin:0 0 16px 0;font-size:15px;color:#374151;">Hi ${firstName},</p>
    <p style="margin:0 0 14px 0;font-size:15px;color:#374151;line-height:1.6;">
      Your store <strong>${businessName}</strong> is missing a few details that buyers look for before they trust a vendor.
    </p>
    <p style="margin:0 0 12px 0;font-size:14px;font-weight:700;color:#111111;">Still missing:</p>
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-bottom:20px;">
      ${missing.map(item => `
      <tr>
        <td style="padding:3px 0;font-size:14px;color:#374151;line-height:1.6;">
          <span style="color:#CC3366;margin-right:8px;">&#8594;</span>${item}
        </td>
      </tr>`).join('')}
    </table>
    <p style="margin:0 0 20px 0;font-size:14px;color:#374151;line-height:1.6;">
      A complete profile increases buyer confidence and improves your visibility in search results.
    </p>
    <a href="${profileLink}" style="display:inline-block;background-color:#CC3366;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;padding:12px 28px;border-radius:6px;margin-bottom:20px;">
      Complete My Profile
    </a>`;

  await sendEmail({
    to: email,
    subject: 'Complete your store profile to attract more buyers',
    html: wrapEmail('Your store profile is incomplete', body),
  });
};

export const sendVendorPayoutDetailsReminderEmail = async (
  email: string,
  firstName: string,
  businessName: string,
): Promise<void> => {
  const frontendUrl = process.env.FRONTEND_URL || 'https://vendorspotng.com';
  const payoutLink = `${frontendUrl}/vendor/settings/payout`;

  const body = `
    <p style="margin:0 0 16px 0;font-size:15px;color:#374151;">Hi ${firstName},</p>
    <p style="margin:0 0 14px 0;font-size:15px;color:#374151;line-height:1.6;">
      Your store <strong>${businessName}</strong> doesn't have a bank account linked yet.
      Without payout details, we cannot transfer your earnings to you when you make a sale.
    </p>
    <p style="margin:0 0 20px 0;font-size:15px;color:#374151;line-height:1.6;">
      It takes less than 2 minutes to add your account number. Do it now so your next payout goes through without delay.
    </p>
    <a href="${payoutLink}" style="display:inline-block;background-color:#CC3366;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;padding:12px 28px;border-radius:6px;margin-bottom:20px;">
      Add Bank Account
    </a>`;

  await sendEmail({
    to: email,
    subject: 'Add your bank account to receive payouts',
    html: wrapEmail('You haven\'t linked a bank account yet', body),
  });
};

export const sendVendorNoSalesReminderEmail = async (
  email: string,
  firstName: string,
  businessName: string,
): Promise<void> => {
  const frontendUrl = process.env.FRONTEND_URL || 'https://vendorspotng.com';
  const dashboardLink = `${frontendUrl}/vendor/dashboard`;

  const body = `
    <p style="margin:0 0 16px 0;font-size:15px;color:#374151;">Hi ${firstName},</p>
    <p style="margin:0 0 14px 0;font-size:15px;color:#374151;line-height:1.6;">
      <strong>${businessName}</strong> has products listed but no orders yet. Here are 3 things you can do today to get your first sale:
    </p>
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-bottom:20px;">
      <tr>
        <td style="padding:8px 0;font-size:14px;color:#374151;line-height:1.6;">
          <strong style="color:#CC3366;">1. Share your store link</strong> — post it on WhatsApp, Instagram, and Twitter to reach people who already know you.
        </td>
      </tr>
      <tr>
        <td style="padding:8px 0;font-size:14px;color:#374151;line-height:1.6;">
          <strong style="color:#CC3366;">2. Enable affiliate selling</strong> — let others promote your products and earn a commission only when they make a sale for you.
        </td>
      </tr>
      <tr>
        <td style="padding:8px 0;font-size:14px;color:#374151;line-height:1.6;">
          <strong style="color:#CC3366;">3. Improve your product descriptions</strong> — clear photos, detailed descriptions, and fair prices convert more browsers into buyers.
        </td>
      </tr>
    </table>
    <a href="${dashboardLink}" style="display:inline-block;background-color:#CC3366;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;padding:12px 28px;border-radius:6px;margin-bottom:20px;">
      Go to My Dashboard
    </a>`;

  await sendEmail({
    to: email,
    subject: 'You have products but no sales yet — here\'s what to do',
    html: wrapEmail('Let\'s get you your first order', body),
  });
};

export const sendVendorPendingOrderReminderEmail = async (
  email: string,
  firstName: string,
  orderNumber: string,
  itemCount: number,
): Promise<void> => {
  const frontendUrl = process.env.FRONTEND_URL || 'https://vendorspotng.com';
  const ordersLink = `${frontendUrl}/vendor/orders`;

  const body = `
    <p style="margin:0 0 16px 0;font-size:15px;color:#374151;">Hi ${firstName},</p>
    <p style="margin:0 0 14px 0;font-size:15px;color:#374151;line-height:1.6;">
      Order <strong>#${orderNumber}</strong> (${itemCount} item${itemCount !== 1 ? 's' : ''}) has been waiting for over 24 hours without being processed.
    </p>
    <p style="margin:0 0 14px 0;font-size:15px;color:#374151;line-height:1.6;">
      Slow fulfilment affects your trust score and can lead to buyer cancellations. Please confirm and process this order as soon as possible.
    </p>
    <div style="background:#fff3f6;border-left:4px solid #CC3366;padding:12px 16px;border-radius:4px;margin-bottom:20px;">
      <p style="margin:0;font-size:13px;color:#CC3366;font-weight:600;">
        Unprocessed orders for more than 48 hours may result in automatic cancellation and a negative impact on your store rating.
      </p>
    </div>
    <a href="${ordersLink}" style="display:inline-block;background-color:#CC3366;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;padding:12px 28px;border-radius:6px;margin-bottom:20px;">
      Process Order Now
    </a>`;

  await sendEmail({
    to: email,
    subject: `Urgent: Order #${orderNumber} has been waiting 24+ hours`,
    html: wrapEmail('You have a pending order', body),
  });
};

export const sendVendorEnableAffiliateReminderEmail = async (
  email: string,
  firstName: string,
  businessName: string,
): Promise<void> => {
  const frontendUrl = process.env.FRONTEND_URL || 'https://vendorspotng.com';
  const productsLink = `${frontendUrl}/vendor/products`;

  const body = `
    <p style="margin:0 0 16px 0;font-size:15px;color:#374151;">Hi ${firstName},</p>
    <p style="margin:0 0 14px 0;font-size:15px;color:#374151;line-height:1.6;">
      Did you know that Vendorspot affiliates can promote <strong>${businessName}'s</strong> products and drive sales for you?
    </p>
    <p style="margin:0 0 14px 0;font-size:15px;color:#374151;line-height:1.6;">
      Here's how it works: when you enable affiliate selling on a product, affiliates share your product links
      with their audience. You only pay a commission when they actually make a sale — no upfront cost, no risk.
    </p>
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-bottom:20px;">
      ${['Affiliates bring you customers you\'d never reach on your own', 'You set the commission percentage — you stay in control', 'More promoters means more visibility and more orders'].map(item => `
      <tr>
        <td style="padding:3px 0;font-size:14px;color:#374151;line-height:1.6;">
          <span style="color:#CC3366;margin-right:8px;">&#10003;</span>${item}
        </td>
      </tr>`).join('')}
    </table>
    <a href="${productsLink}" style="display:inline-block;background-color:#CC3366;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;padding:12px 28px;border-radius:6px;margin-bottom:20px;">
      Enable Affiliate Selling
    </a>`;

  await sendEmail({
    to: email,
    subject: 'Let affiliates sell your products for you',
    html: wrapEmail('Grow your sales with affiliate selling', body),
  });
};

export const sendVendorShareStoreReminderEmail = async (
  email: string,
  firstName: string,
  businessName: string,
  storeLink: string,
): Promise<void> => {
  const body = `
    <p style="margin:0 0 16px 0;font-size:15px;color:#374151;">Hi ${firstName},</p>
    <p style="margin:0 0 14px 0;font-size:15px;color:#374151;line-height:1.6;">
      <strong>${businessName}</strong> has products live on Vendorspot but hasn't made a sale yet.
      The fastest way to get your first order is to share your store link with people who already trust you.
    </p>
    <div style="background:#f9fafb;border-radius:8px;padding:16px 20px;margin-bottom:20px;">
      <p style="margin:0 0 8px 0;font-size:12px;font-weight:700;color:#111111;letter-spacing:0.5px;text-transform:uppercase;">Your Store Link</p>
      <a href="${storeLink}" style="font-size:14px;color:#CC3366;word-break:break-all;text-decoration:none;font-weight:600;">${storeLink}</a>
    </div>
    <p style="margin:0 0 12px 0;font-size:14px;font-weight:700;color:#111111;">Share on:</p>
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-bottom:20px;">
      ${['WhatsApp — send it to your contacts and groups', 'Instagram — add it to your bio or share as a story', 'Twitter/X — post it with a photo of your product'].map(platform => `
      <tr>
        <td style="padding:3px 0;font-size:14px;color:#374151;line-height:1.6;">
          <span style="color:#CC3366;margin-right:8px;">&#8594;</span>${platform}
        </td>
      </tr>`).join('')}
    </table>`;

  await sendEmail({
    to: email,
    subject: 'Your store is live — start sharing it to get orders',
    html: wrapEmail('Share your store and get your first sale', body),
  });
};

export const sendVendorInactiveReminderEmail = async (
  email: string,
  firstName: string,
  businessName: string,
): Promise<void> => {
  const frontendUrl = process.env.FRONTEND_URL || 'https://vendorspotng.com';
  const addProductLink = `${frontendUrl}/vendor/products/new`;

  const body = `
    <p style="margin:0 0 16px 0;font-size:15px;color:#374151;">Hi ${firstName},</p>
    <p style="margin:0 0 14px 0;font-size:15px;color:#374151;line-height:1.6;">
      We've missed you! <strong>${businessName}</strong> hasn't added any new products in the last 30 days.
    </p>
    <p style="margin:0 0 14px 0;font-size:15px;color:#374151;line-height:1.6;">
      Stores that stay active with fresh listings get more visibility in search results and recommendations.
      Even adding one new product can reignite buyer interest in your store.
    </p>
    <p style="margin:0 0 20px 0;font-size:15px;color:#374151;line-height:1.6;">
      We'd love to see you back. Your store is still live — come add something new today.
    </p>
    <a href="${addProductLink}" style="display:inline-block;background-color:#CC3366;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;padding:12px 28px;border-radius:6px;margin-bottom:20px;">
      Add a New Product
    </a>`;

  await sendEmail({
    to: email,
    subject: 'We\'ve missed you — your store needs new products',
    html: wrapEmail('Welcome back to Vendorspot', body),
  });
};

export const sendVendorSubscriptionExpiryEmail = async (
  email: string,
  firstName: string,
  planName: string,
  daysLeft: number,
  expiryDate: string,
): Promise<void> => {
  const frontendUrl = process.env.FRONTEND_URL || 'https://vendorspotng.com';
  const renewLink = `${frontendUrl}/vendor/upgrade`;

  const urgencyColor = daysLeft === 1 ? '#DC2626' : '#CC3366';

  const body = `
    <p style="margin:0 0 16px 0;font-size:15px;color:#374151;">Hi ${firstName},</p>
    <p style="margin:0 0 14px 0;font-size:15px;color:#374151;line-height:1.6;">
      Your <strong>${planName}</strong> subscription expires in <strong style="color:${urgencyColor};">${daysLeft} day${daysLeft !== 1 ? 's' : ''}</strong> on <strong>${expiryDate}</strong>.
    </p>
    <p style="margin:0 0 12px 0;font-size:14px;font-weight:700;color:#111111;">What you'll lose if you don't renew:</p>
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-bottom:20px;">
      ${['Unlimited product listings (excess products go inactive)', 'Lower commission rates on your sales', 'Priority visibility in search and recommendations', 'Access to advanced store analytics'].map(item => `
      <tr>
        <td style="padding:3px 0;font-size:14px;color:#374151;line-height:1.6;">
          <span style="color:${urgencyColor};margin-right:8px;">&#8594;</span>${item}
        </td>
      </tr>`).join('')}
    </table>
    <a href="${renewLink}" style="display:inline-block;background-color:${urgencyColor};color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;padding:12px 28px;border-radius:6px;margin-bottom:20px;">
      Renew My Subscription
    </a>`;

  const urgencyLabel = daysLeft === 1 ? 'expires tomorrow' : `expires in ${daysLeft} days`;

  await sendEmail({
    to: email,
    subject: `Your ${planName} ${urgencyLabel} — renew now`,
    html: wrapEmail(`Your ${planName} is expiring soon`, body),
  });
};

export const sendVendorLowStockAlertEmail = async (
  email: string,
  firstName: string,
  productName: string,
  remainingStock: number,
): Promise<void> => {
  const frontendUrl = process.env.FRONTEND_URL || 'https://vendorspotng.com';
  const productsLink = `${frontendUrl}/vendor/products`;

  const body = `
    <p style="margin:0 0 16px 0;font-size:15px;color:#374151;">Hi ${firstName},</p>
    <p style="margin:0 0 14px 0;font-size:15px;color:#374151;line-height:1.6;">
      Your product <strong>${productName}</strong> is running low on stock — only <strong style="color:#CC3366;">${remainingStock} unit${remainingStock !== 1 ? 's' : ''} remaining</strong>.
    </p>
    <p style="margin:0 0 20px 0;font-size:15px;color:#374151;line-height:1.6;">
      Products that go out of stock automatically become unavailable to buyers. Restock now to keep your sales going without interruption.
    </p>
    <a href="${productsLink}" style="display:inline-block;background-color:#CC3366;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;padding:12px 28px;border-radius:6px;margin-bottom:20px;">
      Update Stock
    </a>`;

  await sendEmail({
    to: email,
    subject: `Low stock alert: ${productName} is running out`,
    html: wrapEmail('Low stock alert', body),
  });
};

// ─── Customer Transactional Emails ────────────────────────────────────────────

export const sendOrderShippedEmail = async (
  email: string,
  firstName: string,
  orderNumber: string,
  courier?: string,
  trackingNumber?: string,
  estimatedDelivery?: string,
  trackingUrl?: string,
): Promise<void> => {
  const frontendUrl = process.env.FRONTEND_URL || 'https://vendorspotng.com';
  const orderUrl = `${frontendUrl}/orders/${orderNumber}`;

  const trackingBlock = trackingNumber ? `
    <div style="background:#f9fafb;border-radius:8px;padding:16px 20px;margin-bottom:20px;">
      <p style="margin:0 0 8px 0;font-size:12px;font-weight:700;color:#111111;letter-spacing:0.5px;text-transform:uppercase;">Shipment Details</p>
      ${courier ? `<p style="margin:0 0 6px 0;font-size:14px;color:#374151;"><span style="color:#6b7280;">Courier:</span>&nbsp;&nbsp;<strong>${courier}</strong></p>` : ''}
      <p style="margin:0 0 6px 0;font-size:14px;color:#374151;"><span style="color:#6b7280;">Tracking no:</span>&nbsp;&nbsp;<strong>${trackingNumber}</strong></p>
      ${estimatedDelivery ? `<p style="margin:0;font-size:14px;color:#374151;"><span style="color:#6b7280;">Est. delivery:</span>&nbsp;&nbsp;<strong>${estimatedDelivery}</strong></p>` : ''}
    </div>` : '';

  const body = `
    <p style="margin:0 0 16px 0;font-size:15px;color:#374151;">Hi ${firstName},</p>
    <p style="margin:0 0 14px 0;font-size:15px;color:#374151;line-height:1.6;">
      Great news — your order <strong>#${orderNumber}</strong> is on its way!
    </p>
    ${trackingBlock}
    <p style="margin:0 0 20px 0;font-size:14px;color:#374151;line-height:1.6;">
      Once your items arrive, confirm delivery in the app to complete your order and release payment to the vendor.
    </p>
    ${trackingUrl ? `<a href="${trackingUrl}" style="display:inline-block;background-color:#CC3366;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;padding:12px 28px;border-radius:6px;margin-bottom:12px;">Track Shipment</a><br/>` : ''}
    <a href="${orderUrl}" style="display:inline-block;background:#f3f4f6;color:#374151;font-size:13px;font-weight:600;text-decoration:none;padding:10px 24px;border-radius:6px;margin-top:8px;">
      View Order
    </a>`;

  await sendEmail({
    to: email,
    subject: `Your order #${orderNumber} is on its way`,
    html: wrapEmail('Your order has been shipped', body),
  });
};

export const sendOrderDeliveredEmail = async (
  email: string,
  firstName: string,
  orderNumber: string,
): Promise<void> => {
  const frontendUrl = process.env.FRONTEND_URL || 'https://vendorspotng.com';
  const orderUrl = `${frontendUrl}/orders/${orderNumber}`;

  const body = `
    <p style="margin:0 0 16px 0;font-size:15px;color:#374151;">Hi ${firstName},</p>
    <p style="margin:0 0 14px 0;font-size:15px;color:#374151;line-height:1.6;">
      Your order <strong>#${orderNumber}</strong> has been marked as delivered. We hope everything arrived in perfect condition!
    </p>
    <p style="margin:0 0 14px 0;font-size:15px;color:#374151;line-height:1.6;">
      Payment will be automatically released to the vendor in <strong>24 hours</strong>. If you have any issues, please raise a dispute before then.
    </p>
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin-bottom:20px;">
      <tr>
        <td style="padding-right:12px;">
          <a href="${orderUrl}" style="display:inline-block;background-color:#CC3366;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;padding:12px 28px;border-radius:6px;">Confirm Delivery</a>
        </td>
        <td>
          <a href="${orderUrl}" style="display:inline-block;background:#f3f4f6;color:#374151;font-size:13px;font-weight:600;text-decoration:none;padding:11px 24px;border-radius:6px;">Raise a Dispute</a>
        </td>
      </tr>
    </table>`;

  await sendEmail({
    to: email,
    subject: `Order #${orderNumber} delivered — please confirm receipt`,
    html: wrapEmail('Your order has been delivered', body),
  });
};

export const sendOrderCancelledEmail = async (
  email: string,
  firstName: string,
  orderNumber: string,
  cancelReason?: string,
  refundAmount?: number,
): Promise<void> => {
  const frontendUrl = process.env.FRONTEND_URL || 'https://vendorspotng.com';
  const shopLink = `${frontendUrl}/products`;

  const body = `
    <p style="margin:0 0 16px 0;font-size:15px;color:#374151;">Hi ${firstName},</p>
    <p style="margin:0 0 14px 0;font-size:15px;color:#374151;line-height:1.6;">
      Your order <strong>#${orderNumber}</strong> has been cancelled.
    </p>
    ${cancelReason ? `
    <div style="background:#f9fafb;border-left:3px solid #e5e7eb;padding:12px 16px;border-radius:4px;margin-bottom:16px;">
      <p style="margin:0;font-size:14px;color:#6b7280;">Reason: <span style="color:#374151;">${cancelReason}</span></p>
    </div>` : ''}
    ${refundAmount && refundAmount > 0 ? `
    <div style="background:#f0fdf4;border-radius:8px;padding:16px 20px;margin-bottom:20px;">
      <p style="margin:0 0 4px 0;font-size:12px;color:#16a34a;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">Refund Issued</p>
      <p style="margin:0;font-size:24px;font-weight:800;color:#111111;">₦${refundAmount.toLocaleString()}</p>
      <p style="margin:4px 0 0 0;font-size:13px;color:#6b7280;">Credited to your Vendorspot wallet</p>
    </div>` : ''}
    <a href="${shopLink}" style="display:inline-block;background-color:#CC3366;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;padding:12px 28px;border-radius:6px;margin-bottom:16px;">
      Continue Shopping
    </a>`;

  await sendEmail({
    to: email,
    subject: `Your order #${orderNumber} has been cancelled`,
    html: wrapEmail('Order cancelled', body),
  });
};

export const sendRefundProcessedEmail = async (
  email: string,
  firstName: string,
  orderNumber: string,
  refundAmount: number,
): Promise<void> => {
  const frontendUrl = process.env.FRONTEND_URL || 'https://vendorspotng.com';
  const walletLink = `${frontendUrl}/wallet`;

  const body = `
    <p style="margin:0 0 16px 0;font-size:15px;color:#374151;">Hi ${firstName},</p>
    <p style="margin:0 0 14px 0;font-size:15px;color:#374151;line-height:1.6;">
      Your refund for order <strong>#${orderNumber}</strong> has been processed.
    </p>
    <div style="background:#f0fdf4;border-radius:8px;padding:20px 24px;margin-bottom:20px;text-align:center;">
      <p style="margin:0 0 4px 0;font-size:12px;color:#16a34a;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">Amount Refunded</p>
      <p style="margin:0;font-size:36px;font-weight:800;color:#111111;">₦${refundAmount.toLocaleString()}</p>
      <p style="margin:6px 0 0 0;font-size:13px;color:#6b7280;">Available in your Vendorspot wallet immediately</p>
    </div>
    <p style="margin:0 0 20px 0;font-size:14px;color:#374151;line-height:1.6;">
      You can use this balance on your next purchase or withdraw it to your bank account.
    </p>
    <a href="${walletLink}" style="display:inline-block;background-color:#CC3366;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;padding:12px 28px;border-radius:6px;">
      View My Wallet
    </a>`;

  await sendEmail({
    to: email,
    subject: `Refund of ₦${refundAmount.toLocaleString()} processed for order #${orderNumber}`,
    html: wrapEmail('Refund processed', body),
  });
};

export const sendDisputeOpenedEmail = async (
  email: string,
  firstName: string,
  disputeNumber: string,
  orderNumber: string,
): Promise<void> => {
  const body = `
    <p style="margin:0 0 16px 0;font-size:15px;color:#374151;">Hi ${firstName},</p>
    <p style="margin:0 0 14px 0;font-size:15px;color:#374151;line-height:1.6;">
      Your dispute <strong>${disputeNumber}</strong> for order <strong>#${orderNumber}</strong> has been opened. Our team will review it within 2–5 business days.
    </p>
    <div style="background:#fef9c3;border-radius:8px;padding:16px 20px;margin-bottom:20px;">
      <p style="margin:0 0 8px 0;font-size:13px;font-weight:700;color:#92400e;">What happens next:</p>
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
        ${[
          'The vendor will be notified and given a chance to respond.',
          'Our team will review all evidence submitted.',
          'You will be notified once a resolution is reached.',
          'Any refund due will be credited directly to your wallet.',
        ].map(t => `<tr><td style="padding:3px 0;font-size:13px;color:#374151;line-height:1.6;"><span style="color:#CC3366;margin-right:8px;">&#10003;</span>${t}</td></tr>`).join('')}
      </table>
    </div>
    <p style="margin:0;font-size:14px;color:#374151;line-height:1.6;">
      Your funds remain securely held by Vendorspot until the dispute is resolved. You don't need to do anything right now.
    </p>`;

  await sendEmail({
    to: email,
    subject: `Dispute ${disputeNumber} opened — we're reviewing it`,
    html: wrapEmail('Dispute opened successfully', body),
  });
};

export const sendDisputeResolvedEmail = async (
  email: string,
  firstName: string,
  disputeNumber: string,
  orderNumber: string,
  resolution: string,
  refundAmount?: number,
): Promise<void> => {
  const body = `
    <p style="margin:0 0 16px 0;font-size:15px;color:#374151;">Hi ${firstName},</p>
    <p style="margin:0 0 14px 0;font-size:15px;color:#374151;line-height:1.6;">
      Your dispute <strong>${disputeNumber}</strong> for order <strong>#${orderNumber}</strong> has been resolved.
    </p>
    ${refundAmount && refundAmount > 0 ? `
    <div style="background:#f0fdf4;border-radius:8px;padding:20px 24px;margin-bottom:20px;text-align:center;">
      <p style="margin:0 0 4px 0;font-size:12px;color:#16a34a;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">Refund Issued</p>
      <p style="margin:0;font-size:36px;font-weight:800;color:#111111;">₦${refundAmount.toLocaleString()}</p>
      <p style="margin:6px 0 0 0;font-size:13px;color:#6b7280;">Credited to your Vendorspot wallet</p>
    </div>` : `
    <div style="background:#f9fafb;border-radius:8px;padding:16px 20px;margin-bottom:20px;">
      <p style="margin:0;font-size:14px;color:#374151;"><strong>Outcome:</strong> No refund was issued for this dispute.</p>
    </div>`}
    ${resolution ? `
    <div style="background:#f9fafb;border-left:3px solid #e5e7eb;padding:12px 16px;border-radius:4px;margin-bottom:20px;">
      <p style="margin:0 0 4px 0;font-size:12px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">Resolution note</p>
      <p style="margin:0;font-size:14px;color:#374151;">${resolution}</p>
    </div>` : ''}
    <p style="margin:0;font-size:14px;color:#374151;line-height:1.6;">
      If you have further questions, contact us at <a href="mailto:support@vendorspotng.com" style="color:#CC3366;text-decoration:none;">support@vendorspotng.com</a>.
    </p>`;

  await sendEmail({
    to: email,
    subject: `Dispute ${disputeNumber} resolved`,
    html: wrapEmail('Your dispute has been resolved', body),
  });
};

export const sendReviewRequestEmail = async (
  email: string,
  firstName: string,
  orderNumber: string,
  vendorName?: string,
): Promise<void> => {
  const frontendUrl = process.env.FRONTEND_URL || 'https://vendorspotng.com';
  const orderUrl = `${frontendUrl}/orders/${orderNumber}`;

  const body = `
    <p style="margin:0 0 16px 0;font-size:15px;color:#374151;">Hi ${firstName},</p>
    <p style="margin:0 0 14px 0;font-size:15px;color:#374151;line-height:1.6;">
      We hope you're enjoying your recent purchase${vendorName ? ` from <strong>${vendorName}</strong>` : ''}!
    </p>
    <p style="margin:0 0 14px 0;font-size:15px;color:#374151;line-height:1.6;">
      Your review helps other shoppers make confident decisions and helps honest vendors grow. It only takes a minute.
    </p>
    <div style="background:#f9fafb;border-radius:8px;padding:16px 20px;margin-bottom:20px;">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
        ${[
          'Helps other buyers shop with confidence',
          "Boosts the vendor's Trust Score",
          'Earns you bonus points for every review you leave',
        ].map(t => `<tr><td style="padding:3px 0;font-size:13px;color:#374151;line-height:1.6;"><span style="color:#CC3366;margin-right:8px;">&#10003;</span>${t}</td></tr>`).join('')}
      </table>
    </div>
    <a href="${orderUrl}" style="display:inline-block;background-color:#CC3366;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;padding:12px 28px;border-radius:6px;">
      Write a Review
    </a>`;

  await sendEmail({
    to: email,
    subject: `How was your order #${orderNumber}? Leave a review`,
    html: wrapEmail('How was your order?', body),
  });
};

// ─── Ambassador Commission Clawback Email ────────────────────────────────────

export const sendAmbassadorClawbackEmail = async (
  email: string,
  firstName: string,
  clawbackAmount: number,
  reason: 'rejected' | 'blocked',
  newPartialSum: number,
  milestonesReversed: { count: number; reward: number }[] = []
): Promise<void> => {
  const APP_URL = process.env.FRONTEND_URL || 'https://vendorspotng.com';
  const dashboardUrl = `${APP_URL}/ambassador-dashboard`;

  const reasonLabel = reason === 'rejected'
    ? 'rejected during verification'
    : 'removed from the platform';

  const milestoneRows = milestonesReversed.map(m => `
    <tr>
      <td style="padding:8px 0;font-size:13px;color:#374151;border-bottom:1px solid #f3f4f6;">
        Milestone bonus (${m.count} vendors reached)
      </td>
      <td style="padding:8px 0;font-size:13px;color:#DC2626;font-weight:700;text-align:right;border-bottom:1px solid #f3f4f6;">
        -₦${m.reward.toLocaleString()}
      </td>
    </tr>`).join('');

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
</head>
<body style="margin:0;padding:0;background-color:#f4f4f4;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="100%" style="max-width:520px;background:#ffffff;border-radius:8px;border:1px solid #e5e7eb;overflow:hidden;" cellspacing="0" cellpadding="0" border="0">

          <!-- Logo -->
          <tr>
            <td style="padding:28px 32px 0 32px;">
              ${emailLogo}
            </td>
          </tr>

          <!-- Hero -->
          <tr>
            <td style="padding:24px 32px 0 32px;">
              <div style="background:#fff7f0;border:1px solid #fed7aa;border-radius:10px;padding:22px 24px;">
                <p style="margin:0 0 4px 0;font-size:12px;font-weight:700;color:#c2410c;letter-spacing:1px;text-transform:uppercase;">Earnings Update</p>
                <h1 style="margin:0;font-size:20px;font-weight:800;color:#1f2937;line-height:1.3;">Commission Reversal Notice</h1>
              </div>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:24px 32px 0 32px;">
              <p style="margin:0 0 14px 0;font-size:15px;color:#374151;">Hi ${firstName},</p>
              <p style="margin:0 0 14px 0;font-size:15px;color:#374151;line-height:1.6;">
                We're writing to let you know that a vendor you referred has been <strong>${reasonLabel}</strong>. As outlined in our Ambassador Program terms, commissions tied to that vendor have been reversed.
              </p>
            </td>
          </tr>

          <!-- Reversal breakdown -->
          <tr>
            <td style="padding:20px 32px 0 32px;">
              <p style="margin:0 0 10px 0;font-size:13px;font-weight:700;color:#111111;text-transform:uppercase;letter-spacing:0.5px;">Reversal Breakdown</p>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
                <tr style="background:#f9fafb;">
                  <td style="padding:10px 16px;font-size:12px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">Item</td>
                  <td style="padding:10px 16px;font-size:12px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;text-align:right;">Amount</td>
                </tr>
                <tr>
                  <td style="padding:12px 16px;font-size:13px;color:#374151;border-top:1px solid #e5e7eb;">Vendor referral commissions (40% + 60%)</td>
                  <td style="padding:12px 16px;font-size:13px;color:#DC2626;font-weight:700;text-align:right;border-top:1px solid #e5e7eb;">-₦${clawbackAmount.toLocaleString()}</td>
                </tr>
                ${milestoneRows}
              </table>
            </td>
          </tr>

          <!-- Progress -->
          <tr>
            <td style="padding:20px 32px 0 32px;">
              <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:16px 20px;">
                <p style="margin:0 0 4px 0;font-size:12px;font-weight:700;color:#15803d;letter-spacing:0.5px;text-transform:uppercase;">Your Current Progress</p>
                <p style="margin:0;font-size:22px;font-weight:800;color:#111111;">${(Math.round(newPartialSum * 10) / 10).toFixed(1)} <span style="font-size:14px;font-weight:400;color:#6b7280;">vendor referral credits</span></p>
              </div>
            </td>
          </tr>

          <!-- Reassurance -->
          <tr>
            <td style="padding:20px 32px 0 32px;">
              <p style="margin:0 0 12px 0;font-size:14px;color:#374151;line-height:1.6;">
                This doesn't affect commissions from your other referrals — those remain in your wallet. Keep sharing your code and earning; the impact of one vendor doesn't define your progress.
              </p>
              <p style="margin:0;font-size:14px;color:#374151;line-height:1.6;">
                If you think this action was made in error, please reach out to our support team.
              </p>
            </td>
          </tr>

          <!-- CTA -->
          <tr>
            <td style="padding:24px 32px 0 32px;">
              <a href="${dashboardUrl}"
                style="display:inline-block;background-color:#CC3366;color:#ffffff;font-size:14px;font-weight:700;text-decoration:none;padding:13px 28px;border-radius:8px;">
                View My Dashboard
              </a>
            </td>
          </tr>

          <!-- Divider -->
          <tr>
            <td style="padding:28px 32px 0 32px;">
              <hr style="border:none;border-top:1px solid #e5e7eb;margin:0;" />
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:20px 32px 24px 32px;">
              <p style="margin:0 0 6px 0;font-size:13px;color:#6b7280;">
                Questions? <a href="mailto:support@vendorspotng.com" style="color:#CC3366;text-decoration:none;">support@vendorspotng.com</a>
              </p>
              <p style="margin:0;font-size:13px;color:#374151;"><strong>Vendorspot</strong> — Confidence in every click.</p>
              <p style="margin:8px 0 0 0;font-size:11px;color:#9ca3af;">&copy; ${new Date().getFullYear()} Vendorspot (TheSpot) Ltd. All rights reserved.</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  await sendEmail({
    to: email,
    subject: 'Important update on your ambassador earnings',
    html,
  });
};

// ═══════════════════════════════════════════════════════════════════════════
// Automated interval-based emails
// ═══════════════════════════════════════════════════════════════════════════

const FRONTEND = process.env.FRONTEND_URL || 'https://vendorspotng.com';

function fmtNaira(n: number): string {
  return `₦${(n || 0).toLocaleString('en-NG', { maximumFractionDigits: 2 })}`;
}

/** Cart abandoned — 24h reminder (soft nudge). */
export const sendCartAbandoned24hEmail = async (
  to: string,
  firstName: string,
  itemCount: number,
  cartTotal: number,
): Promise<void> => {
  const name = firstName || 'there';
  const body = `
    <p style="margin:0 0 12px 0;font-size:15px;color:#111;">Hi ${name},</p>
    <p style="margin:0 0 12px 0;font-size:14px;color:#374151;line-height:1.6;">
      You left <strong>${itemCount} item${itemCount === 1 ? '' : 's'}</strong>
      in your cart worth <strong>${fmtNaira(cartTotal)}</strong>.
      They're still waiting — checkout in one click.
    </p>
    <p style="margin:20px 0;">
      <a href="${FRONTEND}/cart" style="background:#CC3366;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;display:inline-block;">Complete Checkout</a>
    </p>
    <p style="margin:0;font-size:13px;color:#6b7280;">Prices and stock can change — grab yours before they're gone.</p>`;
  await sendEmail({ to, subject: 'You forgot something in your cart 🛒', html: wrapEmail('Your cart is waiting', body, 'customer') });
};

/** Cart abandoned — 72h reminder (final nudge, small discount hint). */
export const sendCartAbandoned72hEmail = async (
  to: string,
  firstName: string,
  itemCount: number,
  cartTotal: number,
): Promise<void> => {
  const name = firstName || 'there';
  const body = `
    <p style="margin:0 0 12px 0;font-size:15px;color:#111;">Hi ${name},</p>
    <p style="margin:0 0 12px 0;font-size:14px;color:#374151;line-height:1.6;">
      Your cart with ${itemCount} item${itemCount === 1 ? '' : 's'} (${fmtNaira(cartTotal)})
      is about to be cleared. Complete your order now so you don't lose it.
    </p>
    <p style="margin:20px 0;">
      <a href="${FRONTEND}/cart" style="background:#CC3366;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;display:inline-block;">Complete My Order</a>
    </p>
    <p style="margin:0;font-size:13px;color:#6b7280;">
      Need help checking out? Reply to this email and we'll walk you through it.
    </p>`;
  await sendEmail({ to, subject: 'Last chance — your cart is about to expire', html: wrapEmail("Don't miss out", body, 'customer') });
};

/** Come-back after 30 days silent. */
export const sendCustomerComebackEmail = async (
  to: string,
  firstName: string,
  daysSince: number,
): Promise<void> => {
  const name = firstName || 'there';
  const body = `
    <p style="margin:0 0 12px 0;font-size:15px;color:#111;">Hi ${name},</p>
    <p style="margin:0 0 12px 0;font-size:14px;color:#374151;line-height:1.6;">
      It's been about ${daysSince} days since we last saw you.
      We've added new vendors and products since then — come take a look.
    </p>
    <p style="margin:20px 0;">
      <a href="${FRONTEND}" style="background:#CC3366;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;display:inline-block;">Browse What's New</a>
    </p>
    <p style="margin:0;font-size:13px;color:#6b7280;">
      Any feedback? Just reply — we read every response.
    </p>`;
  await sendEmail({ to, subject: 'We miss you at Vendorspot 👋', html: wrapEmail("Long time no see", body, 'customer') });
};

/** Weekly admin digest — Monday morning snapshot. */
export const sendAdminWeeklyDigestEmail = async (
  to: string,
  firstName: string,
  stats: {
    pendingKycs: number;
    openDisputes: number;
    refundsThisWeek: number;
    newSignups: number;
    revenueThisWeek: number;
    weekLabel: string;
  },
): Promise<void> => {
  const row = (label: string, value: string | number, color = '#111') => `
    <tr>
      <td style="padding:12px 16px;border-bottom:1px solid #e5e7eb;font-size:14px;color:#6b7280;">${label}</td>
      <td style="padding:12px 16px;border-bottom:1px solid #e5e7eb;font-size:16px;font-weight:700;color:${color};text-align:right;">${value}</td>
    </tr>`;
  const body = `
    <p style="margin:0 0 12px 0;font-size:15px;color:#111;">Hi ${firstName || 'Admin'},</p>
    <p style="margin:0 0 16px 0;font-size:14px;color:#374151;">
      Here's your weekly Vendorspot snapshot for <strong>${stats.weekLabel}</strong>:
    </p>
    <table role="presentation" width="100%" style="border-collapse:collapse;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
      ${row('Pending KYCs', stats.pendingKycs, stats.pendingKycs > 0 ? '#F59E0B' : '#111')}
      ${row('Open Disputes', stats.openDisputes, stats.openDisputes > 0 ? '#EF4444' : '#111')}
      ${row('Refunds This Week', stats.refundsThisWeek)}
      ${row('New Signups', stats.newSignups, '#10B981')}
      ${row('Revenue This Week', fmtNaira(stats.revenueThisWeek), '#10B981')}
    </table>
    <p style="margin:20px 0 0 0;">
      <a href="${FRONTEND.replace('vendorspotng.com', 'theadmin.vendorspotng.com')}" style="background:#111;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;display:inline-block;">Open Admin Dashboard</a>
    </p>`;
  await sendEmail({ to, subject: `Vendorspot weekly digest — ${stats.weekLabel}`, html: wrapEmail('Weekly Digest', body, 'admin') });
};

/** Ambassador weekly performance summary. */
export const sendAmbassadorWeeklySummaryEmail = async (
  to: string,
  firstName: string,
  stats: {
    referralsThisWeek: number;
    commissionsThisWeek: number;
    totalReferrals: number;
    totalEarned: number;
    rank?: number | null;
    weekLabel: string;
  },
): Promise<void> => {
  const rankLine = stats.rank
    ? `<p style="margin:0 0 16px 0;font-size:14px;color:#374151;">You're ranked <strong>#${stats.rank}</strong> on the ambassador leaderboard this week.</p>`
    : '';
  const row = (label: string, value: string | number) => `
    <tr>
      <td style="padding:12px 16px;border-bottom:1px solid #e5e7eb;font-size:14px;color:#6b7280;">${label}</td>
      <td style="padding:12px 16px;border-bottom:1px solid #e5e7eb;font-size:16px;font-weight:700;color:#111;text-align:right;">${value}</td>
    </tr>`;
  const body = `
    <p style="margin:0 0 12px 0;font-size:15px;color:#111;">Hi ${firstName || 'Ambassador'},</p>
    <p style="margin:0 0 16px 0;font-size:14px;color:#374151;">
      Your Vendorspot ambassador stats for <strong>${stats.weekLabel}</strong>:
    </p>
    ${rankLine}
    <table role="presentation" width="100%" style="border-collapse:collapse;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
      ${row('Referrals This Week', stats.referralsThisWeek)}
      ${row('Commissions This Week', fmtNaira(stats.commissionsThisWeek))}
      ${row('Total Referrals', stats.totalReferrals)}
      ${row('Total Earned', fmtNaira(stats.totalEarned))}
    </table>
    <p style="margin:20px 0;font-size:13px;color:#6b7280;">
      Keep sharing your code — every signup counts. Full stats on your dashboard.
    </p>
    <p style="margin:20px 0 0 0;">
      <a href="${FRONTEND}/ambassador" style="background:#CC3366;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;display:inline-block;">Open Ambassador Dashboard</a>
    </p>`;
  await sendEmail({ to, subject: `Your ambassador week — ${stats.weekLabel}`, html: wrapEmail('Weekly Ambassador Summary', body, 'ambassador') });
};