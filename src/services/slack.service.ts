import axios from 'axios';
import { logger } from '../utils/logger';
import { SlackChannel, SlackJobData } from '../queues/slack.queue';

const SLACK_ENABLED = String(process.env.SLACK_ENABLED || '').toLowerCase() === 'true';

function webhookFor(channel: SlackChannel): string | undefined {
  switch (channel) {
    case 'vendor':     return process.env.SLACK_WEBHOOK_VENDOR;
    case 'customer':   return process.env.SLACK_WEBHOOK_CUSTOMER;
    case 'ambassador': return process.env.SLACK_WEBHOOK_AMBASSADOR;
    default:           return undefined;
  }
}

/**
 * Comma-separated Slack user IDs to @-mention on follow-up-worthy events.
 * Get an ID from Slack: click profile → "Copy member ID" (starts with U or W).
 * Example env: SLACK_MENTION_CUSTOMER=U0123ABC,U0456DEF
 */
function mentionsFor(channel: SlackChannel): string[] {
  const raw = channel === 'vendor'     ? process.env.SLACK_MENTION_VENDOR
            : channel === 'customer'   ? process.env.SLACK_MENTION_CUSTOMER
            : channel === 'ambassador' ? process.env.SLACK_MENTION_AMBASSADOR
            : '';
  return (raw || '').split(',').map(s => s.trim()).filter(Boolean);
}

/**
 * Format a Slack message payload using Block Kit.
 * Each event gets a header row (emoji + event name), a body line (the human-readable message),
 * and an optional context row with actor + metadata (compact, gray text).
 */
// Convert snake_case / camelCase keys → "Title Case" for display
function titleCase(key: string): string {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, c => c.toUpperCase());
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

// Slack Block Kit caps a section at 10 fields; each field text is 2000 chars max
function chunkFields<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function buildPayload(data: SlackJobData) {
  const { channel, event, actor, message, meta, emoji, nextStep, mention } = data;
  const eventTitle = event.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

  // @-mentions (rendered as a real ping)
  const mentions = mention ? mentionsFor(channel).map(id => `<@${id}>`).join(' ') : '';

  const blocks: any[] = [];

  // ── 1. Header block — big prominent event title ──
  blocks.push({
    type: 'header',
    text: { type: 'plain_text', text: `${emoji || '•'} ${eventTitle}`, emoji: true },
  });

  // ── 2. Mention row (if applicable) ──
  if (mentions) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `${mentions}  👋 *heads up — follow-up needed*` },
    });
  }

  // ── 3. Message body ──
  if (message) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: message },
    });
  }

  // ── 4. Next-step callout (highlighted) ──
  if (nextStep) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `> 🎯 *Next step:*\n> ${nextStep}` },
    });
  }

  // ── 5. Divider before structured data ──
  if (actor || (meta && Object.keys(meta).length > 0)) {
    blocks.push({ type: 'divider' });
  }

  // ── 6. Actor block — Name / Email / ID as 2-column fields ──
  if (actor && (actor.name || actor.email || actor.id)) {
    const actorFields: any[] = [];
    if (actor.name)  actorFields.push({ type: 'mrkdwn', text: `*👤 Name:*\n${truncate(String(actor.name), 100)}` });
    if (actor.email) actorFields.push({ type: 'mrkdwn', text: `*✉️ Email:*\n${truncate(String(actor.email), 100)}` });
    if (actor.id)    actorFields.push({ type: 'mrkdwn', text: `*🆔 User ID:*\n\`${String(actor.id)}\`` });
    blocks.push({ type: 'section', fields: actorFields });
  }

  // ── 7. Meta fields — 2-column grid, chunked at 10 per block ──
  if (meta && Object.keys(meta).length > 0) {
    const metaFields = Object.entries(meta)
      .filter(([, v]) => v !== null && v !== undefined && v !== '')
      .map(([k, v]) => {
        const label = titleCase(k);
        const value = typeof v === 'object' ? JSON.stringify(v) : String(v);
        return { type: 'mrkdwn', text: `*${label}:*\n${truncate(value, 300)}` };
      });

    for (const chunk of chunkFields(metaFields, 10)) {
      blocks.push({ type: 'section', fields: chunk });
    }
  }

  // ── 8. Footer context — timestamp only ──
  blocks.push({
    type: 'context',
    elements: [{ type: 'mrkdwn', text: `🕐 ${new Date().toISOString()}  ·  \`${event}\`` }],
  });

  return {
    // Fallback text (used in mobile/desktop notifications, and triggers the actual @-mention push)
    text: `${mentions} ${eventTitle}`.trim(),
    blocks,
  };
}

/**
 * Post a Slack notification. NEVER throws — errors are swallowed and logged
 * so a Slack outage cannot break the calling request path.
 */
export async function postToSlack(data: SlackJobData): Promise<{ delivered: boolean; reason?: string }> {
  if (!SLACK_ENABLED) {
    return { delivered: false, reason: 'Slack disabled via env flag' };
  }

  const url = webhookFor(data.channel);
  if (!url) {
    logger.warn(`[Slack] No webhook configured for channel "${data.channel}" — dropping ${data.event}`);
    return { delivered: false, reason: 'No webhook URL configured' };
  }

  try {
    await axios.post(url, buildPayload(data), {
      headers: { 'Content-Type': 'application/json' },
      timeout: 8000,
    });
    logger.info(`[Slack] ${data.channel} ← ${data.event}`);
    return { delivered: true };
  } catch (err: any) {
    const status = err?.response?.status;
    logger.error(`[Slack] Post failed (${status || 'network'}) for ${data.event}: ${err?.message}`);
    return { delivered: false, reason: `HTTP ${status || 'network'}: ${err?.message}` };
  }
}
