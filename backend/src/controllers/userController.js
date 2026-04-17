import Conversation from '../models/Conversation.js';
import User from '../models/User.js';
import cloudinary from '../config/cloudinary.js';

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

export const getUsers = async (req, res) => {
  try {
    const users = await User.find({ _id: { $ne: req.user.id } }).select('name email avatarUrl isOnline lastSeen').lean();

    const conversations = await Conversation.find({ participants: req.user.id })
      .select('participants lastMessageAt')
      .sort({ lastMessageAt: -1 })
      .lean();

    const orderedIds = [];
    conversations.forEach((conversation) => {
      conversation.participants.forEach((participant) => {
        const participantId = String(participant);
        if (participantId !== String(req.user.id) && !orderedIds.includes(participantId)) {
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

  } catch (error) {
    return res.status(500).json({ message: 'Failed to fetch users list' });
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
  } catch (error) {
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
