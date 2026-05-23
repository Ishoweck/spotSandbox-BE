import { Server as SocketServer } from 'socket.io';
import http from 'http';
import { verifyAccessToken } from '../utils/jwt';
import { messageService } from '../services/message.service';
import { logger } from '../utils/logger';
import User from '../models/User';

// Track online users: userId -> Set of socketIds (supports multiple devices)
const onlineUsers = new Map<string, Set<string>>();

export const getOnlineUsers = () => onlineUsers;

export const isUserOnline = (userId: string): boolean => {
  const sockets = onlineUsers.get(userId);
  return !!sockets && sockets.size > 0;
};

export const initializeSocket = (server: http.Server): SocketServer => {
  const io = new SocketServer(server, {
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

      const decoded = verifyAccessToken(token as string);

      // Re-validate user status against DB — catches suspended/deleted accounts
      const dbUser = await User.findById(decoded.id).select('status role').lean();
      if (!dbUser || dbUser.status === 'suspended' || dbUser.status === 'inactive') {
        return next(new Error('Account is suspended or inactive'));
      }

      (socket as any).user = {
        id: decoded.id,
        email: decoded.email,
        role: dbUser.role,
      };

      next();
    } catch (error) {
      next(new Error('Invalid or expired token'));
    }
  });

  io.on('connection', (socket) => {
    const user = (socket as any).user;
    const userId = user.id;

    logger.info(`Socket connected: ${userId} (${socket.id})`);

    // Track online status
    if (!onlineUsers.has(userId)) {
      onlineUsers.set(userId, new Set());
    }
    onlineUsers.get(userId)!.add(socket.id);

    // Join user's personal room for direct notifications
    socket.join(`user_${userId}`);

    // Broadcast online status to all connected clients
    io.emit('user_online', { userId });

    // ========================================================
    // JOIN CONVERSATION
    // ========================================================
    socket.on('join_conversation', (data: { conversationId: string }) => {
      const { conversationId } = data;
      if (conversationId) {
        socket.join(conversationId);
        logger.info(`User ${userId} joined conversation ${conversationId}`);
      }
    });

    // ========================================================
    // LEAVE CONVERSATION
    // ========================================================
    socket.on('leave_conversation', (data: { conversationId: string }) => {
      const { conversationId } = data;
      if (conversationId) {
        socket.leave(conversationId);
      }
    });

    // ========================================================
    // SEND MESSAGE (via WebSocket)
    // ========================================================
    socket.on('send_message', async (data: {
      receiverId: string;
      message: string;
      messageType?: 'text' | 'image' | 'file';
      fileUrl?: string;
      orderId?: string;
    }) => {
      try {
        const { receiverId, message, messageType, fileUrl, orderId } = data;

        if (!receiverId || (!message && messageType !== 'image' && messageType !== 'file')) {
          socket.emit('error', { message: 'Receiver ID and message are required' });
          return;
        }

        const result = await messageService.sendMessage(
          userId,
          receiverId,
          message || '',
          messageType || 'text',
          fileUrl,
          orderId
        );

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
      } catch (error: any) {
        logger.error('Socket send_message error:', error.message);
        socket.emit('error', { message: 'Failed to send message' });
      }
    });

    // ========================================================
    // TYPING INDICATORS
    // ========================================================
    socket.on('typing', (data: { conversationId: string; receiverId: string }) => {
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

    socket.on('stop_typing', (data: { conversationId: string; receiverId: string }) => {
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
    socket.on('mark_read', async (data: { conversationId: string }) => {
      try {
        const { conversationId } = data;
        if (!conversationId) return;

        await messageService.markAsRead(conversationId, userId);

        // Notify the other user that messages were read
        io.to(conversationId).emit('messages_read', {
          conversationId,
          readBy: userId,
          readAt: new Date(),
        });
      } catch (error: any) {
        logger.error('Socket mark_read error:', error.message);
      }
    });

    // ========================================================
    // GET ONLINE STATUS
    // ========================================================
    socket.on('check_online', (data: { userIds: string[] }) => {
      const { userIds } = data;
      if (!userIds || !Array.isArray(userIds)) return;

      const statuses: Record<string, boolean> = {};
      userIds.forEach((id) => {
        statuses[id] = isUserOnline(id);
      });

      socket.emit('online_status', statuses);
    });

    // ========================================================
    // DISCONNECT
    // ========================================================
    socket.on('disconnect', () => {
      logger.info(`Socket disconnected: ${userId} (${socket.id})`);

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

  logger.info('Socket.io initialized');
  return io;
};
