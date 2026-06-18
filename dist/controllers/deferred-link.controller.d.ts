import { Request, Response } from 'express';
/**
 * Called by the website just before it redirects the user to the App Store.
 * Stores a fingerprint (IP + signals) paired with the affiliate code so the
 * app can retrieve it on first launch even if the clipboard was cleared.
 *
 * POST /api/v1/deferred-link/store
 * Body: { affiliateCode, platform, timezone, language }
 */
export declare function store(req: Request, res: Response): Promise<void>;
/**
 * Called by the app on its very first launch after a fresh install.
 * Matches by IP address first (primary signal), then confirms with
 * platform / timezone / language to avoid false positives.
 *
 * POST /api/v1/deferred-link/resolve
 * Body: { platform, timezone, language }
 */
export declare function resolve(req: Request, res: Response): Promise<void>;
//# sourceMappingURL=deferred-link.controller.d.ts.map