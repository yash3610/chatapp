import Group from '../models/Group.js';

export const listGroups = async (req, res) => {
  try {
    const groups = await Group.find({ members: req.user.id })
      .sort({ updatedAt: -1 })
      .populate('members', 'name email avatarUrl isOnline')
      .populate('admin', 'name email avatarUrl')
      .lean();

    return res.status(200).json(groups);
  } catch (_error) {
    return res.status(500).json({ message: 'Failed to fetch groups' });
  }
};

export const createGroup = async (req, res) => {
  try {
    const { name, members = [], groupImage = '' } = req.body || {};
    const trimmedName = (name || '').trim();

    if (!trimmedName) {
      return res.status(400).json({ message: 'Group name is required' });
    }

    const uniqueMembers = Array.from(
      new Set([String(req.user.id), ...members.map((id) => String(id)).filter(Boolean)])
    );

    if (uniqueMembers.length < 2) {
      return res.status(400).json({ message: 'Select at least one member' });
    }

    const group = await Group.create({
      name: trimmedName,
      members: uniqueMembers,
      admin: req.user.id,
      groupImage: groupImage || '',
    });

    const populatedGroup = await Group.findById(group._id)
      .populate('members', 'name email avatarUrl isOnline')
      .populate('admin', 'name email avatarUrl')
      .lean();

    return res.status(201).json(populatedGroup);
  } catch (_error) {
    return res.status(500).json({ message: 'Failed to create group' });
  }
};