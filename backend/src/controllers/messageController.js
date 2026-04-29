import Message from '../models/Message.js';
import Conversation from '../models/Conversation.js';
import Group from '../models/Group.js';
import cloudinary from '../config/cloudinary.js';
import { isAcceptedContact } from '../utils/contacts.js';
import { buildParticipantKey, getOrCreateConversation } from '../utils/conversation.js';
import http from 'http';
import https from 'https';

const DEFAULT_PAGE_SIZE = 25;
const TYPING_TTL_MS = 5000;
const typingStateMap = new Map();
const ALLOWED_REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '😢'];

const populateMessage = (query) =>
  query
    .populate('sender', 'name email avatarUrl')
    .populate('receiver', 'name email avatarUrl')
    .populate('forwardedFrom', 'name email avatarUrl')
    .populate('gamePlayers', 'name email avatarUrl')
    .populate('gameWinner', 'name email avatarUrl')
    .populate('reactions.user', 'name avatarUrl')
    .populate({
      path: 'replyTo',
      select: '_id text imageUrl deleted messageType sender createdAt',
      populate: {
        path: 'sender',
        select: 'name avatarUrl',
      },
    });

const emitToParticipants = (io, message, eventName, payload) => {
  if (!io || !message) {
    return;
  }

  if (message.isGroup && message.chatId) {
    io.to(String(message.chatId)).emit(eventName, payload);
    return;
  }

  io.to(String(message.sender?._id || message.sender)).emit(eventName, payload);
  if (message.receiver?._id || message.receiver) {
    io.to(String(message.receiver?._id || message.receiver)).emit(eventName, payload);
  }
};

const isGroupMember = async (groupId, userId) => {
  if (!groupId) {
    return false;
  }

  const group = await Group.findOne({ _id: groupId, members: userId }).select('_id');
  return Boolean(group);
};

const typingStateKey = (receiverId, senderId) => `${String(receiverId)}:${String(senderId)}`;

const toObjectIdFilter = (currentUserId, otherUserId) => ({
  $or: [
    { sender: currentUserId, receiver: otherUserId },
    { sender: otherUserId, receiver: currentUserId },
  ],
});

const uploadBufferToCloudinary = (fileBuffer, mimeType = '') =>
  new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: 'chatapp/messages',
        resource_type: mimeType?.startsWith('image/') ? 'image' : 'raw',
      },
      (error, result) => {
        if (error) {
          return reject(error);
        }
        return resolve(result.secure_url);
      }
    );

    stream.end(fileBuffer);
  });

export const getConversation = async (req, res) => {
  try {
    const { userId } = req.params;
    const before = req.query.before ? new Date(req.query.before) : null;
    const pageSize = Math.min(Number(req.query.limit) || DEFAULT_PAGE_SIZE, 50);

    const allowed = await isAcceptedContact(req.user.id, userId);
    if (!allowed) {
      return res.status(403).json({ message: 'Chat allowed only with accepted contacts' });
    }

    const participantKey = buildParticipantKey(req.user.id, userId);
    const existingConversation = await Conversation.findOne({ participantKey }).select('_id');

    const query = existingConversation
      ? { conversation: existingConversation._id }
      : toObjectIdFilter(req.user.id, userId);

    if (before && !Number.isNaN(before.getTime())) {
      query.createdAt = { $lt: before };
    }

    query.deletedFor = { $nin: [req.user.id] };

    const messages = await populateMessage(
      Message.find(query)
      .sort({ createdAt: -1 })
      .limit(pageSize)
    ).lean();

    const orderedMessages = messages.reverse();
    const hasMore = messages.length === pageSize;
    const nextCursor = hasMore && orderedMessages.length > 0 ? orderedMessages[0].createdAt : null;

    return res.status(200).json({
      messages: orderedMessages,
      hasMore,
      nextCursor,
      conversationId: existingConversation?._id || null,
    });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to fetch chat history' });
  }
};

