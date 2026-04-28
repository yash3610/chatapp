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

export const getGroupDetails = async (req, res) => {
  try {
    const { groupId } = req.params;
    if (!groupId) {
      return res.status(400).json({ message: 'Group id is required' });
    }

    const group = await Group.findById(groupId)
      .populate('members', 'name email avatarUrl isOnline')
      .populate('admin', 'name email avatarUrl')
      .lean();

    if (!group) {
      return res.status(404).json({ message: 'Group not found' });
    }

    // ensure requester is a member
    const isMember = group.members.some((m) => String(m._id) === String(req.user.id));
    if (!isMember) {
      return res.status(403).json({ message: 'Not a member of this group' });
    }

    return res.status(200).json(group);
  } catch (_error) {
    return res.status(500).json({ message: 'Failed to fetch group details' });
  }
};

export const addGroupMember = async (req, res) => {
  try {
    const { groupId } = req.params;
    const { memberId } = req.body || {};
    if (!groupId || !memberId) {
      return res.status(400).json({ message: 'Group id and member id required' });
    }

    const group = await Group.findById(groupId);
    if (!group) {
      return res.status(404).json({ message: 'Group not found' });
    }

    if (String(group.admin) !== String(req.user.id)) {
      return res.status(403).json({ message: 'Only admin can add members' });
    }

    if (group.members.some((m) => String(m) === String(memberId))) {
      return res.status(409).json({ message: 'Member already in group' });
    }

    group.members.push(memberId);
    await group.save();

    const populated = await Group.findById(groupId).populate('members', 'name email avatarUrl isOnline').populate('admin', 'name email avatarUrl').lean();
    return res.status(200).json(populated);
  } catch (error) {
    console.error('Add member error', error);
    return res.status(500).json({ message: 'Failed to add member' });
  }
};

export const removeGroupMember = async (req, res) => {
  try {
    const { groupId, memberId } = req.params;
    if (!groupId || !memberId) {
      return res.status(400).json({ message: 'Group id and member id required' });
    }

    const group = await Group.findById(groupId);
    if (!group) {
      return res.status(404).json({ message: 'Group not found' });
    }

    if (String(group.admin) !== String(req.user.id)) {
      return res.status(403).json({ message: 'Only admin can remove members' });
    }

    if (!group.members.some((m) => String(m) === String(memberId))) {
      return res.status(404).json({ message: 'Member not in group' });
    }

    group.members = group.members.filter((m) => String(m) !== String(memberId));
    await group.save();

    const populated = await Group.findById(groupId).populate('members', 'name email avatarUrl isOnline').populate('admin', 'name email avatarUrl').lean();
    return res.status(200).json(populated);
  } catch (error) {
    console.error('Remove member error', error);
    return res.status(500).json({ message: 'Failed to remove member' });
  }
};

export const makeGroupMemberAdmin = async (req, res) => {
  try {
    const { groupId } = req.params;
    const { memberId } = req.body || {};
    if (!groupId || !memberId) {
      return res.status(400).json({ message: 'Group id and member id required' });
    }

    const group = await Group.findById(groupId);
    if (!group) {
      return res.status(404).json({ message: 'Group not found' });
    }

    if (String(group.admin) !== String(req.user.id)) {
      return res.status(403).json({ message: 'Only current admin can change admin' });
    }

    if (!group.members.some((m) => String(m) === String(memberId))) {
      return res.status(404).json({ message: 'Member not in group' });
    }

    group.admin = memberId;
    await group.save();

    const populated = await Group.findById(groupId).populate('members', 'name email avatarUrl isOnline').populate('admin', 'name email avatarUrl').lean();
    return res.status(200).json(populated);
  } catch (error) {
    console.error('Make admin error', error);
    return res.status(500).json({ message: 'Failed to make admin' });
  }
};