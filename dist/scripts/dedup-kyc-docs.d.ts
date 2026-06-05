/**
 * Migration: Deduplicate KYC documents per vendor
 *
 * Root cause: uploadKYCDocuments used to always push() without checking for
 * existing docs of the same type, causing duplicates on re-upload.
 *
 * Strategy: for each vendor, keep the LAST occurrence of each doc type
 * (array order = upload order, so last = most recent).
 *
 * Usage:
 *   npx ts-node src/scripts/dedup-kyc-docs.ts            # dry run (safe, no writes)
 *   npx ts-node src/scripts/dedup-kyc-docs.ts --commit   # apply changes
 */
import 'dotenv/config';
//# sourceMappingURL=dedup-kyc-docs.d.ts.map