export const sendMessage = async (req, res) => {
  try {
    const { receiverId, text, imageUrl, fileUrl, fileName, fileType, clientMessageId, replyTo } = req.body;
    const trimmedText = text?.trim() || '';
    const normalizedClientMessageId = (clientMessageId || '').toString().trim();
    const normalizedReplyTo = replyTo || null;
    const normalizedFileUrl = (fileUrl || '').toString().trim();
    const normalizedFileName = (fileName || '').toString().trim();
    const normalizedFileType = (fileType || '').toString().trim();

    if (!receiverId || (!trimmedText && !imageUrl && !normalizedFileUrl)) {
      return res.status(400).json({ message: 'Receiver and either text, image, or file are required' });
    }

    const allowed = await isAcceptedContact(req.user.id, receiverId);
    if (!allowed) {
      return res.status(403).json({ message: 'Chat allowed only with accepted contacts' });
    }

    if (normalizedClientMessageId) {
      const existing = await Message.findOne({
        sender: req.user.id,
        receiver: receiverId,
        clientMessageId: normalizedClientMessageId,
      });

      const existingPopulated = existing ? await populateMessage(Message.findById(existing._id)) : null;

      if (existingPopulated) {
        return res.status(200).json(existingPopulated);
      }
    }

    if (normalizedReplyTo) {
      const repliedMessage = await Message.findById(normalizedReplyTo).select('_id sender receiver');
      if (!repliedMessage) {
        return res.status(400).json({ message: 'Replied message not found' });
      }

      const participants = [String(repliedMessage.sender), String(repliedMessage.receiver)];
      if (!participants.includes(String(req.user.id)) || !participants.includes(String(receiverId))) {
        return res.status(400).json({ message: 'Reply target is not in this conversation' });
      }
    }

    const conversation = await getOrCreateConversation(req.user.id, receiverId);
    const io = req.app.get('io');
    const receiverSockets = io?.sockets?.adapter?.rooms?.get(String(receiverId));
    const deliveredNow = Boolean(receiverSockets?.size);
    const now = new Date();

    const message = await Message.create({
      conversation: conversation._id,
      sender: req.user.id,
      receiver: receiverId,
      chatId: receiverId,
      isGroup: false,
      messageType: 'text',
      text: trimmedText,
      imageUrl: imageUrl || '',
      fileUrl: normalizedFileUrl,
      fileName: normalizedFileName,
      fileType: normalizedFileType,
      replyTo: normalizedReplyTo,
      clientMessageId: normalizedClientMessageId,
      status: deliveredNow ? 'delivered' : 'sent',
      deliveredAt: deliveredNow ? now : null,
    });

    await Conversation.findByIdAndUpdate(conversation._id, {
      lastMessage: message._id,
      lastMessageAt: message.createdAt,
    });

    const populatedMessage = await populateMessage(Message.findById(message._id));

    if (io) {
      io.to(String(receiverId)).emit('receive_message', populatedMessage);
      io.to(String(req.user.id)).emit('receive_message', populatedMessage);
    }

    return res.status(201).json(populatedMessage);
  } catch (error) {
    return res.status(500).json({ message: 'Failed to send message' });
  }
};

export const markConversationAsSeen = async (req, res) => {
  try {
    const { userId } = req.params;
    const now = new Date();

    const allowed = await isAcceptedContact(req.user.id, userId);
    if (!allowed) {
      return res.status(403).json({ message: 'Chat allowed only with accepted contacts' });
    }

    const participantKey = buildParticipantKey(req.user.id, userId);
    const existingConversation = await Conversation.findOne({ participantKey }).select('_id');

    const query = existingConversation
      ? {
          conversation: existingConversation._id,
          sender: userId,
          receiver: req.user.id,
          status: { $ne: 'seen' },
        }
      : {
          sender: userId,
          receiver: req.user.id,
          status: { $ne: 'seen' },
        };

    const result = await Message.updateMany(
      query,
      {
        status: 'seen',
        seenAt: now,
        deliveredAt: now,
      }
    );

    return res.status(200).json({
      modifiedCount: result.modifiedCount,
      seenAt: now,
    });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to update seen status' });
  }
};

