"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const mongoose_1 = __importDefault(require("mongoose"));
const database_1 = require("../config/database");
const User_1 = __importDefault(require("../models/User"));
const types_1 = require("../types");
const EMAIL = 'super@example.com';
const PASSWORD = process.env.SUPER_ADMIN_PASSWORD;
async function main() {
    if (!PASSWORD) {
        console.error('❌  Set SUPER_ADMIN_PASSWORD before running this script.');
        console.error('    e.g.  SUPER_ADMIN_PASSWORD=yourpassword npx ts-node src/scripts/seedSuperAdmin.ts');
        process.exit(1);
    }
    await (0, database_1.connectDB)();
    const existing = await User_1.default.findOne({ email: EMAIL });
    if (existing) {
        // If already exists, just upgrade the role and activate
        existing.role = types_1.UserRole.SUPER_ADMIN;
        existing.status = types_1.UserStatus.ACTIVE;
        existing.emailVerified = true;
        existing.password = PASSWORD; // pre-save hook re-hashes
        await existing.save();
        console.log(`✅  Updated existing user → super_admin  (${EMAIL})`);
    }
    else {
        await User_1.default.create({
            firstName: 'Super',
            lastName: 'Admin',
            email: EMAIL,
            password: PASSWORD, // pre-save hook hashes it
            role: types_1.UserRole.SUPER_ADMIN,
            status: types_1.UserStatus.ACTIVE,
            emailVerified: true,
        });
        console.log(`✅  Superadmin created  (${EMAIL})`);
    }
    await mongoose_1.default.disconnect();
    process.exit(0);
}
main().catch((err) => {
    console.error('❌  Seed failed:', err);
    mongoose_1.default.disconnect();
    process.exit(1);
});
//# sourceMappingURL=seedSuperAdmin.js.map