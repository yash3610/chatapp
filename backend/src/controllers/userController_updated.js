import Conversation from '../models/Conversation.js';
import ContactRequest from '../models/ContactRequest.js';
import User from '../models/User.js';
import cloudinary from '../config/cloudinary.js';
import { buildContactPairKey, getAcceptedContactIds } from '../utils/contacts.js';

const uploadBufferToCloudinary = (fileBuffer) =>
  new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: 'chatapp/avatars',
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

const toPendingRequestPayload = (request, type) => {
  const person = type === 'incoming' ? request.sender : request.receiver;
  return {
    _id: request._id,
    status: request.status,
    createdAt: request.createdAt,
    sender: request.sender,
    receiver: request.receiver,
    user: {
      _id: person?._id,
      name: person?.name || 'User',
      email: person?.email || '',
      avatarUrl: person?.avatarUrl || '',
      isOnline: Boolean(person?.isOnline),
      lastSeen: person?.lastSeen || null,
    },
  };
};

export const getUsers = async (req, res) => {
  try {
    const acceptedContactIds = await getAcceptedContactIds(req.user.id);
    if (acceptedContactIds.length === 0) {
      return res.status(200).json([]);
    }

    const users = await User.find({ _id: { $in: acceptedContactIds } }).select('name email avatarUrl isOnline lastSeen blockedUsers').lean();

    const conversations = await Conversation.find({ participants: req.user.id })
      .select('participants lastMessageAt')
      .sort({ lastMessageAt: -1 })
      .lean();

    const orderedIds = [];
    conversations.forEach((conversation) => {
      conversation.participants.forEach((participant) => {
        const participantId = String(participant);
        if (
          participantId !== String(req.user.id)
          && acceptedContactIds.includes(participantId)
          && !orderedIds.includes(participantId)
        ) {
          orderedIds.push(participantId);
        }
      });
    });

    const usersById = new Map(users.map((user) => [String(user._id), user]));
    const orderedUsers = [];

    orderedIds.forEach((userId) => {
      if (usersById.has(userId)) {
        orderedUsers.push(usersById.get(userId));
        usersById.delete(userId);
      }
    });

    const remainingUsers = Array.from(usersById.values()).sort((a, b) => a.name.localeCompare(b.name));

    return res.status(200).json([...orderedUsers, ...remainingUsers]);
  } catch (_error) {
    return res.status(500).json({ message: 'Failed to fetch users list' });
  }
};

export const getContactRequests = async (req, res) => {
  try {
    const incoming = await ContactRequest.find({
      receiver: req.user.id,
      status: 'pending',
    })
      .populate('sender', 'name email avatarUrl isOnline lastSeen')
      .populate('receiver', 'name email avatarUrl isOnline lastSeen')
      .sort({ createdAt: -1 })
      .lean();

    const outgoing = await ContactRequest.find({
      sender: req.user.id,
      status: 'pending',
    })
      .populate('sender', 'name email avatarUrl isOnline lastSeen')
      .populate('receiver', 'name email avatarUrl isOnline lastSeen')
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({
      incoming: incoming.map((row) => toPendingRequestPayload(row, 'incoming')),
      outgoing: outgoing.map((row) => toPendingRequestPayload(row, 'outgoing')),
    });
  } catch (_error) {
    return res.status(500).json({ message: 'Failed to fetch requests' });
  }
};

export const getDiscoverUsers = async (req, res) => {
  try {
    const acceptedContactIds = await getAcceptedContactIds(req.user.id);

    const relationships = await ContactRequest.find({
      $or: [{ sender: req.user.id }, { receiver: req.user.id }],
    })
      .select('sender receiver status')
      .lean();

    const relationshipByUserId = new Map();
    relationships.forEach((relationship) => {
      const senderId = String(relationship.sender);
      const receiverId = String(relationship.receiver);
      const otherUserId = senderId === String(req.user.id) ? receiverId : senderId;
      relationshipByUserId.set(otherUserId, {
        status: relationship.status,
        requestedByMe: senderId === String(req.user.id),
      });
    });

    const discoverUsers = await User.find({
      _id: {
        $ne: req.user.id,
        $nin: acceptedContactIds,
      },
    })
      .select('name email avatarUrl isOnline lastSeen')
      .sort({ name: 1 })
      .lean();

    return res.status(200).json(
      discoverUsers.map((person) => {
        const relationship = relationshipByUserId.get(String(person._id));
        return {
          ...person,
          requestStatus: relationship?.status || 'none',
          requestedByMe: Boolean(relationship?.requestedByMe),
        };
      })
    );
  } catch (_error) {
    return res.status(500).json({ message: 'Failed to fetch discover users' });
  }
};