export const uploadChatImage = async (req, res) => {
  try {
    if (!req.file?.buffer) {
      return res.status(400).json({ message: 'Attachment file is required' });
    }

    if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
      return res.status(500).json({ message: 'Cloudinary is not configured on server' });
    }

    const isImage = req.file.mimetype?.startsWith('image/');

    const fileUrl = await uploadBufferToCloudinary(req.file.buffer, req.file.mimetype);

    return res.status(201).json({
      imageUrl: isImage ? fileUrl : '',
      fileUrl: isImage ? '' : fileUrl,
      fileName: req.file.originalname || '',
      fileType: req.file.mimetype || '',
      isImage,
    });
  } catch (error) {
    return res.status(500).json({ message: error?.message || 'Failed to upload attachment' });
  }
};

export const relayTypingEvent = async (req, res) => {
  try {
    const { to, isTyping } = req.body || {};

    if (!to || typeof isTyping !== 'boolean') {
      return res.status(400).json({ message: 'Receiver and typing state are required' });
    }

    const allowed = await isAcceptedContact(req.user.id, to);
    if (!allowed) {
      return res.status(403).json({ message: 'Typing allowed only with accepted contacts' });
    }

    const key = typingStateKey(to, req.user.id);
    if (isTyping) {
      typingStateMap.set(key, Date.now() + TYPING_TTL_MS);
    } else {
      typingStateMap.delete(key);
    }

    const io = req.app.get('io');
    if (!io) {
      return res.status(500).json({ message: 'Socket server unavailable' });
    }

    io.to(String(to)).emit('typing', {
      from: String(req.user.id),
      isTyping,
    });

    return res.status(200).json({ ok: true });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to relay typing event' });
  }
};

export const getGroupConversation = async (req, res) => {
  try {
    const { groupId } = req.params;
    const before = req.query.before ? new Date(req.query.before) : null;
    const pageSize = Math.min(Number(req.query.limit) || DEFAULT_PAGE_SIZE, 50);

    const allowed = await isGroupMember(groupId, req.user.id);
    if (!allowed) {
      return res.status(403).json({ message: 'Not allowed' });
    }

    const query = {
      isGroup: true,
      chatId: groupId,
      deletedFor: { $nin: [req.user.id] },
    };

    if (before && !Number.isNaN(before.getTime())) {
      query.createdAt = { $lt: before };
    }

    const messages = await populateMessage(Message.find(query).sort({ createdAt: -1 }).limit(pageSize)).lean();
    const orderedMessages = messages.reverse();
    const hasMore = messages.length === pageSize;
    const nextCursor = hasMore && orderedMessages.length > 0 ? orderedMessages[0].createdAt : null;

    return res.status(200).json({
      messages: orderedMessages,
      hasMore,
      nextCursor,
      conversationId: null,
    });
  } catch (_error) {
    return res.status(500).json({ message: 'Failed to fetch group chat history' });
  }
};

export const sendGroupMessage = async (req, res) => {
  try {
    const { groupId } = req.params;
    const { text, imageUrl, fileUrl, fileName, fileType, clientMessageId, replyTo } = req.body || {};
    const trimmedText = text?.trim() || '';
    const normalizedClientMessageId = (clientMessageId || '').toString().trim();
    const normalizedReplyTo = replyTo || null;
    const normalizedFileUrl = (fileUrl || '').toString().trim();
    const normalizedFileName = (fileName || '').toString().trim();
    const normalizedFileType = (fileType || '').toString().trim();

    if (!trimmedText && !imageUrl && !normalizedFileUrl) {
      return res.status(400).json({ message: 'Text, image, or file is required' });
    }

    const group = await Group.findOne({ _id: groupId, members: req.user.id }).select('_id members');
    if (!group) {
      return res.status(403).json({ message: 'Not allowed' });
    }

    if (normalizedClientMessageId) {
      const existing = await Message.findOne({
        sender: req.user.id,
        isGroup: true,
        chatId: groupId,
        clientMessageId: normalizedClientMessageId,
      });

      const existingPopulated = existing ? await populateMessage(Message.findById(existing._id)) : null;
      if (existingPopulated) {
        return res.status(200).json(existingPopulated);
      }
    }

    if (normalizedReplyTo) {
      const repliedMessage = await Message.findById(normalizedReplyTo).select('_id isGroup chatId sender');
      if (!repliedMessage || !repliedMessage.isGroup || String(repliedMessage.chatId) !== String(groupId)) {
        return res.status(400).json({ message: 'Reply target is not in this group' });
      }
    }

    const message = await Message.create({
      sender: req.user.id,
      receiver: null,
      chatId: groupId,
      isGroup: true,
      messageType: 'text',
      text: trimmedText,
      imageUrl: imageUrl || '',
      fileUrl: normalizedFileUrl,
      fileName: normalizedFileName,
      fileType: normalizedFileType,
      replyTo: normalizedReplyTo,
      clientMessageId: normalizedClientMessageId,
      status: 'sent',
    });

    const populatedMessage = await populateMessage(Message.findById(message._id));
    req.app.get('io')?.to(String(groupId)).emit('receive_message', populatedMessage);

    return res.status(201).json(populatedMessage);
  } catch (_error) {
    return res.status(500).json({ message: 'Failed to send group message' });
  }
};

