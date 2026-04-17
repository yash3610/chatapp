import jwt from 'jsonwebtoken';
import Conversation from './models/Conversation.js';
import Message from './models/Message.js';
import User from './models/User.js';
import { buildParticipantKey, getOrCreateConversation } from './utils/conversation.js';

const onlineUsers = new Map();

const getOnlineUserIds = () => Array.from(onlineUsers.keys());

const addOnlineSocket = (userId, socketId) => {
  const existingSockets = onlineUsers.get(userId) || new Set();
  existingSockets.add(socketId);
  onlineUsers.set(userId, existingSockets);
};

const removeOnlineSocket = (userId, socketId) => {
  const existingSockets = onlineUsers.get(userId);
  if (!existingSockets) {
    return;
  }

  existingSockets.delete(socketId);
  if (existingSockets.size === 0) {
    onlineUsers.delete(userId);
    return;
  }

  onlineUsers.set(userId, existingSockets);
};

const isUserOnline = (userId) => onlineUsers.has(String(userId));

const getTokenFromSocket = (socket) => {
  if (socket.handshake.auth?.token) {
    return socket.handshake.auth.token;
  }

  const authHeader = socket.handshake.headers?.authorization || '';
  const [scheme, token] = authHeader.split(' ');
  if (scheme === 'Bearer') {
    return token;
  }

  return null;
};

const buildCallLog = (callType, eventType, reason) => {
  const label = callType === 'video' ? 'Video' : 'Audio';

  if (eventType === 'ended') {
    return { text: `${label} call ended`, callEvent: 'ended' };
  }

  if (eventType === 'reject') {
    if (reason === 'busy') {
      return { text: `${label} call missed`, callEvent: 'missed' };
    }
    return { text: `${label} call declined`, callEvent: 'declined' };
  }

  if (eventType === 'cancel') {
    if (reason === 'timeout') {
      return { text: `${label} call missed`, callEvent: 'missed' };
    }
    return { text: `${label} call cancelled`, callEvent: 'cancelled' };
  }

  return { text: `${label} call update`, callEvent: 'ended' };
};

