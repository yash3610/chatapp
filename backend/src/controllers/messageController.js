import Message from '../models/Message.js';
import Conversation from '../models/Conversation.js';
import cloudinary from '../config/cloudinary.js';
import { buildParticipantKey, getOrCreateConversation } from '../utils/conversation.js';

const DEFAULT_PAGE_SIZE = 25;
const TYPING_TTL_MS = 5000;
const typingStateMap = new Map();

const typingStateKey = (receiverId, senderId) => `${String(receiverId)}:${String(senderId)}`;

const toObjectIdFilter = (currentUserId, otherUserId) => ({
  $or: [
    { sender: currentUserId, receiver: otherUserId },
    { sender: otherUserId, receiver: currentUserId },
  ],
});

const uploadBufferToCloudinary = (fileBuffer) =>
  new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: 'chatapp/messages',
        resource_type: 'image',
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
    const participantKey = buildParticipantKey(req.user.id, userId);
    const existingConversation = await Conversation.findOne({ participantKey }).select('_id');

    const query = existingConversation
      ? { conversation: existingConversation._id }
      : toObjectIdFilter(req.user.id, userId);

    if (before && !Number.isNaN(before.getTime())) {
      query.createdAt = { $lt: before };
    }

    const messages = await Message.find(query)
      .sort({ createdAt: -1 })
      .limit(pageSize)
      .populate('sender', 'name email avatarUrl')
      .populate('receiver', 'name email avatarUrl')
      .lean();

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
    const { receiverId, text, imageUrl, clientMessageId } = req.body;
    const trimmedText = text?.trim() || '';
    const normalizedClientMessageId = (clientMessageId || '').toString().trim();

    if (!receiverId || (!trimmedText && !imageUrl)) {
      return res.status(400).json({ message: 'Receiver and either text or image are required' });
    }

    if (normalizedClientMessageId) {
      const existing = await Message.findOne({
        sender: req.user.id,
        receiver: receiverId,
        clientMessageId: normalizedClientMessageId,
      })
        .populate('sender', 'name email avatarUrl')
        .populate('receiver', 'name email avatarUrl');

      if (existing) {
        return res.status(200).json(existing);
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
      messageType: 'text',
      text: trimmedText,
      imageUrl: imageUrl || '',
      clientMessageId: normalizedClientMessageId,
      status: deliveredNow ? 'delivered' : 'sent',
      deliveredAt: deliveredNow ? now : null,
    });

    await Conversation.findByIdAndUpdate(conversation._id, {
      lastMessage: message._id,
      lastMessageAt: message.createdAt,
    });

    const populatedMessage = await Message.findById(message._id)
      .populate('sender', 'name email avatarUrl')
      .populate('receiver', 'name email avatarUrl');

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
      return res.status(400).json({ message: 'Image file is required' });
    }

    if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
      return res.status(500).json({ message: 'Cloudinary is not configured on server' });
    }

    const imageUrl = await uploadBufferToCloudinary(req.file.buffer);

    return res.status(201).json({ imageUrl });
  } catch (error) {
    return res.status(500).json({ message: error?.message || 'Failed to upload image' });
  }
};

export const relayTypingEvent = async (req, res) => {
  try {
    const { to, isTyping } = req.body || {};

    if (!to || typeof isTyping !== 'boolean') {
      return res.status(400).json({ message: 'Receiver and typing state are required' });
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

export const getTypingStatus = async (req, res) => {
  try {
    const { userId } = req.params;
    if (!userId) {
      return res.status(400).json({ message: 'User id is required' });
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
