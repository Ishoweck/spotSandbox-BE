"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const mongoose_1 = __importDefault(require("mongoose"));
const database_1 = require("../config/database");
const VendorProfile_1 = __importDefault(require("../models/VendorProfile"));
const User_1 = __importDefault(require("../models/User"));
async function backfill() {
    await (0, database_1.connectDB)();
    console.log('\n🔄 Backfilling vendor business addresses into user saved addresses...\n');
    const vendors = await VendorProfile_1.default.find({
        'businessAddress.street': { $exists: true, $ne: '' },
        'businessAddress.city': { $exists: true, $ne: '' },
        'businessAddress.state': { $exists: true, $ne: '' },
    }).select('user businessName businessPhone businessAddress');
    let updated = 0;
    let skipped = 0;
    let failed = 0;
    for (const vendor of vendors) {
        try {
            const user = await User_1.default.findById(vendor.user).select('addresses');
            if (!user) {
                console.log(`  ⚠️  User not found for vendor ${vendor.businessName}`);
                failed++;
                continue;
            }
            // Check if 'Business Address' already exists in user's addresses
            const alreadyExists = user.addresses?.some((a) => a.label === 'Business Address');
            if (alreadyExists) {
                console.log(`  ⏭️  ${vendor.businessName} — business address already synced`);
                skipped++;
                continue;
            }
            const ba = vendor.businessAddress;
            await User_1.default.findByIdAndUpdate(vendor.user, {
                $push: {
                    addresses: {
                        street: ba.street,
                        city: ba.city,
                        state: ba.state,
                        country: ba.country || 'Nigeria',
                        label: 'Business Address',
                        fullName: vendor.businessName || '',
                        phone: vendor.businessPhone || '',
                        isDefault: false,
                    },
                },
            });
            console.log(`  ✅ ${vendor.businessName} → "${ba.street}, ${ba.city}, ${ba.state}" added`);
            updated++;
        }
        catch (err) {
            console.error(`  ❌ Failed for vendor ${vendor.businessName}:`, err);
            failed++;
        }
    }
    console.log(`\n🎉 Done! Updated: ${updated}, Skipped (already synced): ${skipped}, Failed: ${failed}\n`);
    await mongoose_1.default.disconnect();
    process.exit(0);
}
backfill().catch((err) => {
    console.error('❌ Backfill failed:', err);
    mongoose_1.default.disconnect().finally(() => process.exit(1));
});
//# sourceMappingURL=backfillVendorAddresses.js.map