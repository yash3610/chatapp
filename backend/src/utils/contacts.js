import ContactRequest from '../models/ContactRequest.js';

export const buildContactPairKey = (firstUserId, secondUserId) => {
  return [String(firstUserId), String(secondUserId)].sort().join(':');
};

export const isAcceptedContact = async (firstUserId, secondUserId) => {
  if (!firstUserId || !secondUserId) {
    return false;
  }

  if (String(firstUserId) === String(secondUserId)) {
    return false;
  }

  const pairKey = buildContactPairKey(firstUserId, secondUserId);
  const relationship = await ContactRequest.findOne({
    pairKey,
    status: 'accepted',
  })
    .select('_id')
    .lean();

  if (relationship) {
    return true;
  }

  const fallback = await ContactRequest.findOne({
    status: 'accepted',
    $or: [
      { sender: firstUserId, receiver: secondUserId },
      { sender: secondUserId, receiver: firstUserId },
    ],
  })
    .select('_id')
    .lean();

  return Boolean(fallback);
};

export const getAcceptedContactIds = async (userId) => {
  const rows = await ContactRequest.find({
    status: 'accepted',
    $or: [{ sender: userId }, { receiver: userId }],
  })
    .select('sender receiver')
    .lean();

  const ids = new Set();
  rows.forEach((row) => {
    const senderId = String(row.sender);
    const receiverId = String(row.receiver);
    if (senderId === String(userId)) {
      ids.add(receiverId);
    } else {
      ids.add(senderId);
    }
  });

  return Array.from(ids);
};