export const initializeSocket = (io) => {
  io.use((socket, next) => {
    // Reuse JWT auth for sockets so only logged-in users can connect.
    const token = getTokenFromSocket(socket);

    if (!token) {
      return next(new Error('Authentication error'));
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.user = decoded;
      return next();
    } catch (error) {
      return next(new Error('Authentication error'));
    }
  });

  io.on('connection', async (socket) => {
    const currentUserId = String(socket.user.id);
    socket.join(currentUserId);
    addOnlineSocket(currentUserId, socket.id);

    await User.findByIdAndUpdate(currentUserId, {
      isOnline: true,
      lastSeen: new Date(),
    });

    const deliveredAt = new Date();
    const pendingMessages = await Message.find({
      receiver: currentUserId,
      status: 'sent',
    }).select('_id sender');

    if (pendingMessages.length > 0) {
      const pendingIds = pendingMessages.map((message) => message._id);
      await Message.updateMany(
        { _id: { $in: pendingIds } },
        {
          status: 'delivered',
          deliveredAt,
        }
      );

      const senderToMessageIds = new Map();
      pendingMessages.forEach((message) => {
        const senderId = String(message.sender);
        const messageIds = senderToMessageIds.get(senderId) || [];
        messageIds.push(String(message._id));
        senderToMessageIds.set(senderId, messageIds);
      });

      senderToMessageIds.forEach((messageIds, senderId) => {
        io.to(senderId).emit('message_status_update', {
          messageIds,
          status: 'delivered',
          deliveredAt,
        });
      });
    }

    io.emit('online_users', getOnlineUserIds());

    const persistCallEventMessage = async ({ to, roomId, callType, eventType, reason }) => {
      if (!to || !callType || !eventType) {
        return;
      }

      const conversation = await getOrCreateConversation(currentUserId, to);
      const { text, callEvent } = buildCallLog(callType, eventType, reason);

      const message = await Message.create({
        conversation: conversation._id,
        sender: currentUserId,
        receiver: to,
        messageType: 'call',
        callType,
        callEvent,
        text,
        status: isUserOnline(to) ? 'delivered' : 'sent',
        deliveredAt: isUserOnline(to) ? new Date() : null,
        clientMessageId: roomId ? `call-${roomId}-${eventType}-${Date.now()}` : '',
      });

      await Conversation.findByIdAndUpdate(conversation._id, {
        lastMessage: message._id,
        lastMessageAt: message.createdAt,
      });

      const populated = await Message.findById(message._id)
        .populate('sender', 'name email avatarUrl')
        .populate('receiver', 'name email avatarUrl');

      io.to(String(to)).emit('receive_message', populated);
      io.to(currentUserId).emit('receive_message', populated);
    };

    socket.on('private_message', async (payload, ack) => {
      try {
        const { to, text, imageUrl, clientMessageId } = payload || {};
        const trimmedText = text?.trim() || '';
        const normalizedClientMessageId = (clientMessageId || '').toString().trim();

        if (!to || (!trimmedText && !imageUrl)) {
          if (typeof ack === 'function') {
            ack({ ok: false, message: 'Invalid message payload' });
          }
          return;
        }

        if (normalizedClientMessageId) {
          const existing = await Message.findOne({
            sender: currentUserId,
            receiver: to,
            clientMessageId: normalizedClientMessageId,
          })
            .populate('sender', 'name email avatarUrl')
            .populate('receiver', 'name email avatarUrl');

          if (existing) {
            io.to(String(to)).emit('receive_message', existing);
            io.to(currentUserId).emit('receive_message', existing);
            if (typeof ack === 'function') {
              ack({ ok: true, message: existing });
            }
            return;
          }
        }

        const deliveredNow = isUserOnline(to);
        const now = new Date();
        const conversation = await getOrCreateConversation(currentUserId, to);

        const savedMessage = await Message.create({
          conversation: conversation._id,
          sender: currentUserId,
          receiver: to,
          messageType: 'text',
          text: trimmedText,
          imageUrl: imageUrl || '',
          clientMessageId: normalizedClientMessageId,
          status: deliveredNow ? 'delivered' : 'sent',
          deliveredAt: deliveredNow ? now : null,
        });

        await Conversation.findByIdAndUpdate(conversation._id, {
          lastMessage: savedMessage._id,
          lastMessageAt: savedMessage.createdAt,
        });

        const message = await Message.findById(savedMessage._id)
          .populate('sender', 'name email avatarUrl')
          .populate('receiver', 'name email avatarUrl');

        io.to(String(to)).emit('receive_message', message);
        io.to(currentUserId).emit('receive_message', message);

        if (typeof ack === 'function') {
          ack({ ok: true, message });
        }
      } catch (error) {
        socket.emit('chat_error', { message: 'Failed to send message' });
        if (typeof ack === 'function') {
          ack({ ok: false, message: 'Failed to send message' });
        }
      }
    });

    socket.on('typing_start', ({ to }) => {
      if (!to) {
        return;
      }
      io.to(String(to)).emit('typing', { from: currentUserId, isTyping: true });
    });

    socket.on('typing_stop', ({ to }) => {
      if (!to) {
        return;
      }
      io.to(String(to)).emit('typing', { from: currentUserId, isTyping: false });
    });

    socket.on('call_invite', ({ to, roomId, callType, callerName, callerAvatar }) => {
      if (!to || !roomId || !callType) {
        return;
      }

      io.to(String(to)).emit('call_invite', {
        from: currentUserId,
        callerId: currentUserId,
        callerName: callerName || '',
        callerAvatar: callerAvatar || '',
        roomId,
        callType,
      });
    });

    socket.on('call_accept', ({ to, roomId, callType }) => {
      if (!to || !roomId || !callType) {
        return;
      }

      io.to(String(to)).emit('call_accept', {
        from: currentUserId,
        roomId,
        callType,
      });
    });

    socket.on('call_reject', ({ to, roomId, reason, callType = 'audio' }) => {
      if (!to || !roomId) {
        return;
      }

      io.to(String(to)).emit('call_reject', {
        from: currentUserId,
        roomId,
        reason: reason || 'declined',
      });

      persistCallEventMessage({
        to,
        roomId,
        callType,
        eventType: 'reject',
        reason: reason || 'declined',
      }).catch(() => {});
    });

    socket.on('call_cancel', ({ to, roomId, reason, callType = 'audio' }) => {
      if (!to || !roomId) {
        return;
      }

      io.to(String(to)).emit('call_cancel', {
        from: currentUserId,
        roomId,
        reason: reason || 'cancelled',
      });

      persistCallEventMessage({
        to,
        roomId,
        callType,
        eventType: 'cancel',
        reason: reason || 'cancelled',
      }).catch(() => {});
    });

    socket.on('call_end', ({ to, roomId, callType = 'audio' }) => {
      if (!to || !roomId) {
        return;
      }

      io.to(String(to)).emit('call_end', {
        from: currentUserId,
        roomId,
      });

      persistCallEventMessage({
        to,
        roomId,
        callType,
        eventType: 'ended',
      }).catch(() => {});
    });

    socket.on('mark_seen', async ({ withUserId }) => {
      if (!withUserId) {
        return;
      }

      const seenAt = new Date();
      const participantKey = buildParticipantKey(currentUserId, withUserId);
      const existingConversation = await Conversation.findOne({ participantKey }).select('_id');

      const unseenQuery = existingConversation
        ? {
            conversation: existingConversation._id,
            sender: withUserId,
            receiver: currentUserId,
            status: { $ne: 'seen' },
          }
        : {
            sender: withUserId,
            receiver: currentUserId,
            status: { $ne: 'seen' },
          };

      const unseenMessages = await Message.find(unseenQuery).select('_id');

      if (unseenMessages.length === 0) {
        return;
      }

      const unseenIds = unseenMessages.map((message) => message._id);
      await Message.updateMany(
        { _id: { $in: unseenIds } },
        {
          status: 'seen',
          seenAt,
          deliveredAt: seenAt,
        }
      );

      const payload = {
        messageIds: unseenIds.map((id) => String(id)),
        status: 'seen',
        seenAt,
      };

      io.to(withUserId).emit('message_status_update', payload);
      io.to(currentUserId).emit('message_status_update', payload);
    });

    socket.on('disconnect', async () => {
      removeOnlineSocket(currentUserId, socket.id);

      if (!isUserOnline(currentUserId)) {
        await User.findByIdAndUpdate(currentUserId, {
          isOnline: false,
          lastSeen: new Date(),
        });
      }

      io.emit('online_users', getOnlineUserIds());
    });
  });
};
