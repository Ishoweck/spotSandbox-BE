"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const mongoose_1 = __importDefault(require("mongoose"));
const database_1 = require("../config/database");
const VendorProfile_1 = __importDefault(require("../models/VendorProfile"));
const Product_1 = __importDefault(require("../models/Product"));
async function backfill() {
    await (0, database_1.connectDB)();
    console.log('\n🔄 Backfilling vendor ratings from product reviews...\n');
    const vendors = await VendorProfile_1.default.find({}).select('user businessName averageRating totalReviews');
    let updated = 0;
    let skipped = 0;
    for (const vendor of vendors) {
        const products = await Product_1.default.find({ vendor: vendor.user }).select('averageRating totalReviews');
        const totalReviews = products.reduce((sum, p) => sum + (p.totalReviews || 0), 0);
        const weightedSum = products.reduce((sum, p) => sum + ((p.averageRating || 0) * (p.totalReviews || 0)), 0);
        const averageRating = totalReviews > 0
            ? Math.round((weightedSum / totalReviews) * 10) / 10
            : 0;
        if (totalReviews === 0) {
            console.log(`  ⏭️  ${vendor.businessName} — no product reviews yet`);
            skipped++;
            continue;
        }
        await VendorProfile_1.default.findByIdAndUpdate(vendor._id, { averageRating, totalReviews });
        console.log(`  ✅ ${vendor.businessName} → ${averageRating}⭐ (${totalReviews} reviews)`);
        updated++;
    }
    console.log(`\n🎉 Done! Updated: ${updated}, Skipped (no reviews): ${skipped}\n`);
    await mongoose_1.default.disconnect();
    process.exit(0);
}
backfill().catch((err) => {
    console.error('❌ Backfill failed:', err);
    mongoose_1.default.disconnect().finally(() => process.exit(1));
});
//# sourceMappingURL=backfillVendorRatings.js.map