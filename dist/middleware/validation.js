"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validate = exports.mongoSanitize = void 0;
const express_validator_1 = require("express-validator");
// Strip MongoDB operator keys ($gt, $where, etc.) from any object recursively
function stripMongoOperators(obj) {
    if (Array.isArray(obj))
        return obj.map(stripMongoOperators);
    if (obj !== null && typeof obj === 'object') {
        const cleaned = {};
        for (const key of Object.keys(obj)) {
            if (!key.startsWith('$')) {
                cleaned[key] = stripMongoOperators(obj[key]);
            }
        }
        return cleaned;
    }
    return obj;
}
const mongoSanitize = (req, _res, next) => {
    if (req.body)
        req.body = stripMongoOperators(req.body);
    if (req.query)
        req.query = stripMongoOperators(req.query);
    if (req.params)
        req.params = stripMongoOperators(req.params);
    next();
};
exports.mongoSanitize = mongoSanitize;
const validate = (validations) => {
    return async (req, res, next) => {
        // Run all validations
        await Promise.all(validations.map((validation) => validation.run(req)));
        const errors = (0, express_validator_1.validationResult)(req);
        if (errors.isEmpty()) {
            return next();
        }
        const extractedErrors = [];
        errors.array().forEach((err) => {
            extractedErrors.push({ [err.path]: err.msg });
        });
        res.status(400).json({
            success: false,
            message: 'Validation failed',
            error: JSON.stringify(extractedErrors),
        });
    };
};
exports.validate = validate;
//# sourceMappingURL=validation.js.map