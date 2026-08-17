import axios from 'axios';
import { logger } from '../utils/logger';

const DOJAH_ENABLED = String(process.env.DOJAH_ENABLED || '').toLowerCase() === 'true';
const DOJAH_APP_ID = process.env.DOJAH_APP_ID || '';
const DOJAH_SECRET_KEY = process.env.DOJAH_SECRET_KEY || '';
const DOJAH_BASE_URL = process.env.DOJAH_BASE_URL || 'https://api.dojah.io';

// Auto-verify thresholds (Balanced tier — chosen with user)
const NAME_MATCH_MIN = 0.80;   // fuzzy name similarity 0-1
const FACE_MATCH_MIN = 80;     // Dojah confidence 0-100

export interface DojahNinEntity {
  first_name?: string;
  last_name?: string;
  middle_name?: string;
  date_of_birth?: string;
  phone_number?: string;
  gender?: string;
  photo?: string;  // some Dojah tiers return `photo`
  image?: string;  // sandbox + some prod tiers return `image` instead
  nin?: string;
  selfie_verification?: {
    match: boolean;
    confidence_value: number; // 0-100
  };
}

export interface DojahVerifyResult {
  attempted: boolean;              // did we even call Dojah? (false if disabled/no keys)
  success: boolean;                // did the HTTP call succeed?
  autoVerified: boolean;           // passed all match thresholds → safe to auto-approve
  nameMatch: boolean;
  nameMatchScore: number;          // 0-1
  faceMatch: boolean;
  faceMatchScore: number;          // 0-100
  returnedName?: string;
  returnedPhoto?: string;          // base64 from Dojah
  entity?: DojahNinEntity;
  failureReason?: string;          // human-readable reason auto-verify was not granted
  error?: string;                  // set only on HTTP/network failure
}

/**
 * Basic normalized-token similarity (Jaccard on lowercased tokens).
 * Handles reordering ("John Smith" vs "Smith John"), extra middle names, and case.
 */
function nameSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const tok = (s: string) => new Set(
    s.toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean)
  );
  const setA = tok(a);
  const setB = tok(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersect = 0;
  setA.forEach(t => { if (setB.has(t)) intersect++; });
  const union = new Set([...setA, ...setB]).size;
  return intersect / union;
}

/**
 * Verify NIN + selfie via Dojah.
 * NEVER throws — every failure mode returns a structured DojahVerifyResult
 * so the caller can always fall back to manual admin review.
 */
export async function verifyNINWithSelfie(
  nin: string,
  selfieBase64: string,
  registeredFullName: string,
): Promise<DojahVerifyResult> {
  const baseResult: DojahVerifyResult = {
    attempted: false,
    success: false,
    autoVerified: false,
    nameMatch: false,
    nameMatchScore: 0,
    faceMatch: false,
    faceMatchScore: 0,
  };

  // Kill switch — env flag disables Dojah entirely
  if (!DOJAH_ENABLED) {
    return { ...baseResult, failureReason: 'Dojah disabled via env flag' };
  }
  if (!DOJAH_APP_ID || !DOJAH_SECRET_KEY) {
    logger.warn('Dojah credentials missing — skipping automated NIN verification');
    return { ...baseResult, failureReason: 'Dojah credentials not configured' };
  }
  if (!/^\d{11}$/.test(nin)) {
    return { ...baseResult, attempted: false, failureReason: 'Invalid NIN format' };
  }

  const cleanSelfie = selfieBase64.replace(/^data:image\/\w+;base64,/, '');

  try {
    const response = await axios.post(
      `${DOJAH_BASE_URL}/api/v1/kyc/nin/verify`,
      { nin, selfie_image: cleanSelfie },
      {
        headers: {
          AppId: DOJAH_APP_ID,
          Authorization: DOJAH_SECRET_KEY,
          'Content-Type': 'application/json',
        },
        timeout: 20000,
      },
    );

    const entity: DojahNinEntity = response.data?.entity || {};
    const returnedName = [entity.first_name, entity.middle_name, entity.last_name]
      .filter(Boolean).join(' ').trim();
    const returnedPhoto = entity.image || entity.photo;

    const nameScore = nameSimilarity(registeredFullName, returnedName);
    const nameOk = nameScore >= NAME_MATCH_MIN;

    // Dojah's face-match is a paid add-on and is absent from sandbox responses.
    // Behavior: if `selfie_verification` is present → require face confidence ≥ threshold.
    // If ABSENT (sandbox or plans without face-match) → treat as "not evaluated" and require
    // a stronger name match (≥90%) to compensate. Never auto-verify on name alone with a weak score.
    const faceReturned = entity.selfie_verification !== undefined;
    const faceScore = Number(entity.selfie_verification?.confidence_value ?? 0);
    const faceOk = faceReturned
      ? (Boolean(entity.selfie_verification?.match) && faceScore >= FACE_MATCH_MIN)
      : false;

    const NAME_ONLY_MIN = 0.90; // stricter threshold when face-match unavailable
    const autoVerified = faceReturned
      ? (nameOk && faceOk)
      : (nameScore >= NAME_ONLY_MIN);

    let failureReason: string | undefined;
    if (!autoVerified) {
      const reasons: string[] = [];
      const requiredNameScore = faceReturned ? NAME_MATCH_MIN : NAME_ONLY_MIN;
      if (nameScore < requiredNameScore) {
        reasons.push(`Name mismatch (returned "${returnedName || 'n/a'}" vs registered "${registeredFullName}", score ${(nameScore * 100).toFixed(0)}% < ${(requiredNameScore * 100).toFixed(0)}%)`);
      }
      if (faceReturned && !faceOk) {
        reasons.push(`Face confidence ${faceScore}% below ${FACE_MATCH_MIN}%`);
      }
      if (!faceReturned && nameScore >= NAME_MATCH_MIN && nameScore < NAME_ONLY_MIN) {
        reasons.push(`Face-match not returned by provider — name-only mode requires ≥${NAME_ONLY_MIN * 100}% match`);
      }
      failureReason = reasons.join('; ');
    }

    logger.info(`Dojah NIN verify: nin=${nin.slice(0, 3)}***${nin.slice(-2)} nameScore=${nameScore.toFixed(2)} faceReturned=${faceReturned} faceScore=${faceScore} autoVerified=${autoVerified}`);

    return {
      attempted: true,
      success: true,
      autoVerified,
      nameMatch: nameOk,
      nameMatchScore: nameScore,
      faceMatch: faceOk,
      faceMatchScore: faceScore,
      returnedName,
      returnedPhoto,
      entity,
      failureReason,
    };
  } catch (err: any) {
    // Swallow every error — caller falls back to manual admin review
    const status = err?.response?.status;
    const dojahMsg = err?.response?.data?.error || err?.response?.data?.message || err?.message || 'Unknown error';
    logger.error(`Dojah NIN verify failed (${status || 'network'}): ${dojahMsg}`);
    return {
      ...baseResult,
      attempted: true,
      success: false,
      failureReason: `Dojah unavailable (${status || 'network'}) — flagged for manual review`,
      error: dojahMsg,
    };
  }
}
