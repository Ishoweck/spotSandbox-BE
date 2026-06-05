"use strict";
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const mongoose_1 = __importDefault(require("mongoose"));
const VendorProfile_1 = __importDefault(require("../models/VendorProfile"));
const DRY_RUN = !process.argv.includes('--commit');
async function main() {
    const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/vendorspot';
    await mongoose_1.default.connect(uri);
    console.log(`Connected to MongoDB. Mode: ${DRY_RUN ? 'DRY RUN (no writes)' : 'COMMIT'}\n`);
    const vendors = await VendorProfile_1.default.find({
        'kycDocuments.1': { $exists: true }, // only vendors with 2+ docs (potential duplicates)
    }).select('_id businessName kycDocuments');
    let totalVendors = 0;
    let totalDocsRemoved = 0;
    for (const vendor of vendors) {
        const original = vendor.kycDocuments;
        const seen = new Map(); // type -> last index
        // Walk forward, recording the last index for each type
        original.forEach((doc, i) => {
            seen.set(doc.type, i);
        });
        // Keep only the entries whose index is the "last seen" for that type
        const deduped = original.filter((doc, i) => seen.get(doc.type) === i);
        const removed = original.length - deduped.length;
        if (removed === 0)
            continue; // no duplicates for this vendor
        totalVendors++;
        totalDocsRemoved += removed;
        console.log(`Vendor: ${vendor.businessName} (${vendor._id})`);
        console.log(`  Before: ${original.length} docs  →  After: ${deduped.length} docs  (removed ${removed})`);
        // Log which types had duplicates
        const typeCounts = {};
        original.forEach((d) => { typeCounts[d.type] = (typeCounts[d.type] || 0) + 1; });
        const duped = Object.entries(typeCounts)
            .filter(([, count]) => count > 1)
            .map(([type, count]) => `${type} ×${count}`)
            .join(', ');
        console.log(`  Duplicated types: ${duped}\n`);
        if (!DRY_RUN) {
            await VendorProfile_1.default.updateOne({ _id: vendor._id }, { $set: { kycDocuments: deduped } });
        }
    }
    console.log('─'.repeat(50));
    console.log(`Vendors affected : ${totalVendors}`);
    console.log(`Docs removed     : ${totalDocsRemoved}`);
    if (DRY_RUN) {
        console.log('\nDRY RUN — no changes written. Re-run with --commit to apply.');
    }
    else {
        console.log('\nDone. All duplicates removed.');
    }
    await mongoose_1.default.disconnect();
}
main().catch((err) => {
    console.error(err);
    process.exit(1);
});
//# sourceMappingURL=dedup-kyc-docs.js.map