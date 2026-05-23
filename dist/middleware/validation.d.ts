import { Request, Response, NextFunction } from 'express';
import { ValidationChain } from 'express-validator';
import { ApiResponse } from '../types';
export declare const mongoSanitize: (req: Request, _res: Response, next: NextFunction) => void;
export declare const validate: (validations: ValidationChain[]) => (req: Request, res: Response<ApiResponse>, next: NextFunction) => Promise<void>;
//# sourceMappingURL=validation.d.ts.map