"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const mongoose_1 = __importDefault(require("mongoose"));
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const database_1 = require("../config/database");
const User_1 = __importDefault(require("../models/User"));
const types_1 = require("../types");
const EMAIL = 'super@example.com';
const PASSWORD = 'Password123!';
async function main() {
    await (0, database_1.connectDB)();
    const hash = await bcryptjs_1.default.hash(PASSWORD, 10);
    const result = await User_1.default.findOneAndUpdate({ email: EMAIL }, {
        $set: {
            password: hash,
            role: types_1.UserRole.SUPER_ADMIN,
            status: types_1.UserStatus.ACTIVE,
            emailVerified: true,
            firstName: 'Super',
            lastName: 'Admin',
        },
    }, { upsert: true, new: true, setDefaultsOnInsert: true });
    console.log(`✅  Superadmin ready — email: ${EMAIL}  _id: ${result?._id}`);
    await mongoose_1.default.disconnect();
    process.exit(0);
}
main().catch((err) => {
    console.error('❌  Failed:', err.message);
    mongoose_1.default.disconnect();
    process.exit(1);
});
//# sourceMappingURL=fixSuperAdmin.js.map