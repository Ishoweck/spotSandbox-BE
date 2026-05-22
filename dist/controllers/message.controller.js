"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.messageController = exports.MessageController = void 0;
const message_service_1 = require("../services/message.service");
const ticket_service_1 = require("../services/ticket.service");
const error_1 = require("../middleware/error");
const logger_1 = require("../utils/logger");
const User_1 = __importDefault(require("../models/User"));
class MessageController {
    /**
     * Send a message
     * POST /messages/send
     */
    async sendMessage(req, res) {
        const senderId = req.user.id;
        const { receiverId, message, messageType, fileUrl, orderId, replyTo } = req.body;
        if (!receiverId) {
            throw new error_1.AppError('Receiver ID is required', 400);
        }
        if (!message && messageType === 'text') {
            throw new error_1.AppError('Message content is required', 400);
        }
        if ((messageType === 'image' || messageType === 'file') && !fileUrl) {
            throw new error_1.AppError('File URL is required for image/file messages', 400);
        }
        if (senderId === receiverId) {
            throw new error_1.AppError('Cannot send message to yourself', 400);
        }
        // Verify receiver exists
        const receiver = await User_1.default.findById(receiverId);
        if (!receiver) {
            throw new error_1.AppError('Receiver not found', 404);
        }
        const result = await message_service_1.messageService.sendMessage(senderId, receiverId, message || '', messageType || 'text', fileUrl, orderId, undefined, replyTo);
        // Emit via socket if available
        const io = req.app.get('io');
        if (io) {
            const { conversationId } = result;
            // Emit to the conversation room
            io.to(conversationId).emit('new_message', {
                message: result.message,
                conversationId,
            });
            // Also emit to receiver's personal room in case they haven't joined the conversation room yet
            io.to(`user_${receiverId}`).emit('new_message_notification', {
                message: result.message,
                conversationId,
            });
        }
        res.status(201).json({
            success: true,
            message: 'Message sent successfully',
            data: {
                message: result.message,
                conversationId: result.conversationId,
            },
        });
    }
    /**
     * Admin: Send message AS the shared support user (so all admins reply in the same thread)
     * POST /messages/admin/send
     */
    async adminSendMessage(req, res) {
        const adminId = req.user.id;
        const { receiverId, message, messageType, fileUrl } = req.body;
        if (!receiverId || !message) {
            throw new error_1.AppError('Receiver ID and message are required', 400);
        }
        // Find the support user (first active admin/super_admin)
        const supportUser = await User_1.default.findOne({
            role: { $in: ['admin', 'super_admin'] },
            status: 'active',
        }).select('_id');
        if (!supportUser) {
            throw new error_1.AppError('Support user not found', 500);
        }
        const supportUserId = supportUser._id.toString();
        if (supportUserId === receiverId) {
            throw new error_1.AppError('Cannot send message to support account', 400);
        }
        // Verify receiver exists
        const receiver = await User_1.default.findById(receiverId);
        if (!receiver) {
            throw new error_1.AppError('Receiver not found', 404);
        }
        // Enforce active session ownership
        const Conversation = require('../models/Conversation').default;
        const conv = await Conversation.findOne({
            participants: { $all: [supportUserId, receiverId], $size: 2 },
        });
        if (conv) {
            const activeSession = await message_service_1.messageService.getActiveSession(conv._id.toString());
            if (activeSession && activeSession.adminId.toString() !== adminId) {
                throw new error_1.AppError(`${activeSession.adminName} is currently handling this conversation`, 403);
            }
            if (activeSession && activeSession.adminId.toString() === adminId) {
                await message_service_1.messageService.updateSessionActivity(conv._id.toString(), adminId);
            }
        }
        // Send message AS the support user (not the currently logged-in admin)
        const result = await message_service_1.messageService.sendMessage(supportUserId, receiverId, message, messageType || 'text', fileUrl, undefined, 'VendorSpot Support');
        // Emit via socket
        const io = req.app.get('io');
        if (io) {
            const { conversationId } = result;
            io.to(conversationId).emit('new_message', {
                message: result.message,
                conversationId,
            });
            io.to(`user_${receiverId}`).emit('new_message_notification', {
                message: result.message,
                conversationId,
            });
        }
        res.status(201).json({
            success: true,
            message: 'Message sent as support',
            data: result,
        });
    }
    /**
     * Admin: Start or resume a support session for a conversation
     * POST /messages/admin/sessions/start
     */
    async startAdminSession(req, res) {
        const adminId = req.user.id;
        const { conversationObjectId } = req.body;
        if (!conversationObjectId) {
            throw new error_1.AppError('conversationObjectId is required', 400);
        }
        const admin = await User_1.default.findById(adminId).select('firstName lastName');
        if (!admin)
            throw new error_1.AppError('Admin not found', 404);
        const adminName = `${admin.firstName} ${admin.lastName}`;
        const Conversation = require('../models/Conversation').default;
        const conv = await Conversation.findById(conversationObjectId).populate('participants', '_id role');
        if (!conv)
            throw new error_1.AppError('Conversation not found', 404);
        // Identify the non-admin participant (the user)
        const adminRoles = ['admin', 'super_admin', 'financial_admin'];
        const userParticipant = conv.participants.find((p) => !adminRoles.includes(p.role));
        if (!userParticipant)
            throw new error_1.AppError('Could not identify user in this conversation', 400);
        const userId = userParticipant._id.toString();
        const [p1, p2] = conv.participants.map((p) => p._id.toString());
        const conversationId = message_service_1.messageService.generateConversationId(p1, p2);
        const result = await message_service_1.messageService.startSession(conversationObjectId, adminId, adminName, userId, conversationId);
        if (result.blocked) {
            throw new error_1.AppError(`${result.blockedBy} is currently handling this conversation`, 409);
        }
        if (result.isNew) {
            // Insert a system message so both parties see the join event
            const { ChatMessage } = require('../models/Additional');
            const sysMsg = await ChatMessage.create({
                conversationId,
                sender: adminId,
                receiver: userId,
                message: `Hi! I'm ${admin.firstName} from VendorSpot Support. I'm here to help you today. How can I assist you?`,
                messageType: 'text',
            });
            const populated = await ChatMessage.findById(sysMsg._id)
                .populate('sender', 'firstName lastName avatar role')
                .populate('receiver', 'firstName lastName avatar role');
            const io = req.app.get('io');
            if (io) {
                io.to(conversationId).emit('new_message', { message: populated, conversationId });
                io.to(`user_${userId}`).emit('new_message_notification', { message: populated, conversationId });
                io.to(conversationId).emit('admin_session_started', {
                    session: result.session,
                    adminName,
                    conversationId,
                });
                io.to(`user_${userId}`).emit('admin_session_started', {
                    adminName,
                    conversationId,
                });
            }
        }
        res.json({ success: true, data: { session: result.session, isNew: result.isNew } });
    }
    /**
     * Admin: End an active support session
     * POST /messages/admin/sessions/end
     */
    async endAdminSession(req, res) {
        const adminId = req.user.id;
        const { sessionId } = req.body;
        if (!sessionId)
            throw new error_1.AppError('sessionId is required', 400);
        const session = await message_service_1.messageService.endSession(sessionId, adminId);
        if (!session)
            throw new error_1.AppError('Session not found or already ended', 404);
        // Insert a system message
        const { ChatMessage } = require('../models/Additional');
        const sysMsg = await ChatMessage.create({
            conversationId: session.conversationId,
            sender: adminId,
            receiver: session.userId,
            message: `${session.adminName} has ended the session.`,
            messageType: 'system',
        });
        const populated = await ChatMessage.findById(sysMsg._id)
            .populate('sender', 'firstName lastName avatar role')
            .populate('receiver', 'firstName lastName avatar role');
        const io = req.app.get('io');
        if (io) {
            const { conversationId } = session;
            io.to(conversationId).emit('new_message', { message: populated, conversationId });
            io.to(`user_${session.userId}`).emit('new_message_notification', { message: populated, conversationId });
            io.to(conversationId).emit('admin_session_ended', {
                sessionId,
                adminName: session.adminName,
                conversationId,
            });
            io.to(`user_${session.userId}`).emit('admin_session_ended', {
                adminName: session.adminName,
                conversationId,
            });
        }
        // Auto-create ticket with AI summary (non-blocking — session end succeeds regardless)
        ticket_service_1.ticketService.createFromSession({
            sessionId: session._id.toString(),
            userId: session.userId.toString(),
            adminId: adminId,
            conversationId: session.conversationId,
            startedAt: session.startedAt,
            endedAt: session.endedAt,
        }).then((ticket) => {
            logger_1.logger.info(`Ticket ${ticket.ticketId} created for session ${session._id}`);
        }).catch((err) => {
            logger_1.logger.error('Auto ticket creation failed:', err.message);
        });
        res.json({ success: true, message: 'Session ended' });
    }
    /**
     * Admin: Get active session status for a conversation
     * GET /messages/admin/sessions/:conversationObjectId
     */
    async getAdminSession(req, res) {
        const { conversationObjectId } = req.params;
        const session = await message_service_1.messageService.getActiveSession(conversationObjectId);
        res.json({ success: true, data: session });
    }
    /**
     * Admin: Get messages in any conversation (no sender/receiver filter)
     * GET /messages/admin/conversations/:conversationId
     */
    async getAdminMessages(req, res) {
        const { conversationId: convObjectId } = req.params;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 50;
        const skip = (page - 1) * limit;
        const ChatMessage = require('../models/Additional').ChatMessage;
        const Conversation = require('../models/Conversation').default;
        // Conversation._id is a MongoDB ObjectId, but ChatMessage.conversationId
        // is the generated string "sortedId1_sortedId2". Translate before querying.
        const conv = await Conversation.findById(convObjectId);
        if (!conv) {
            throw new error_1.AppError('Conversation not found', 404);
        }
        const [p1, p2] = conv.participants.map((p) => p.toString());
        const conversationId = message_service_1.messageService.generateConversationId(p1, p2);
        const messages = await ChatMessage.find({
            conversationId,
            deleted: { $ne: true },
        })
            .populate('sender', 'firstName lastName avatar role')
            .populate('receiver', 'firstName lastName avatar role')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);
        const total = await ChatMessage.countDocuments({
            conversationId,
            deleted: { $ne: true },
        });
        res.json({
            success: true,
            data: messages.reverse(),
            meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
        });
    }
    /**
     * Admin: Mark all messages in a conversation as read (any admin receiver)
     * PUT /messages/admin/conversations/:conversationId/read
     */
    async adminMarkAsRead(req, res) {
        const { conversationId: convObjectId } = req.params;
        const ChatMessage = require('../models/Additional').ChatMessage;
        const Conversation = require('../models/Conversation').default;
        const conv = await Conversation.findById(convObjectId);
        if (!conv)
            throw new error_1.AppError('Conversation not found', 404);
        const [p1, p2] = conv.participants.map((p) => p.toString());
        const conversationId = message_service_1.messageService.generateConversationId(p1, p2);
        // Find all admin IDs so we can mark any message addressed to any admin as read
        const adminUsers = await User_1.default.find({
            role: { $in: ['admin', 'super_admin', 'financial_admin'] },
        }).select('_id');
        const adminIds = adminUsers.map((u) => u._id);
        await ChatMessage.updateMany({ conversationId, receiver: { $in: adminIds }, read: false }, { read: true, readAt: new Date() });
        // Reset unread count for all admin participants in this conversation
        for (const participantId of conv.participants.map((p) => p.toString())) {
            if (adminIds.map((id) => id.toString()).includes(participantId)) {
                conv.unreadCount.set(participantId, 0);
            }
        }
        await conv.save();
        res.json({ success: true, message: 'Marked as read' });
    }
    /**
     * Admin: Get ALL support conversations (any conversation involving any admin/super_admin)
     * GET /messages/admin/conversations
     */
    async getAdminConversations(req, res) {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 50;
        const skip = (page - 1) * limit;
        // Find all admin/super_admin user IDs (any status, not just active)
        const adminUsers = await User_1.default.find({
            role: { $in: ['admin', 'super_admin', 'financial_admin'] },
        }).select('_id role');
        const adminIds = adminUsers.map((u) => u._id);
        console.log(`[Admin Chat] Found ${adminUsers.length} admin users:`, adminUsers.map(u => ({ id: u._id, role: u.role })));
        // Find conversations where ANY admin is a participant
        const Conversation = require('../models/Conversation').default;
        // First try with isActive, then fallback without it
        let conversations = await Conversation.find({
            participants: { $in: adminIds },
            isActive: true,
        })
            .populate('participants', 'firstName lastName avatar email role')
            .sort({ updatedAt: -1 })
            .skip(skip)
            .limit(limit);
        let total = await Conversation.countDocuments({
            participants: { $in: adminIds },
            isActive: true,
        });
        // If no active conversations, try without isActive filter (some may not have this field)
        if (total === 0) {
            conversations = await Conversation.find({
                participants: { $in: adminIds },
            })
                .populate('participants', 'firstName lastName avatar email role')
                .sort({ updatedAt: -1 })
                .skip(skip)
                .limit(limit);
            total = await Conversation.countDocuments({
                participants: { $in: adminIds },
            });
            console.log(`[Admin Chat] No active conversations, found ${total} total (without isActive filter)`);
        }
        console.log(`[Admin Chat] Found ${total} conversations`);
        // Format: show the non-admin participant as the "other"
        const adminIdStrings = adminIds.map((id) => id.toString());
        const formatted = conversations.map((conv) => {
            const otherParticipant = conv.participants.find((p) => !adminIdStrings.includes(p._id.toString())) || conv.participants[0];
            // Sum unread counts for all admin participants
            const unreadCount = adminIdStrings.reduce((sum, adminId) => {
                return sum + (conv.unreadCount?.get ? (conv.unreadCount.get(adminId) || 0) : 0);
            }, 0);
            // Generate the string conversationId (used for socket rooms and ChatMessage queries)
            const participantIds = conv.participants.map((p) => p._id.toString());
            const conversationId = message_service_1.messageService.generateConversationId(participantIds[0], participantIds[1]);
            return {
                _id: conv._id,
                conversationId,
                otherParticipant,
                participants: conv.participants,
                lastMessage: conv.lastMessage ? {
                    message: conv.lastMessage.text || conv.lastMessage.message || '',
                    sender: conv.lastMessage.sender,
                    createdAt: conv.lastMessage.timestamp || conv.lastMessage.createdAt || conv.updatedAt,
                } : null,
                unreadCount,
                updatedAt: conv.updatedAt,
            };
        });
        res.json({
            success: true,
            data: formatted,
            meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
        });
    }
    /**
     * Get user's conversations
     * GET /messages/conversations
     */
    async getConversations(req, res) {
        const userId = req.user.id;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const result = await message_service_1.messageService.getConversations(userId, page, limit);
        res.json({
            success: true,
            data: result.conversations,
            meta: {
                page: result.page,
                limit,
                total: result.total,
                totalPages: result.totalPages,
            },
        });
    }
    /**
     * Get messages in a conversation
     * GET /messages/conversations/:conversationId
     */
    async getMessages(req, res) {
        const userId = req.user.id;
        const { conversationId } = req.params;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 50;
        if (!conversationId) {
            throw new error_1.AppError('Conversation ID is required', 400);
        }
        const result = await message_service_1.messageService.getMessages(conversationId, userId, page, limit);
        res.json({
            success: true,
            data: result.messages,
            meta: {
                page: result.page,
                limit,
                total: result.total,
                totalPages: result.totalPages,
            },
        });
    }
    /**
     * Mark all messages in a conversation as read
     * PUT /messages/conversations/:conversationId/read
     */
    async markAsRead(req, res) {
        const userId = req.user.id;
        const { conversationId } = req.params;
        if (!conversationId) {
            throw new error_1.AppError('Conversation ID is required', 400);
        }
        const result = await message_service_1.messageService.markAsRead(conversationId, userId);
        // Emit read receipt via socket
        const io = req.app.get('io');
        if (io) {
            io.to(conversationId).emit('messages_read', {
                conversationId,
                readBy: userId,
                readAt: new Date(),
            });
        }
        res.json({
            success: true,
            message: 'Messages marked as read',
            data: { markedCount: result.markedCount },
        });
    }
    /**
     * Delete a message
     * DELETE /messages/:messageId
     */
    async deleteMessage(req, res) {
        const userId = req.user.id;
        const { messageId } = req.params;
        const message = await message_service_1.messageService.deleteMessage(messageId, userId);
        if (!message) {
            throw new error_1.AppError('Message not found or you are not the sender', 404);
        }
        // Emit deletion via socket
        const io = req.app.get('io');
        if (io) {
            io.to(message.conversationId).emit('message_deleted', {
                messageId,
                conversationId: message.conversationId,
            });
        }
        res.json({
            success: true,
            message: 'Message deleted',
        });
    }
    /**
     * Get total unread message count
     * GET /messages/unread-count
     */
    async getUnreadCount(req, res) {
        const userId = req.user.id;
        const count = await message_service_1.messageService.getUnreadCount(userId);
        res.json({
            success: true,
            data: { unreadCount: count },
        });
    }
    /**
     * Start or get a conversation with a specific user
     * POST /messages/conversations/start
     */
    async startConversation(req, res) {
        const userId = req.user.id;
        const { receiverId, orderId } = req.body;
        if (!receiverId) {
            throw new error_1.AppError('Receiver ID is required', 400);
        }
        if (userId === receiverId) {
            throw new error_1.AppError('Cannot start a conversation with yourself', 400);
        }
        // Verify receiver exists
        const receiver = await User_1.default.findById(receiverId).select('firstName lastName avatar role');
        if (!receiver) {
            throw new error_1.AppError('User not found', 404);
        }
        const { conversation, conversationId } = await message_service_1.messageService.getOrCreateConversation(userId, receiverId, orderId);
        res.json({
            success: true,
            data: {
                conversationId,
                conversation,
                otherParticipant: receiver,
            },
        });
    }
}
exports.MessageController = MessageController;
exports.messageController = new MessageController();
//# sourceMappingURL=message.controller.js.map