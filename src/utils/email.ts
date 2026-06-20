import { Resend } from 'resend';
import { logger } from './logger';

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

interface EmailOptions {
  to: string;
  subject: string;
  text?: string;
  html?: string;
  attachments?: Array<{ filename: string; content: Buffer }>;
}

export const sendEmail = async (options: EmailOptions): Promise<void> => {
  try {
    const { data, error } = await resend.emails.send({
      from: process.env.EMAIL_FROM || 'VendorSpot <noreply@vendorspotng.com>',
      to: options.to,
      subject: options.subject,
      text: options.text,
      html: options.html,
      attachments: options.attachments,
    });

    if (error) {
      logger.error('Resend error:', error);
      throw new Error(`Failed to send email: ${error.message}`);
    }

    logger.info(`Email sent to ${options.to}`, { emailId: data?.id });
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
  items?: OrderEmailItem[]
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