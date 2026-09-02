// services/vendorspot-logistics.client.ts
//
// Thin HTTP client for the VendorSpot Logistics engine (separate service at
// vendorspot-logistics/). Used in SHADOW mode — every ShipBubble rate fetch
// also fires a parallel quote here so we can compare over time.
//
// Design notes:
// - Never throws. Always returns { ok, ... } — the shadow path MUST NOT break
//   the real ShipBubble flow, no matter what happens on our end.
// - Tight timeout (default 5s) so a slow logistics service doesn't drag out
//   the worker.
// - Auth is by X-Merchant-Id header; VendorSpot has a single merchant record
//   on the logistics side (id set via LOGISTICS_SHADOW_MERCHANT_ID env var).

import axios, { AxiosError } from 'axios';
import { logger } from '../utils/logger';

const LOGISTICS_SERVICE_URL = process.env.LOGISTICS_SERVICE_URL || 'http://localhost:4000';
const LOGISTICS_MERCHANT_ID = process.env.LOGISTICS_SHADOW_MERCHANT_ID || '';
// 5s was too tight — a real quote fans out to Fez + Kwik + other adapters,
// each with their own network round-trip to a Nigerian sandbox. Cold-path
// requests are ~4-5s at the p50, so 5s would timeout on any jitter. 12s gives
// enough headroom without blocking checkout meaningfully (this is fire-and-
// forget on a background worker anyway).
const DEFAULT_TIMEOUT_MS = 12_000;

export interface LogisticsAddress {
  line1: string;
  line2?: string;
  city: string;
  state: string;
  country: string;
  countryCode: string; // ISO 3166-1 alpha-2, e.g. 'NG'
  postalCode?: string;
  landmark?: string;
  geo?: { lat: number; lng: number };
}

export interface LogisticsPackage {
  description: string;
  weightGrams: number;
  quantity: number;
  declaredValueKobo: number;
  dimensions?: { lengthCm: number; widthCm: number; heightCm: number };
  category?: string;
  fragile?: boolean;
}

export interface LogisticsQuoteRequest {
  origin: LogisticsAddress;
  destination: LogisticsAddress;
  packages: LogisticsPackage[];
}

export interface LogisticsQuoteOption {
  id: string;
  carrierId: string;
  service: string;
  subCarrier: string | null;
  priceKobo: number;
  etaHours: number | null;
}

export interface LogisticsQuoteResponse {
  id: string;
  expiresAt: string;
  options: LogisticsQuoteOption[];
  unavailable: Array<{ carrier: string; reason: string }>;
}

// Single-shape result (parent repo has strictNullChecks off, so discriminated
// unions don't narrow reliably — using a flat interface with optional fields
// keeps the call-site code clean.)
export interface QuoteResult {
  ok: boolean;
  data?: LogisticsQuoteResponse;
  error?: string;
  category?: 'timeout' | 'network' | 'http' | 'config' | 'other';
  durationMs: number;
}

export class VendorSpotLogisticsClient {
  async getQuote(req: LogisticsQuoteRequest, timeoutMs: number = DEFAULT_TIMEOUT_MS): Promise<QuoteResult> {
    if (!LOGISTICS_MERCHANT_ID) {
      return {
        ok: false,
        error: 'LOGISTICS_SHADOW_MERCHANT_ID env var is not set',
        category: 'config',
        durationMs: 0,
      };
    }

    const start = Date.now();
    try {
      const res = await axios.post<LogisticsQuoteResponse>(
        `${LOGISTICS_SERVICE_URL}/v1/quotes`,
        req,
        {
          headers: {
            'Content-Type': 'application/json',
            'X-Merchant-Id': LOGISTICS_MERCHANT_ID,
          },
          timeout: timeoutMs,
          validateStatus: () => true, // handle all statuses ourselves
        },
      );
      const durationMs = Date.now() - start;
      if (res.status >= 200 && res.status < 300) {
        return { ok: true, data: res.data, durationMs };
      }
      return {
        ok: false,
        error: `HTTP ${res.status}: ${extractErrorMessage(res.data)}`,
        category: 'http',
        durationMs,
      };
    } catch (err) {
      const durationMs = Date.now() - start;
      if (axios.isAxiosError(err)) {
        const axErr = err as AxiosError;
        if (axErr.code === 'ECONNABORTED' || axErr.message.includes('timeout')) {
          return { ok: false, error: `timeout after ${timeoutMs}ms`, category: 'timeout', durationMs };
        }
        return { ok: false, error: axErr.message, category: 'network', durationMs };
      }
      // Never re-throw — shadow path must be safe
      logger.warn('[LogisticsClient] Unexpected error:', err);
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        category: 'other',
        durationMs,
      };
    }
  }
}

function extractErrorMessage(body: unknown): string {
  if (typeof body === 'string') return body;
  if (body && typeof body === 'object') {
    const b = body as { message?: unknown; error?: unknown };
    if (typeof b.message === 'string') return b.message;
    if (Array.isArray(b.message)) return b.message.join('; ');
    if (typeof b.error === 'string') return b.error;
  }
  return 'unknown error';
}

export const vendorSpotLogisticsClient = new VendorSpotLogisticsClient();
