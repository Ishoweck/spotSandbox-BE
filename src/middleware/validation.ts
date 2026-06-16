import { Request, Response, NextFunction } from 'express';
import { validationResult, ValidationChain } from 'express-validator';
import { ApiResponse } from '../types';
import { logger } from '../utils/logger';

// Strip MongoDB operator keys ($gt, $where, etc.) from any object recursively
function stripMongoOperators(obj: any): any {
  if (Array.isArray(obj)) return obj.map(stripMongoOperators);
  if (obj !== null && typeof obj === 'object') {
    const cleaned: any = {};
    for (const key of Object.keys(obj)) {
      if (!key.startsWith('$')) {
        cleaned[key] = stripMongoOperators(obj[key]);
      }
    }
    return cleaned;
  }
  return obj;
}

export const mongoSanitize = (req: Request, _res: Response, next: NextFunction): void => {
  if (req.body) req.body = stripMongoOperators(req.body);
  if (req.query) req.query = stripMongoOperators(req.query);
  if (req.params) req.params = stripMongoOperators(req.params);
  next();
};

export const validate = (validations: ValidationChain[]) => {
  return async (req: Request, res: Response<ApiResponse>, next: NextFunction): Promise<void> => {
    // Run all validations
    await Promise.all(validations.map((validation) => validation.run(req)));

    const errors = validationResult(req);
    
    if (errors.isEmpty()) {
      return next();
    }

    const extractedErrors: any[] = [];
    errors.array().forEach((err: any) => {
      extractedErrors.push({ field: err.path, message: err.msg });
    });

    const firstMessage = extractedErrors[0]?.message || 'Validation failed';

    logger.warn('Validation failed', {
      method: req.method,
      path: req.path,
      errors: extractedErrors,
    });

    res.status(400).json({
      success: false,
      message: firstMessage,
      error: JSON.stringify(extractedErrors),
    });
  };
};
