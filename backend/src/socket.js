import jwt from 'jsonwebtoken';
import Conversation from './models/Conversation.js';
import Group from './models/Group.js';
import Message from './models/Message.js';
import User from './models/User.js';
import { buildParticipantKey, getOrCreateConversation } from './utils/conversation.js';

const onlineUsers = new Map();
const ALLOWED_REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '😢'];

const populateMessage = (query) =>
  query
    .populate('sender', 'name email avatarUrl')
    .populate('receiver', 'name email avatarUrl')
    .populate('reactions.user', 'name avatarUrl')
    .populate({
      path: 'replyTo',
      select: '_id text imageUrl deleted messageType sender createdAt',
      populate: {
        path: 'sender',
        select: 'name avatarUrl',
      },
    });

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

    const myGroups = await Group.find({ members: currentUserId }).select('_id').lean();
    myGroups.forEach((group) => {
      socket.join(String(group._id));
    });

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
        chatId: to,
        isGroup: false,
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

      const populated = await populateMessage(Message.findById(message._id));

      io.to(String(to)).emit('receive_message', populated);
      io.to(currentUserId).emit('receive_message', populated);
    };

    socket.on('private_message', async (payload, ack) => {
      try {
        const { to, text, imageUrl, clientMessageId, replyTo } = payload || {};
        const trimmedText = text?.trim() || '';
        const normalizedClientMessageId = (clientMessageId || '').toString().trim();
        const normalizedReplyTo = replyTo || null;

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
          });

          const existingPopulated = existing ? await populateMessage(Message.findById(existing._id)) : null;

          if (existingPopulated) {
            io.to(String(to)).emit('receive_message', existingPopulated);
            io.to(currentUserId).emit('receive_message', existingPopulated);
            if (typeof ack === 'function') {
              ack({ ok: true, message: existingPopulated });
            }
            return;
          }
        }

        if (normalizedReplyTo) {
          const repliedMessage = await Message.findById(normalizedReplyTo).select('_id sender receiver');
          if (!repliedMessage) {
            if (typeof ack === 'function') {
              ack({ ok: false, message: 'Replied message not found' });
            }
            return;
          }

          const participants = [String(repliedMessage.sender), String(repliedMessage.receiver)];
          if (!participants.includes(String(currentUserId)) || !participants.includes(String(to))) {
            if (typeof ack === 'function') {
              ack({ ok: false, message: 'Reply target is not in this conversation' });
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
          chatId: to,
          isGroup: false,
          messageType: 'text',
          text: trimmedText,
          imageUrl: imageUrl || '',
          replyTo: normalizedReplyTo,
          clientMessageId: normalizedClientMessageId,
          status: deliveredNow ? 'delivered' : 'sent',
          deliveredAt: deliveredNow ? now : null,
        });

        await Conversation.findByIdAndUpdate(conversation._id, {
          lastMessage: savedMessage._id,
          lastMessageAt: savedMessage.createdAt,
        });

        const message = await populateMessage(Message.findById(savedMessage._id));

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

    socket.on('group_typing', async ({ groupId, isTyping }) => {
      if (!groupId || typeof isTyping !== 'boolean') {
        return;
      }

      const group = await Group.findOne({ _id: groupId, members: currentUserId }).select('_id');
      if (!group) {
        return;
      }

      socket.to(String(groupId)).emit('group_typing', {
        groupId: String(groupId),
        from: currentUserId,
        isTyping,
      });
    });

    socket.on('group_message', async (payload, ack) => {
      try {
        const { groupId, text, imageUrl, clientMessageId, replyTo } = payload || {};
        const trimmedText = text?.trim() || '';
        const normalizedClientMessageId = (clientMessageId || '').toString().trim();
        const normalizedReplyTo = replyTo || null;

        if (!groupId || (!trimmedText && !imageUrl)) {
          if (typeof ack === 'function') {
            ack({ ok: false, message: 'Invalid group message payload' });
          }
          return;
        }

        const group = await Group.findOne({ _id: groupId, members: currentUserId }).select('_id');
        if (!group) {
          if (typeof ack === 'function') {
            ack({ ok: false, message: 'Not allowed' });
          }
          return;
        }

        if (normalizedClientMessageId) {
          const existing = await Message.findOne({
            sender: currentUserId,
            isGroup: true,
            chatId: groupId,
            clientMessageId: normalizedClientMessageId,
          });
          const existingPopulated = existing ? await populateMessage(Message.findById(existing._id)) : null;

          if (existingPopulated) {
            io.to(String(groupId)).emit('receive_message', existingPopulated);
            if (typeof ack === 'function') {
              ack({ ok: true, message: existingPopulated });
            }
            return;
          }
        }

        if (normalizedReplyTo) {
          const repliedMessage = await Message.findById(normalizedReplyTo).select('_id isGroup chatId');
          if (!repliedMessage || !repliedMessage.isGroup || String(repliedMessage.chatId) !== String(groupId)) {
            if (typeof ack === 'function') {
              ack({ ok: false, message: 'Reply target is not in this group' });
            }
            return;
          }
        }

        const savedMessage = await Message.create({
          sender: currentUserId,
          receiver: null,
          chatId: groupId,
          isGroup: true,
          messageType: 'text',
          text: trimmedText,
          imageUrl: imageUrl || '',
          replyTo: normalizedReplyTo,
          clientMessageId: normalizedClientMessageId,
          status: 'sent',
        });

        const message = await populateMessage(Message.findById(savedMessage._id));
        io.to(String(groupId)).emit('receive_message', message);

        if (typeof ack === 'function') {
          ack({ ok: true, message });
        }
      } catch {
        if (typeof ack === 'function') {
          ack({ ok: false, message: 'Failed to send group message' });
        }
      }
    });

    socket.on('message_react', async ({ messageId, emoji }, ack) => {
      try {
        if (!messageId || !ALLOWED_REACTION_EMOJIS.includes(emoji)) {
          if (typeof ack === 'function') {
            ack({ ok: false, message: 'Invalid reaction payload' });
          }
          return;
        }

        const message = await Message.findById(messageId);
        if (!message) {
          if (typeof ack === 'function') {
            ack({ ok: false, message: 'Message not found' });
          }
          return;
        }

        if (message.deleted) {
          if (typeof ack === 'function') {
            ack({ ok: false, message: 'Not allowed' });
          }
          return;
        }

        if (message.isGroup) {
          const group = await Group.findOne({ _id: message.chatId, members: currentUserId }).select('_id');
          if (!group) {
            if (typeof ack === 'function') {
              ack({ ok: false, message: 'Not allowed' });
            }
            return;
          }
        } else {
          const participants = [String(message.sender), String(message.receiver)];
          if (!participants.includes(currentUserId)) {
            if (typeof ack === 'function') {
              ack({ ok: false, message: 'Not allowed' });
            }
            return;
          }
        }

        const existingIndex = message.reactions.findIndex(
          (reaction) => String(reaction.user) === currentUserId
        );

        if (existingIndex >= 0) {
          if (message.reactions[existingIndex].emoji === emoji) {
            message.reactions.splice(existingIndex, 1);
          } else {
            message.reactions[existingIndex].emoji = emoji;
          }
        } else {
          message.reactions.push({ user: currentUserId, emoji });
        }

        await message.save();
        const populated = await populateMessage(Message.findById(message._id));
        if (message.isGroup) {
          io.to(String(message.chatId)).emit('message_reaction_update', populated);
        } else {
          io.to(String(message.sender)).emit('message_reaction_update', populated);
          io.to(String(message.receiver)).emit('message_reaction_update', populated);
        }

        if (typeof ack === 'function') {
          ack({ ok: true, message: populated });
        }
      } catch {
        if (typeof ack === 'function') {
          ack({ ok: false, message: 'Failed to update reaction' });
        }
      }
    });

    socket.on('message_edit', async ({ messageId, text }, ack) => {
      try {
        const nextText = (text || '').trim();
        if (!messageId || !nextText) {
          if (typeof ack === 'function') {
            ack({ ok: false, message: 'Invalid edit payload' });
          }
          return;
        }

        const message = await Message.findById(messageId);
        if (!message) {
          if (typeof ack === 'function') {
            ack({ ok: false, message: 'Message not found' });
          }
          return;
        }

        if (String(message.sender) !== currentUserId || message.deleted || message.messageType !== 'text') {
          if (typeof ack === 'function') {
            ack({ ok: false, message: 'Not allowed to edit this message' });
          }
          return;
        }

        message.text = nextText;
        message.edited = true;
        message.editedAt = new Date();
        await message.save();

        const populated = await populateMessage(Message.findById(message._id));
        if (message.isGroup) {
          const group = await Group.findOne({ _id: message.chatId, members: currentUserId }).select('_id');
          if (!group) {
            if (typeof ack === 'function') {
              ack({ ok: false, message: 'Not allowed to edit this message' });
            }
            return;
          }
          io.to(String(message.chatId)).emit('message_updated', populated);
        } else {
          io.to(String(message.sender)).emit('message_updated', populated);
          io.to(String(message.receiver)).emit('message_updated', populated);
        }

        if (typeof ack === 'function') {
          ack({ ok: true, message: populated });
        }
      } catch {
        if (typeof ack === 'function') {
          ack({ ok: false, message: 'Failed to edit message' });
        }
      }
    });

    socket.on('message_delete', async ({ messageId, mode }, ack) => {
      try {
        if (!messageId) {
          if (typeof ack === 'function') {
            ack({ ok: false, message: 'Invalid delete payload' });
          }
          return;
        }

        const message = await Message.findById(messageId);
        if (!message) {
          if (typeof ack === 'function') {
            ack({ ok: false, message: 'Message not found' });
          }
          return;
        }

        if (message.isGroup) {
          const group = await Group.findOne({ _id: message.chatId, members: currentUserId }).select('_id');
          if (!group) {
            if (typeof ack === 'function') {
              ack({ ok: false, message: 'Not allowed' });
            }
            return;
          }
        } else {
          const participants = [String(message.sender), String(message.receiver)];
          if (!participants.includes(currentUserId)) {
            if (typeof ack === 'function') {
              ack({ ok: false, message: 'Not allowed' });
            }
            return;
          }
        }

        if (mode === 'everyone') {
          if (String(message.sender) !== currentUserId) {
            if (typeof ack === 'function') {
              ack({ ok: false, message: 'Only sender can delete for everyone' });
            }
            return;
          }

          message.deleted = true;
          message.text = '';
          message.imageUrl = '';
          message.reactions = [];
          message.edited = false;
          message.editedAt = null;
          await message.save();

          const populated = await populateMessage(Message.findById(message._id));
          if (message.isGroup) {
            io.to(String(message.chatId)).emit('message_deleted_for_everyone', populated);
          } else {
            io.to(String(message.sender)).emit('message_deleted_for_everyone', populated);
            io.to(String(message.receiver)).emit('message_deleted_for_everyone', populated);
          }

          if (typeof ack === 'function') {
            ack({ ok: true, mode: 'everyone', message: populated });
          }
          return;
        }

        if (!message.deletedFor.some((id) => String(id) === currentUserId)) {
          message.deletedFor.push(currentUserId);
          await message.save();
        }

        io.to(currentUserId).emit('message_deleted_for_me', { messageId: String(message._id) });

        if (typeof ack === 'function') {
          ack({ ok: true, mode: 'me', messageId: String(message._id) });
        }
      } catch {
        if (typeof ack === 'function') {
          ack({ ok: false, message: 'Failed to delete message' });
        }
      }
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
