"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.contactController = exports.ContactController = void 0;
const ContactMessage_1 = require("../models/ContactMessage");
const email_1 = require("../utils/email");
class ContactController {
    async submit(req, res) {
        const { name, email, subject, message } = req.body;
        if (!name || !email || !message) {
            res.status(400).json({ success: false, message: 'name, email and message are required' });
            return;
        }
        await ContactMessage_1.ContactMessage.create({ name, email, subject, message });
        const adminEmail = process.env.SUPER_ADMIN_EMAIL || 'support@vendorspotng.com';
        const emailSubject = subject ? `Contact Us: ${subject}` : 'New Contact Us Message';
        await (0, email_1.sendEmail)({
            to: adminEmail,
            subject: emailSubject,
            html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:8px;padding:32px;">
          <span style="font-size:20px;font-weight:800;color:#111111;letter-spacing:-0.5px;">
            <span style="color:#CC3366;">V</span>endorspot — New Contact Message
          </span>
          <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0;" />
          <p style="margin:0 0 8px 0;font-size:14px;color:#374151;"><strong>From:</strong> ${name} &lt;${email}&gt;</p>
          ${subject ? `<p style="margin:0 0 8px 0;font-size:14px;color:#374151;"><strong>Subject:</strong> ${subject}</p>` : ''}
          <p style="margin:0 0 16px 0;font-size:14px;color:#374151;"><strong>Message:</strong></p>
          <div style="background:#f9fafb;border-radius:6px;padding:16px;font-size:14px;color:#374151;line-height:1.7;white-space:pre-wrap;">${message}</div>
          <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0 16px 0;" />
          <p style="margin:0;font-size:12px;color:#9ca3af;">Reply directly to <a href="mailto:${email}" style="color:#CC3366;">${email}</a> to respond to this message.</p>
        </div>
      `,
        }).catch(() => { });
        res.status(201).json({ success: true, message: 'Contact message received' });
    }
}
exports.ContactController = ContactController;
exports.contactController = new ContactController();
//# sourceMappingURL=contact.controller.js.map