export const forwardMessage = async (req, res) => {
  try {
    const { messageId, receiverIds } = req.body || {};
    if (!messageId || !Array.isArray(receiverIds) || receiverIds.length === 0) {
      return res.status(400).json({ message: 'Message id and receivers are required' });
    }

    const sourceMessage = await Message.findById(messageId)
      .select('sender receiver text imageUrl fileUrl fileName fileType deleted isGroup chatId messageType forwardedFrom forwardedFromMessage')
      .lean();

    if (!sourceMessage) {
      return res.status(404).json({ message: 'Message not found' });
    }

    if (sourceMessage.deleted) {
      return res.status(400).json({ message: 'Cannot forward a deleted message' });
    }

    const hasContent = Boolean((sourceMessage.text || '').trim() || sourceMessage.imageUrl || sourceMessage.fileUrl);
    if (!hasContent || sourceMessage.messageType === 'call') {
      return res.status(400).json({ message: 'Only text, image, or file messages can be forwarded' });
    }

    if (sourceMessage.isGroup) {
      const allowed = await isGroupMember(sourceMessage.chatId, req.user.id);
      if (!allowed) {
        return res.status(403).json({ message: 'Not allowed to forward this message' });
      }
    } else {
      const participants = [String(sourceMessage.sender), String(sourceMessage.receiver)];
      if (!participants.includes(String(req.user.id))) {
        return res.status(403).json({ message: 'Not allowed to forward this message' });
      }
    }

    const uniqueReceiverIds = Array.from(
      new Set(receiverIds.map((id) => String(id)).filter(Boolean))
    ).filter((id) => id !== String(req.user.id));

    if (uniqueReceiverIds.length === 0) {
      return res.status(400).json({ message: 'Select at least one valid receiver' });
    }

    const io = req.app.get('io');
    const forwardedFrom = sourceMessage.forwardedFrom || sourceMessage.sender;
    const forwardedFromMessage = sourceMessage.forwardedFromMessage || sourceMessage._id;
    const now = new Date();

    const forwarded = [];
    const failed = [];

    for (const receiverId of uniqueReceiverIds) {
      const allowed = await isAcceptedContact(req.user.id, receiverId);
      if (!allowed) {
        failed.push({ receiverId, reason: 'not_allowed' });
        continue;
      }

      const conversation = await getOrCreateConversation(req.user.id, receiverId);
      const receiverSockets = io?.sockets?.adapter?.rooms?.get(String(receiverId));
      const deliveredNow = Boolean(receiverSockets?.size);

      const message = await Message.create({
        conversation: conversation._id,
        sender: req.user.id,
        receiver: receiverId,
        chatId: receiverId,
        isGroup: false,
        messageType: 'text',
        text: sourceMessage.text || '',
        imageUrl: sourceMessage.imageUrl || '',
        fileUrl: sourceMessage.fileUrl || '',
        fileName: sourceMessage.fileName || '',
        fileType: sourceMessage.fileType || '',
        forwardedFrom,
        forwardedFromMessage,
        status: deliveredNow ? 'delivered' : 'sent',
        deliveredAt: deliveredNow ? now : null,
      });

      await Conversation.findByIdAndUpdate(conversation._id, {
        lastMessage: message._id,
        lastMessageAt: message.createdAt,
      });

      const populatedMessage = await populateMessage(Message.findById(message._id));
      forwarded.push(populatedMessage);

      if (io) {
        io.to(String(receiverId)).emit('receive_message', populatedMessage);
        io.to(String(req.user.id)).emit('receive_message', populatedMessage);
      }
    }

    if (forwarded.length === 0) {
      return res.status(403).json({ message: 'No valid receivers to forward' });
    }

    return res.status(201).json({ forwarded, failed });
  } catch (error) {
    console.error('Forward message error', error);
    return res.status(500).json({ message: 'Failed to forward message' });
  }
};

