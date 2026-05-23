"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.initializeSocket = exports.isUserOnline = exports.getOnlineUsers = void 0;
const socket_io_1 = require("socket.io");
const jwt_1 = require("../utils/jwt");
const message_service_1 = require("../services/message.service");
const logger_1 = require("../utils/logger");
const User_1 = __importDefault(require("../models/User"));
// Track online users: userId -> Set of socketIds (supports multiple devices)
const onlineUsers = new Map();
const getOnlineUsers = () => onlineUsers;
exports.getOnlineUsers = getOnlineUsers;
const isUserOnline = (userId) => {
    const sockets = onlineUsers.get(userId);
    return !!sockets && sockets.size > 0;
};
exports.isUserOnline = isUserOnline;
const initializeSocket = (server) => {
    const io = new socket_io_1.Server(server, {
        cors: {
            origin: process.env.FRONTEND_URL || '*',
            methods: ['GET', 'POST'],
            credentials: true,
        },
        // Higher timeouts for mobile networks (MTN/Airtel) — they frequently
        // drop and re-establish connections; 60s timeout caused false disconnects
        pingTimeout: 120000,
        pingInterval: 30000,
    });
    // Authentication middleware — verify JWT on connection
    io.use(async (socket, next) => {
        try {
            const token = socket.handshake.auth.token || socket.handshake.query.token;
            if (!token) {
                return next(new Error('Authentication required'));
            }
            const decoded = (0, jwt_1.verifyAccessToken)(token);
            // Re-validate user status against DB — catches suspended/deleted accounts
            const dbUser = await User_1.default.findById(decoded.id).select('status role').lean();
            if (!dbUser || dbUser.status === 'suspended' || dbUser.status === 'inactive') {
                return next(new Error('Account is suspended or inactive'));
            }
            socket.user = {
                id: decoded.id,
                email: decoded.email,
                role: dbUser.role,
            };
            next();
        }
        catch (error) {
            next(new Error('Invalid or expired token'));
        }
    });
    io.on('connection', (socket) => {
        const user = socket.user;
        const userId = user.id;
        logger_1.logger.info(`Socket connected: ${userId} (${socket.id})`);
        // Track online status
        if (!onlineUsers.has(userId)) {
            onlineUsers.set(userId, new Set());
        }
        onlineUsers.get(userId).add(socket.id);
        // Join user's personal room for direct notifications
        socket.join(`user_${userId}`);
        // Broadcast online status to all connected clients
        io.emit('user_online', { userId });
        // ========================================================
        // JOIN CONVERSATION
        // ========================================================
        socket.on('join_conversation', (data) => {
            const { conversationId } = data;
            if (conversationId) {
                socket.join(conversationId);
                logger_1.logger.info(`User ${userId} joined conversation ${conversationId}`);
            }
        });
        // ========================================================
        // LEAVE CONVERSATION
        // ========================================================
        socket.on('leave_conversation', (data) => {
            const { conversationId } = data;
            if (conversationId) {
                socket.leave(conversationId);
            }
        });
        // ========================================================
        // SEND MESSAGE (via WebSocket)
        // ========================================================
        socket.on('send_message', async (data) => {
            try {
                const { receiverId, message, messageType, fileUrl, orderId } = data;
                if (!receiverId || (!message && messageType !== 'image' && messageType !== 'file')) {
                    socket.emit('error', { message: 'Receiver ID and message are required' });
                    return;
                }
                const result = await message_service_1.messageService.sendMessage(userId, receiverId, message || '', messageType || 'text', fileUrl, orderId);
                const { conversationId } = result;
                // Emit to conversation room
                io.to(conversationId).emit('new_message', {
                    message: result.message,
                    conversationId,
                });
                // Emit to receiver's personal room
                io.to(`user_${receiverId}`).emit('new_message_notification', {
                    message: result.message,
                    conversationId,
                });
            }
            catch (error) {
                logger_1.logger.error('Socket send_message error:', error.message);
                socket.emit('error', { message: 'Failed to send message' });
            }
        });
        // ========================================================
        // TYPING INDICATORS
        // ========================================================
        socket.on('typing', (data) => {
            const { conversationId, receiverId } = data;
            if (conversationId) {
                socket.to(conversationId).emit('typing', {
                    userId,
                    conversationId,
                });
            }
            if (receiverId) {
                io.to(`user_${receiverId}`).emit('typing', {
                    userId,
                    conversationId,
                });
            }
        });
        socket.on('stop_typing', (data) => {
            const { conversationId, receiverId } = data;
            if (conversationId) {
                socket.to(conversationId).emit('stop_typing', {
                    userId,
                    conversationId,
                });
            }
            if (receiverId) {
                io.to(`user_${receiverId}`).emit('stop_typing', {
                    userId,
                    conversationId,
                });
            }
        });
        // ========================================================
        // MARK MESSAGES AS READ
        // ========================================================
        socket.on('mark_read', async (data) => {
            try {
                const { conversationId } = data;
                if (!conversationId)
                    return;
                await message_service_1.messageService.markAsRead(conversationId, userId);
                // Notify the other user that messages were read
                io.to(conversationId).emit('messages_read', {
                    conversationId,
                    readBy: userId,
                    readAt: new Date(),
                });
            }
            catch (error) {
                logger_1.logger.error('Socket mark_read error:', error.message);
            }
        });
        // ========================================================
        // GET ONLINE STATUS
        // ========================================================
        socket.on('check_online', (data) => {
            const { userIds } = data;
            if (!userIds || !Array.isArray(userIds))
                return;
            const statuses = {};
            userIds.forEach((id) => {
                statuses[id] = (0, exports.isUserOnline)(id);
            });
            socket.emit('online_status', statuses);
        });
        // ========================================================
        // DISCONNECT
        // ========================================================
        socket.on('disconnect', () => {
            logger_1.logger.info(`Socket disconnected: ${userId} (${socket.id})`);
            // Remove socket from online tracking
            const userSockets = onlineUsers.get(userId);
            if (userSockets) {
                userSockets.delete(socket.id);
                if (userSockets.size === 0) {
                    onlineUsers.delete(userId);
                    // Broadcast offline status only when all sockets disconnected
                    io.emit('user_offline', { userId });
                }
            }
        });
    });
    logger_1.logger.info('Socket.io initialized');
    return io;
};
exports.initializeSocket = initializeSocket;
//# sourceMappingURL=socket.js.map