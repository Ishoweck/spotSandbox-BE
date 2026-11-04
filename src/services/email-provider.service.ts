import { Resend } from 'resend';
import { logger } from '../utils/logger';
import { EmailUsage, EmailProvider } from '../models/EmailUsage';

// Resend is the primary provider. When it runs out for the day (or errors), the same email
// goes out through Brevo straight away, so users never miss an email because of a quota.
// Limits are the free-plan daily caps; override via env when a plan changes.
export const DAILY_LIMITS: Record<EmailProvider, number> = {
  resend: Number(process.env.RESEND_DAILY_LIMIT || 100),
  brevo: Number(process.env.BREVO_DAILY_LIMIT || 300),
};

export interface OutgoingEmail {
  from: string;
  to: string;
  subject: string;
  text?: string;
  html?: string;
  bcc?: string;
  attachments?: Array<{ filename: string; content: Buffer }>;
}

export interface DeliveryResult {
  provider: EmailProvider;
  id?: string;
}

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const BREVO_API_KEY = process.env.BREVO_API_KEY;

const utcDay = (d = new Date()) => d.toISOString().slice(0, 10);

class QuotaError extends Error {}

// In-process memo so we skip a provider for the rest of the UTC day once it reports
// exhaustion, without a DB read per email. The DB flag covers other processes/restarts.
const exhaustedMemo: Partial<Record<EmailProvider, string>> = {};

async function isExhausted(provider: EmailProvider, day: string): Promise<boolean> {
  if (exhaustedMemo[provider] === day) return true;
  try {
    const row = await EmailUsage.findOne({ day, provider }).select('units exhaustedAt').lean();
    if (row && (row.exhaustedAt || row.units >= DAILY_LIMITS[provider])) {
      exhaustedMemo[provider] = day;
      return true;
    }
  } catch (err: any) {
    // Never let usage bookkeeping block an email
    logger.warn('Email usage lookup failed', { error: err?.message });
  }
  return false;
}

function record(provider: EmailProvider, day: string, inc: Record<string, number>, exhausted = false) {
  const update: any = { $inc: inc };
  if (exhausted) {
    update.$set = { exhaustedAt: new Date() };
    exhaustedMemo[provider] = day;
  }
  EmailUsage.updateOne({ day, provider }, update, { upsert: true }).catch((err: any) =>
    logger.warn('Email usage write failed', { error: err?.message })
  );
}

async function sendViaResend(email: OutgoingEmail): Promise<string | undefined> {
  if (!resend) throw new Error('RESEND_API_KEY not set');
  const { data, error } = await resend.emails.send(email as any);
  if (error) {
    const name = (error as any).name || '';
    const status = (error as any).statusCode;
    const msg = `${name}: ${error.message}`;
    if (name === 'daily_quota_exceeded' || name === 'monthly_quota_exceeded') throw new QuotaError(msg);
    if (status === 429 && /quota/i.test(error.message || '')) throw new QuotaError(msg);
    throw new Error(msg);
  }
  return data?.id;
}

function parseAddress(addr: string): { name?: string; email: string } {
  const m = addr.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  return m ? { name: m[1].trim() || undefined, email: m[2].trim() } : { email: addr.trim() };
}

async function sendViaBrevo(email: OutgoingEmail): Promise<string | undefined> {
  if (!BREVO_API_KEY) throw new Error('BREVO_API_KEY not set');
  const body: any = {
    sender: parseAddress(process.env.BREVO_FROM || email.from),
    to: [{ email: email.to }],
    subject: email.subject,
  };
  if (email.html) body.htmlContent = email.html;
  if (email.text) body.textContent = email.text;
  if (!email.html && !email.text) body.textContent = ' ';
  if (email.bcc) body.bcc = [{ email: email.bcc }];
  if (email.attachments?.length) {
    body.attachment = email.attachments.map((a) => ({ name: a.filename, content: a.content.toString('base64') }));
  }

  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': BREVO_API_KEY, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = `${res.status} ${json?.code || ''}: ${json?.message || res.statusText}`;
    // Brevo answers 402/403/429 when the daily or account sending limit is hit
    if (res.status === 402 || res.status === 429 || /limit|quota|credit/i.test(json?.message || '')) {
      throw new QuotaError(msg);
    }
    throw new Error(msg);
  }
  return json?.messageId;
}

const SENDERS: Record<EmailProvider, (e: OutgoingEmail) => Promise<string | undefined>> = {
  resend: sendViaResend,
  brevo: sendViaBrevo,
};

const configured = (p: EmailProvider) => (p === 'resend' ? !!resend : !!BREVO_API_KEY);

/**
 * Send through Resend, falling back to Brevo. Throws only when no provider could send it,
 * so callers (and the email queue's retries) behave exactly as before.
 */
export async function deliverEmail(email: OutgoingEmail): Promise<DeliveryResult> {
  const day = utcDay();
  const units = 1 + (email.bcc ? 1 : 0);
  const order: EmailProvider[] = ['resend', 'brevo'];
  const errors: string[] = [];

  for (let i = 0; i < order.length; i++) {
    const provider = order[i];
    if (!configured(provider)) continue;
    const isLast = !order.slice(i + 1).some(configured);
    // Skip a provider that is already out for today, unless it is the only option left
    if (!isLast && (await isExhausted(provider, day))) continue;

    try {
      const id = await SENDERS[provider](email);
      record(provider, day, { sent: 1, units });
      if (i > 0) logger.info(`Email to ${email.to} sent via ${provider} fallback`);
      return { provider, id };
    } catch (err: any) {
      const quota = err instanceof QuotaError;
      record(provider, day, { failed: 1 }, quota);
      errors.push(`${provider}: ${err?.message}`);
      logger.warn(`Email via ${provider} failed${quota ? ' (daily limit reached)' : ''}`, {
        to: email.to,
        error: err?.message,
      });
    }
  }

  throw new Error(`All email providers failed: ${errors.join(' | ') || 'none configured'}`);
}

/** Daily counts for the last `days` UTC days, newest first. */
export async function getEmailUsage(days = 14) {
  const keys = Array.from({ length: days }, (_, i) => utcDay(new Date(Date.now() - i * 86400000)));
  const rows = await EmailUsage.find({ day: { $in: keys } }).lean();
  const blank = { sent: 0, units: 0, failed: 0, exhausted: false };
  const today = utcDay();

  const perDay = keys.map((day) => {
    const pick = (p: EmailProvider) => {
      const r: any = rows.find((x) => x.day === day && x.provider === p);
      return r ? { sent: r.sent || 0, units: r.units || 0, failed: r.failed || 0, exhausted: !!r.exhaustedAt || (r.units || 0) >= DAILY_LIMITS[p] } : { ...blank };
    };
    const resendUsage = pick('resend');
    const brevoUsage = pick('brevo');
    return {
      day,
      resend: resendUsage,
      brevo: brevoUsage,
      totalSent: resendUsage.sent + brevoUsage.sent,
      totalUnits: resendUsage.units + brevoUsage.units,
    };
  });

  const todayRow = perDay.find((d) => d.day === today)!;
  const totalLimit = DAILY_LIMITS.resend + DAILY_LIMITS.brevo;
  return {
    limits: { ...DAILY_LIMITS, total: totalLimit },
    providers: { resend: !!resend, brevo: !!BREVO_API_KEY },
    today: {
      ...todayRow,
      remaining: Math.max(0, totalLimit - todayRow.totalUnits),
    },
    days: perDay,
    resetsAt: `${today}T23:59:59Z`,
  };
}
