"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.messageService = void 0;
const Additional_1 = require("../models/Additional");
const Conversation_1 = __importDefault(require("../models/Conversation"));
const User_1 = __importDefault(require("../models/User"));
const SupportSession_1 = __importDefault(require("../models/SupportSession"));
const types_1 = require("../types");
const notification_service_1 = require("./notification.service");
const logger_1 = require("../utils/logger");
class MessageService {
    /**
     * Generate a deterministic conversationId from two user IDs
     */
    generateConversationId(userId1, userId2) {
        return [userId1, userId2].sort().join('_');
    }
    /**
     * Get or create a conversation between two users
     */
    async getOrCreateConversation(userId1, userId2, orderId) {
        const conversationId = this.generateConversationId(userId1, userId2);
        let conversation = await Conversation_1.default.findOne({
            participants: { $all: [userId1, userId2], $size: 2 },
        });
        if (!conversation) {
            conversation = await Conversation_1.default.create({
                participants: [userId1, userId2],
                unreadCount: new Map([[userId1, 0], [userId2, 0]]),
                ...(orderId && { orderId }),
            });
        }
        else if (!conversation.isActive) {
            // Re-activate a previously closed conversation (e.g. new order after a completed one)
            conversation.isActive = true;
            if (orderId)
                conversation.orderId = orderId;
            await conversation.save();
        }
        return { conversation, conversationId };
    }
    /**
     * Send a message
     */
    async sendMessage(senderId, receiverId, message, messageType = 'text', fileUrl, orderId, senderDisplayName, replyTo) {
        const { conversation, conversationId } = await this.getOrCreateConversation(senderId, receiverId, orderId);
        // Create the chat message
        const chatMessage = await Additional_1.ChatMessage.create({
            conversationId,
            sender: senderId,
            receiver: receiverId,
            message,
            messageType,
            fileUrl,
            orderId,
            ...(replyTo && { replyTo }),
        });
        // Update conversation with last message
        const currentUnread = conversation.unreadCount.get(receiverId) || 0;
        conversation.unreadCount.set(receiverId, currentUnread + 1);
        conversation.lastMessage = {
            text: messageType === 'text' ? message : `Sent ${messageType === 'image' ? 'an image' : 'a file'}`,
            sender: chatMessage.sender,
            timestamp: new Date(),
            messageType,
        };
        await conversation.save();
        // Populate sender info for the response
        const populatedMessage = await Additional_1.ChatMessage.findById(chatMessage._id)
            .populate('sender', 'firstName lastName avatar')
            .populate('receiver', 'firstName lastName avatar');
        // Send push notification to receiver
        try {
            const sender = await User_1.default.findById(senderId).select('firstName lastName');
            const senderName = senderDisplayName || (sender ? `${sender.firstName} ${sender.lastName}` : 'Someone');
            const notifMessage = messageType === 'text'
                ? message.substring(0, 100)
                : `Sent ${messageType === 'image' ? 'an image' : 'a file'}`;
            await notification_service_1.notificationService.send({
                userId: receiverId,
                type: types_1.NotificationType.CHAT,
                title: `New message from ${senderName}`,
                message: notifMessage,
                data: { conversationId, senderId, senderName, messageId: chatMessage._id?.toString() },
                link: `/messages/${conversationId}`,
            });
        }
        catch (error) {
            logger_1.logger.error('Failed to send chat notification:', error.message);
        }
        return {
            message: populatedMessage,
            conversationId,
            conversation,
        };
    }
    /**
     * Get conversations for a user (excludes support/admin conversations)
     */
    async getConversations(userId, page = 1, limit = 20) {
        const skip = (page - 1) * limit;
        const adminUsers = await User_1.default.find({
            role: { $in: ['admin', 'super_admin', 'financial_admin'] },
        }).select('_id');
        const adminIds = adminUsers.map((u) => u._id);
        const baseQuery = {
            $and: [
                { participants: userId },
                ...(adminIds.length > 0 ? [{ participants: { $nin: adminIds } }] : []),
            ],
        };
        const conversations = await Conversation_1.default.find(baseQuery)
            .populate('participants', 'firstName lastName avatar role')
            .populate('orderId', 'orderNumber')
            .sort({ updatedAt: -1 })
            .skip(skip)
            .limit(limit);
        const total = await Conversation_1.default.countDocuments(baseQuery);
        // Add the other participant info and unread count for each conversation
        const formattedConversations = conversations.map((conv) => {
            const otherParticipant = conv.participants.find((p) => p._id.toString() !== userId);
            const unread = conv.unreadCount.get(userId) || 0;
            const conversationId = this.generateConversationId(conv.participants[0]._id.toString(), conv.participants[1]._id.toString());
            return {
                _id: conv._id,
                conversationId,
                otherParticipant,
                lastMessage: conv.lastMessage,
                unreadCount: unread,
                orderId: conv.orderId,
                isActive: conv.isActive,
                updatedAt: conv.updatedAt,
            };
        });
        return {
            conversations: formattedConversations,
            total,
            page,
            totalPages: Math.ceil(total / limit),
        };
    }
    /**
     * Get messages for a conversation
     */
    async getMessages(conversationId, userId, page = 1, limit = 50) {
        const skip = (page - 1) * limit;
        const messages = await Additional_1.ChatMessage.find({
            conversationId,
            deleted: { $ne: true },
            $or: [{ sender: userId }, { receiver: userId }],
        })
            .populate('sender', 'firstName lastName avatar')
            .populate('receiver', 'firstName lastName avatar')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);
        const total = await Additional_1.ChatMessage.countDocuments({
            conversationId,
            deleted: { $ne: true },
            $or: [{ sender: userId }, { receiver: userId }],
        });
        return {
            messages: messages.reverse(),
            total,
            page,
            totalPages: Math.ceil(total / limit),
        };
    }
    /**
     * Mark messages as read in a conversation
     */
    async markAsRead(conversationId, userId) {
        // Mark all unread messages sent TO this user as read
        const result = await Additional_1.ChatMessage.updateMany({
            conversationId,
            receiver: userId,
            read: false,
        }, {
            read: true,
            readAt: new Date(),
        });
        // Reset unread count for this user in the conversation
        // Extract the other user's ID from the conversationId (format: sortedId1_sortedId2)
        const ids = conversationId.split('_');
        const otherUserId = ids[0] === userId ? ids[1] : ids[0];
        if (otherUserId) {
            const conv = await Conversation_1.default.findOne({
                participants: { $all: [userId, otherUserId], $size: 2 },
            });
            if (conv) {
                conv.unreadCount.set(userId, 0);
                await conv.save();
            }
        }
        return { markedCount: result.modifiedCount };
    }
    /**
     * Delete a message (soft delete)
     */
    async deleteMessage(messageId, userId) {
        const message = await Additional_1.ChatMessage.findOne({
            _id: messageId,
            sender: userId,
        });
        if (!message) {
            return null;
        }
        message.deleted = true;
        message.deletedAt = new Date();
        await message.save();
        return message;
    }
    /**
     * Get total unread message count across all conversations
     */
    async getUnreadCount(userId) {
        const count = await Conversation_1.default.countDocuments({
            participants: userId,
            [`unreadCount.${userId}`]: { $gt: 0 },
        });
        return count;
    }
    /**
     * Get a single conversation by its generated ID and user
     */
    async getConversationByParticipants(userId1, userId2) {
        return Conversation_1.default.findOne({
            participants: { $all: [userId1, userId2], $size: 2 },
        });
    }
    /**
     * Get the active support session for a conversation, auto-ending if timed out
     */
    async getActiveSession(conversationObjectId) {
        const session = await SupportSession_1.default.findOne({ conversationObjectId, status: 'active' });
        if (!session)
            return null;
        const fifteenMins = 15 * 60 * 1000;
        if (Date.now() - session.lastActivityAt.getTime() > fifteenMins) {
            session.status = 'ended';
            session.endedAt = new Date();
            session.endReason = 'timeout';
            await session.save();
            return null;
        }
        return session;
    }
    /**
     * Start or resume a support session for an admin
     * Returns { session, isNew, blocked, blockedBy }
     */
    async startSession(conversationObjectId, adminId, adminName, userId, conversationId) {
        const existing = await SupportSession_1.default.findOne({ conversationObjectId, status: 'active' });
        if (existing) {
            const fifteenMins = 15 * 60 * 1000;
            if (Date.now() - existing.lastActivityAt.getTime() > fifteenMins) {
                existing.status = 'ended';
                existing.endedAt = new Date();
                existing.endReason = 'timeout';
                await existing.save();
                // Fall through to create a new session
            }
            else if (existing.adminId.toString() === adminId) {
                // Same admin resuming — just refresh activity
                existing.lastActivityAt = new Date();
                await existing.save();
                return { session: existing, isNew: false, blocked: false, blockedBy: null };
            }
            else {
                return { session: null, isNew: false, blocked: true, blockedBy: existing.adminName };
            }
        }
        const session = await SupportSession_1.default.create({
            conversationId,
            conversationObjectId,
            adminId,
            userId,
            adminName,
            status: 'active',
            startedAt: new Date(),
            lastActivityAt: new Date(),
        });
        return { session, isNew: true, blocked: false, blockedBy: null };
    }
    /**
     * End an active session (only the owning admin can end it)
     */
    async endSession(sessionId, adminId) {
        const session = await SupportSession_1.default.findOne({ _id: sessionId, adminId, status: 'active' });
        if (!session)
            return null;
        session.status = 'ended';
        session.endedAt = new Date();
        session.endReason = 'admin';
        await session.save();
        return session;
    }
    /**
     * Bump lastActivityAt on an active session when admin sends a message
     */
    async updateSessionActivity(conversationObjectId, adminId) {
        return SupportSession_1.default.findOneAndUpdate({ conversationObjectId, adminId, status: 'active' }, { lastActivityAt: new Date() }, { new: true });
    }
}
exports.messageService = new MessageService();
//# sourceMappingURL=message.service.js.map