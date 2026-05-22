declare class MessageService {
    /**
     * Generate a deterministic conversationId from two user IDs
     */
    generateConversationId(userId1: string, userId2: string): string;
    /**
     * Get or create a conversation between two users
     */
    getOrCreateConversation(userId1: string, userId2: string, orderId?: string): Promise<{
        conversation: import("mongoose").Document<unknown, {}, import("../models/Conversation").IConversation, {}, {}> & import("../models/Conversation").IConversation & Required<{
            _id: import("mongoose").Types.ObjectId;
        }> & {
            __v: number;
        };
        conversationId: string;
    }>;
    /**
     * Send a message
     */
    sendMessage(senderId: string, receiverId: string, message: string, messageType?: 'text' | 'image' | 'file', fileUrl?: string, orderId?: string, senderDisplayName?: string, replyTo?: {
        messageId: string;
        message: string;
        senderName: string;
        messageType: string;
    }): Promise<{
        message: import("mongoose").Document<unknown, {}, import("../models/Additional").IChatMessage, {}, {}> & import("../models/Additional").IChatMessage & Required<{
            _id: import("mongoose").Types.ObjectId;
        }> & {
            __v: number;
        };
        conversationId: string;
        conversation: import("mongoose").Document<unknown, {}, import("../models/Conversation").IConversation, {}, {}> & import("../models/Conversation").IConversation & Required<{
            _id: import("mongoose").Types.ObjectId;
        }> & {
            __v: number;
        };
    }>;
    /**
     * Get conversations for a user (excludes support/admin conversations)
     */
    getConversations(userId: string, page?: number, limit?: number): Promise<{
        conversations: {
            _id: import("mongoose").Types.ObjectId;
            conversationId: string;
            otherParticipant: import("mongoose").Types.ObjectId;
            lastMessage: {
                text: string;
                sender: import("mongoose").Types.ObjectId;
                timestamp: Date;
                messageType: "text" | "image" | "file";
            };
            unreadCount: number;
            orderId: import("mongoose").Types.ObjectId;
            isActive: boolean;
            updatedAt: any;
        }[];
        total: number;
        page: number;
        totalPages: number;
    }>;
    /**
     * Get messages for a conversation
     */
    getMessages(conversationId: string, userId: string, page?: number, limit?: number): Promise<{
        messages: (import("mongoose").Document<unknown, {}, import("../models/Additional").IChatMessage, {}, {}> & import("../models/Additional").IChatMessage & Required<{
            _id: import("mongoose").Types.ObjectId;
        }> & {
            __v: number;
        })[];
        total: number;
        page: number;
        totalPages: number;
    }>;
    /**
     * Mark messages as read in a conversation
     */
    markAsRead(conversationId: string, userId: string): Promise<{
        markedCount: number;
    }>;
    /**
     * Delete a message (soft delete)
     */
    deleteMessage(messageId: string, userId: string): Promise<import("mongoose").Document<unknown, {}, import("../models/Additional").IChatMessage, {}, {}> & import("../models/Additional").IChatMessage & Required<{
        _id: import("mongoose").Types.ObjectId;
    }> & {
        __v: number;
    }>;
    /**
     * Get total unread message count across all conversations
     */
    getUnreadCount(userId: string): Promise<number>;
    /**
     * Get a single conversation by its generated ID and user
     */
    getConversationByParticipants(userId1: string, userId2: string): Promise<import("mongoose").Document<unknown, {}, import("../models/Conversation").IConversation, {}, {}> & import("../models/Conversation").IConversation & Required<{
        _id: import("mongoose").Types.ObjectId;
    }> & {
        __v: number;
    }>;
    /**
     * Get the active support session for a conversation, auto-ending if timed out
     */
    getActiveSession(conversationObjectId: string): Promise<import("mongoose").Document<unknown, {}, import("../models/SupportSession").ISupportSession, {}, {}> & import("../models/SupportSession").ISupportSession & Required<{
        _id: import("mongoose").Types.ObjectId;
    }> & {
        __v: number;
    }>;
    /**
     * Start or resume a support session for an admin
     * Returns { session, isNew, blocked, blockedBy }
     */
    startSession(conversationObjectId: string, adminId: string, adminName: string, userId: string, conversationId: string): Promise<{
        session: import("mongoose").Document<unknown, {}, import("../models/SupportSession").ISupportSession, {}, {}> & import("../models/SupportSession").ISupportSession & Required<{
            _id: import("mongoose").Types.ObjectId;
        }> & {
            __v: number;
        };
        isNew: boolean;
        blocked: boolean;
        blockedBy: any;
    } | {
        session: any;
        isNew: boolean;
        blocked: boolean;
        blockedBy: string;
    }>;
    /**
     * End an active session (only the owning admin can end it)
     */
    endSession(sessionId: string, adminId: string): Promise<import("mongoose").Document<unknown, {}, import("../models/SupportSession").ISupportSession, {}, {}> & import("../models/SupportSession").ISupportSession & Required<{
        _id: import("mongoose").Types.ObjectId;
    }> & {
        __v: number;
    }>;
    /**
     * Bump lastActivityAt on an active session when admin sends a message
     */
    updateSessionActivity(conversationObjectId: string, adminId: string): Promise<import("mongoose").Document<unknown, {}, import("../models/SupportSession").ISupportSession, {}, {}> & import("../models/SupportSession").ISupportSession & Required<{
        _id: import("mongoose").Types.ObjectId;
    }> & {
        __v: number;
    }>;
}
export declare const messageService: MessageService;
export {};
//# sourceMappingURL=message.service.d.ts.map