export const reactToMessage = async (req, res) => {
  try {
    const { messageId } = req.params;
    const { emoji } = req.body || {};

    if (!ALLOWED_REACTION_EMOJIS.includes(emoji)) {
      return res.status(400).json({ message: 'Invalid reaction emoji' });
    }

    const message = await Message.findById(messageId);
    if (!message) {
      return res.status(404).json({ message: 'Message not found' });
    }

    const currentUserId = String(req.user.id);

    if (message.isGroup) {
      const allowed = await isGroupMember(message.chatId, req.user.id);
      if (!allowed) {
        return res.status(403).json({ message: 'Not allowed' });
      }
    } else {
      const participants = [String(message.sender), String(message.receiver)];
      if (!participants.includes(currentUserId)) {
        return res.status(403).json({ message: 'Not allowed' });
      }
    }

    if (message.deleted) {
      return res.status(400).json({ message: 'Cannot react to deleted message' });
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
      message.reactions.push({ user: req.user.id, emoji });
    }

    await message.save();
    const populatedMessage = await populateMessage(Message.findById(message._id));

    emitToParticipants(req.app.get('io'), populatedMessage, 'message_reaction_update', populatedMessage);

    return res.status(200).json(populatedMessage);
  } catch (_error) {
    return res.status(500).json({ message: 'Failed to update reaction' });
  }
};

export const editMessage = async (req, res) => {
  try {
    const { messageId } = req.params;
    const nextText = (req.body?.text || '').trim();

    if (!nextText) {
      return res.status(400).json({ message: 'Edited text is required' });
    }

    const message = await Message.findById(messageId);
    if (!message) {
      return res.status(404).json({ message: 'Message not found' });
    }

    if (String(message.sender) !== String(req.user.id)) {
      return res.status(403).json({ message: 'Only sender can edit this message' });
    }

    if (message.deleted || message.messageType !== 'text') {
      return res.status(400).json({ message: 'This message cannot be edited' });
    }

    message.text = nextText;
    message.edited = true;
    message.editedAt = new Date();
    await message.save();

    const populatedMessage = await populateMessage(Message.findById(message._id));
    emitToParticipants(req.app.get('io'), populatedMessage, 'message_updated', populatedMessage);

    return res.status(200).json(populatedMessage);
  } catch (_error) {
    return res.status(500).json({ message: 'Failed to edit message' });
  }
};

