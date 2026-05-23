import { Response } from 'express';
import { AuthRequest, ApiResponse } from '../types';
declare class AIChatController {
    adminSuggest(req: AuthRequest, res: Response<ApiResponse>): Promise<void>;
    chat(req: AuthRequest, res: Response<ApiResponse>): Promise<void>;
}
export declare const aiChatController: AIChatController;
export {};
//# sourceMappingURL=ai-chat.controller.d.ts.map