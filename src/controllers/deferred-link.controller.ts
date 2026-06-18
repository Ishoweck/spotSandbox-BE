import { Request, Response } from 'express';
import { DeferredLink } from '../models/DeferredLink';

function getClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') return forwarded.split(',')[0].trim();
  return req.ip ?? 'unknown';
}

/**
 * Called by the website just before it redirects the user to the App Store.
 * Stores a fingerprint (IP + signals) paired with the affiliate code so the
 * app can retrieve it on first launch even if the clipboard was cleared.
 *
 * POST /api/v1/deferred-link/store
 * Body: { affiliateCode, platform, timezone, language }
 */
export async function store(req: Request, res: Response) {
  const { affiliateCode, platform = 'unknown', timezone = '', language = '' } = req.body;

  if (!affiliateCode) {
    res.status(400).json({ success: false, message: 'affiliateCode is required' });
    return;
  }

  const ipAddress = getClientIp(req);

  await DeferredLink.create({ affiliateCode, ipAddress, platform, timezone, language });

  res.json({ success: true });
}

/**
 * Called by the app on its very first launch after a fresh install.
 * Matches by IP address first (primary signal), then confirms with
 * platform / timezone / language to avoid false positives.
 *
 * POST /api/v1/deferred-link/resolve
 * Body: { platform, timezone, language }
 */
export async function resolve(req: Request, res: Response) {
  const { platform = 'unknown', timezone = '', language = '' } = req.body;
  const ipAddress = getClientIp(req);

  // Find the most recent unused record for this IP within the 48 h TTL window.
  // Mongoose's TTL index handles expiry; we just filter on used: false.
  const candidates = await DeferredLink.find({ ipAddress, used: false })
    .sort({ createdAt: -1 })
    .limit(5)
    .lean();

  if (!candidates.length) {
    res.json({ success: true, affiliateCode: null });
    return;
  }

  // Score each candidate — prefer platform match, then timezone, then language
  let best = candidates[0];
  let bestScore = 0;

  for (const c of candidates) {
    let score = 0;
    if (platform !== 'unknown' && c.platform === platform) score += 3;
    if (timezone && c.timezone === timezone) score += 2;
    if (language && c.language === language) score += 1;
    if (score > bestScore) { bestScore = score; best = c; }
  }

  // Mark as used so the same code isn't returned twice
  await DeferredLink.findByIdAndUpdate(best._id, { used: true });

  res.json({ success: true, affiliateCode: best.affiliateCode });
}