export const sendContactRequest = async (req, res) => {
  try {
    const receiverId = req.body?.receiverId || req.params?.receiverId;

    if (!receiverId) {
      return res.status(400).json({ message: 'Receiver is required' });
    }

    if (String(receiverId) === String(req.user.id)) {
      return res.status(400).json({ message: 'You cannot send request to yourself' });
    }

    const receiver = await User.findById(receiverId).select('_id');
    if (!receiver) {
      return res.status(404).json({ message: 'User not found' });
    }

    const pairKey = buildContactPairKey(req.user.id, receiverId);
    const existing = await ContactRequest.findOne({ pairKey });

    if (existing?.status === 'accepted') {
      return res.status(409).json({ message: 'Already connected' });
    }

    if (existing?.status === 'pending') {
      return res.status(409).json({ message: 'Request already pending' });
    }

    let request;
    if (existing && existing.status === 'rejected') {
      existing.sender = req.user.id;
      existing.receiver = receiverId;
      existing.status = 'pending';
      existing.respondedAt = null;
      request = await existing.save();
    } else {
      request = await ContactRequest.create({
        pairKey,
        sender: req.user.id,
        receiver: receiverId,
        status: 'pending',
      });
    }

    const populated = await ContactRequest.findById(request._id)
      .populate('sender', 'name email avatarUrl isOnline lastSeen')
      .populate('receiver', 'name email avatarUrl isOnline lastSeen')
      .lean();

    const io = req.app.get('io');
    io?.to(String(receiverId)).emit('contact_request:new', {
      requestId: String(request._id),
      from: String(req.user.id),
      to: String(receiverId),
    });

    io?.to(String(req.user.id)).emit('contact_request:new', {
      requestId: String(request._id),
      from: String(req.user.id),
      to: String(receiverId),
    });

    return res.status(201).json(toPendingRequestPayload(populated, 'outgoing'));
  } catch (_error) {
    return res.status(500).json({ message: 'Failed to send request' });
  }
};

export const respondToContactRequest = async (req, res) => {
  try {
    const { requestId } = req.params;
    const action = req.body?.action;

    if (!requestId || !['accepted', 'rejected'].includes(action)) {
      return res.status(400).json({ message: 'Invalid request action' });
    }

    const request = await ContactRequest.findById(requestId);
    if (!request) {
      return res.status(404).json({ message: 'Request not found' });
    }

    if (String(request.receiver) !== String(req.user.id)) {
      return res.status(403).json({ message: 'Not allowed' });
    }

    if (request.status !== 'pending') {
      return res.status(400).json({ message: 'Request already handled' });
    }

    request.status = action;
    request.respondedAt = new Date();
    await request.save();

    const populated = await ContactRequest.findById(request._id)
      .populate('sender', 'name email avatarUrl isOnline lastSeen')
      .populate('receiver', 'name email avatarUrl isOnline lastSeen')
      .lean();

    const senderId = String(request.sender);
    const receiverId = String(request.receiver);
    const io = req.app.get('io');

    io?.to(senderId).emit('contact_request:updated', {
      requestId: String(request._id),
      status: action,
    });
    io?.to(receiverId).emit('contact_request:updated', {
      requestId: String(request._id),
      status: action,
    });

    if (action === 'accepted') {
      io?.to(senderId).emit('contact_request:accepted', {
        requestId: String(request._id),
        contactUserId: receiverId,
      });
      io?.to(receiverId).emit('contact_request:accepted', {
        requestId: String(request._id),
        contactUserId: senderId,
      });
    }

    return res.status(200).json(toPendingRequestPayload(populated, 'incoming'));
  } catch (_error) {
    return res.status(500).json({ message: 'Failed to update request' });
  }
};

export const updateMyProfile = async (req, res) => {
  try {
    const { name, avatarUrl } = req.body;

    if (!name?.trim() && typeof avatarUrl !== 'string') {
      return res.status(400).json({ message: 'Name or avatar is required' });
    }

    const updatePayload = {};
    if (name?.trim()) {
      updatePayload.name = name.trim();
    }
    if (typeof avatarUrl === 'string') {
      updatePayload.avatarUrl = avatarUrl.trim();
    }

    const updated = await User.findByIdAndUpdate(
      req.user.id,
      updatePayload,
      { new: true, runValidators: true }
    ).select('name email avatarUrl');

    return res.status(200).json({
      id: updated._id,
      name: updated.name,
      email: updated.email,
      avatarUrl: updated.avatarUrl || '',
    });
  } catch (_error) {
    return res.status(500).json({ message: 'Failed to update profile' });
  }
};

export const uploadProfileAvatar = async (req, res) => {
  try {
    if (!req.file?.buffer) {
      return res.status(400).json({ message: 'Avatar image file is required' });
    }

    if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
      return res.status(500).json({ message: 'Cloudinary is not configured on server' });
    }

    const avatarUrl = await uploadBufferToCloudinary(req.file.buffer);
    return res.status(201).json({ avatarUrl });
  } catch (error) {
    return res.status(500).json({ message: error?.message || 'Failed to upload avatar' });
  }
};

export const blockUser = async (req, res) => {
  try {
    const { userId } = req.params;
    const currentUserId = req.user.id;

    if (!userId) {
      return res.status(400).json({ message: 'User id is required' });
    }

    if (String(currentUserId) === String(userId)) {
      return res.status(400).json({ message: 'Cannot block yourself' });
    }

    const currentUser = await User.findById(currentUserId);
    const targetUser = await User.findById(userId);

    if (!currentUser || !targetUser) {
      return res.status(404).json({ message: 'User not found' });
    }

    const isBlocked = currentUser.blockedUsers.some((id) => String(id) === String(userId));

    if (isBlocked) {
      currentUser.blockedUsers = currentUser.blockedUsers.filter((id) => String(id) !== String(userId));
    } else {
      currentUser.blockedUsers.push(userId);
    }

    await currentUser.save();

    return res.status(200).json({
      message: isBlocked ? 'User unblocked' : 'User blocked',
      isBlocked: !isBlocked,
      blockedUsers: currentUser.blockedUsers,
    });
  } catch (error) {
    console.error('Block user error:', error);
    return res.status(500).json({ message: 'Failed to block/unblock user' });
  }
};