export const deleteMessage = async (req, res) => {
  try {
    const { messageId } = req.params;
    const mode = req.body?.mode === 'everyone' ? 'everyone' : 'me';

    const message = await Message.findById(messageId);
    if (!message) {
      return res.status(404).json({ message: 'Message not found' });
    }

    const currentUserId = String(req.user.id);

    if (message.isGroup) {
      const allowed = await isGroupMember(message.chatId, req.user.id);
      if (!allowed) {
        return res.status(403).json({ message: 'Not allowed' });
      }
    } else {
      const participants = [String(message.sender), String(message.receiver)];
      if (!participants.includes(currentUserId)) {
        return res.status(403).json({ message: 'Not allowed' });
      }
    }

    if (mode === 'me') {
      if (!message.deletedFor.some((id) => String(id) === currentUserId)) {
        message.deletedFor.push(req.user.id);
        await message.save();
      }

      req.app.get('io')?.to(currentUserId).emit('message_deleted_for_me', {
        messageId: String(message._id),
      });

      return res.status(200).json({ ok: true, mode: 'me', messageId: String(message._id) });
    }

    if (String(message.sender) !== currentUserId) {
      return res.status(403).json({ message: 'Only sender can delete for everyone' });
    }

    message.deleted = true;
    message.text = '';
    message.imageUrl = '';
    message.reactions = [];
    message.edited = false;
    message.editedAt = null;
    await message.save();

    const populatedMessage = await populateMessage(Message.findById(message._id));
    emitToParticipants(req.app.get('io'), populatedMessage, 'message_deleted_for_everyone', populatedMessage);

    return res.status(200).json(populatedMessage);
  } catch (_error) {
    return res.status(500).json({ message: 'Failed to delete message' });
  }
};

export const getTypingStatus = async (req, res) => {
  try {
    const { userId } = req.params;
    if (!userId) {
      return res.status(400).json({ message: 'User id is required' });
    }

    const allowed = await isAcceptedContact(req.user.id, userId);
    if (!allowed) {
      return res.status(403).json({ message: 'Typing allowed only with accepted contacts' });
    }

    const key = typingStateKey(req.user.id, userId);
    const expiresAt = typingStateMap.get(key) || 0;
    const isTyping = expiresAt > Date.now();

    if (!isTyping && typingStateMap.has(key)) {
      typingStateMap.delete(key);
    }

    return res.status(200).json({ isTyping });
  } catch (_error) {
    return res.status(500).json({ message: 'Failed to read typing status' });
  }
};

export const clearConversation = async (req, res) => {
  try {
    const { userId } = req.params;
    const currentUserId = req.user.id;

    if (!userId) {
      return res.status(400).json({ message: 'User id is required' });
    }

    const allowed = await isAcceptedContact(currentUserId, userId);
    if (!allowed) {
      return res.status(403).json({ message: 'Chat allowed only with accepted contacts' });
    }

    const key = buildParticipantKey(currentUserId, userId);
    const conversation = await Conversation.findOne({ participantKey: key });

    if (!conversation) {
      return res.status(200).json({ message: 'Conversation cleared' });
    }

    await Message.deleteMany({ _id: { $in: conversation.messages } });
    conversation.messages = [];
    await conversation.save();

    return res.status(200).json({ message: 'Conversation cleared successfully' });
  } catch (error) {
    console.error('Clear conversation error:', error);
    return res.status(500).json({ message: 'Failed to clear conversation' });
  }
};

export const downloadMessageFile = async (req, res) => {
  try {
    const { messageId } = req.params;
    if (!messageId) {
      return res.status(400).json({ message: 'Message id is required' });
    }

    const message = await Message.findById(messageId).select('sender receiver isGroup chatId fileUrl fileName fileType');
    if (!message || !message.fileUrl) {
      return res.status(404).json({ message: 'File not found' });
    }

    const currentUserId = String(req.user.id);
    if (message.isGroup) {
      const allowed = await isGroupMember(message.chatId, req.user.id);
      if (!allowed) {
        return res.status(403).json({ message: 'Not allowed' });
      }
    } else {
      const participants = [String(message.sender), String(message.receiver)];
      if (!participants.includes(currentUserId)) {
        return res.status(403).json({ message: 'Not allowed' });
      }
    }

    const filename = message.fileName || 'download';
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', message.fileType || 'application/octet-stream');

    const url = new URL(message.fileUrl);
    const client = url.protocol === 'https:' ? https : http;

    client.get(url, (fileRes) => {
      if (fileRes.statusCode && fileRes.statusCode >= 400) {
        res.status(502).json({ message: 'Failed to fetch file' });
        return;
      }
      fileRes.pipe(res);
    }).on('error', () => {
      res.status(502).json({ message: 'Failed to fetch file' });
    });
  } catch (_error) {
    return res.status(500).json({ message: 'Failed to download file' });
  }
};
