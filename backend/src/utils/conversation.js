import Conversation from '../models/Conversation.js';

const normalizeId = (id) => String(id);

export const buildParticipantKey = (firstUserId, secondUserId) => {
  return [normalizeId(firstUserId), normalizeId(secondUserId)].sort().join(':');
};

export const getOrCreateConversation = async (firstUserId, secondUserId) => {
  const participantKey = buildParticipantKey(firstUserId, secondUserId);

  return Conversation.findOneAndUpdate(
    { participantKey },
    {
      $setOnInsert: {
        participants: [firstUserId, secondUserId],
        participantKey,
      },
    },
    {
      new: true,
      upsert: true,
    }
  );
};
