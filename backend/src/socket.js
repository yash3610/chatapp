import jwt from 'jsonwebtoken';
import Conversation from './models/Conversation.js';
import Group from './models/Group.js';
import Game from './models/Game.js';
import Message from './models/Message.js';
import User from './models/User.js';
import { isAcceptedContact } from './utils/contacts.js';
import { buildParticipantKey, getOrCreateConversation } from './utils/conversation.js';

const onlineUsers = new Map();
const ALLOWED_REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '😢'];

const populateMessage = (query) =>
  query
    .populate('sender', 'name email avatarUrl')
    .populate('receiver', 'name email avatarUrl')
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

const QUIZ_QUESTIONS = [
  {
    text: 'Which planet is known as the Red Planet?',
    options: ['Earth', 'Mars', 'Jupiter', 'Venus'],
    correctIndex: 1,
  },
  {
    text: 'What is the capital of Japan?',
    options: ['Seoul', 'Kyoto', 'Tokyo', 'Osaka'],
    correctIndex: 2,
  },
  {
    text: 'Which language runs in a web browser?',
    options: ['Python', 'C++', 'Java', 'JavaScript'],
    correctIndex: 3,
  },
  {
    text: 'How many continents are there?',
    options: ['5', '6', '7', '8'],
    correctIndex: 2,
  },
  {
    text: 'What is the chemical symbol for water?',
    options: ['CO2', 'H2O', 'O2', 'NaCl'],
    correctIndex: 1,
  },
  {
    text: 'Which ocean is the largest?',
    options: ['Atlantic', 'Indian', 'Pacific', 'Arctic'],
    correctIndex: 2,
  },
];

const pickQuizQuestions = (count = 5) => {
  const shuffled = [...QUIZ_QUESTIONS].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.max(1, Math.min(count, shuffled.length)));
};

const sanitizeQuizQuestions = (questions = []) =>
  questions.map(({ text, options }) => ({ text, options }));

const getTicTacToeWinner = (board = []) => {
  const lines = [
    [0, 1, 2],
    [3, 4, 5],
    [6, 7, 8],
    [0, 3, 6],
    [1, 4, 7],
    [2, 5, 8],
    [0, 4, 8],
    [2, 4, 6],
  ];

  for (const [a, b, c] of lines) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return board[a];
    }
  }

  return null;
};

const buildGamePayload = (game) => {
  if (!game) {
    return null;
  }

  const payload = {
    _id: String(game._id),
    gameType: game.gameType,
    status: game.status,
    players: game.players.map((id) => String(id)),
    createdBy: String(game.createdBy),
    currentTurn: game.currentTurn ? String(game.currentTurn) : null,
    winner: game.winner ? String(game.winner) : null,
  };

  if (game.gameType === 'tic_tac_toe') {
    payload.ticTacToe = { board: game.ticTacToe?.board || Array(9).fill('') };
  }

  if (game.gameType === 'quiz') {
    payload.quiz = {
      currentIndex: game.quiz?.currentIndex || 0,
      total: game.quiz?.questions?.length || 0,
      questions: sanitizeQuizQuestions(game.quiz?.questions || []),
      scores: Object.fromEntries(game.quiz?.scores || []),
    };
  }

  return payload;
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

    const persistGameMessage = async ({ to, game, gameEvent, gameStatus, gameWinner = null }) => {
      if (!to || !game) {
        return null;
      }

      const conversation = await getOrCreateConversation(currentUserId, to);

      const message = await Message.create({
        conversation: conversation._id,
        sender: currentUserId,
        receiver: to,
        chatId: to,
        isGroup: false,
        messageType: 'game',
        text: '',
        imageUrl: '',
        status: isUserOnline(to) ? 'delivered' : 'sent',
        deliveredAt: isUserOnline(to) ? new Date() : null,
        gameId: game._id,
        gameType: game.gameType,
        gameEvent,
        gameStatus,
        gamePlayers: game.players,
        gameWinner,
        clientMessageId: `game-${game._id}-${gameEvent}-${Date.now()}`,
      });

      await Conversation.findByIdAndUpdate(conversation._id, {
        lastMessage: message._id,
        lastMessageAt: message.createdAt,
      });

      const populated = await populateMessage(Message.findById(message._id));
      io.to(String(to)).emit('receive_message', populated);
      io.to(currentUserId).emit('receive_message', populated);
      return populated;
    };

    socket.on('private_message', async (payload, ack) => {
      try {
        const { to, text, imageUrl, fileUrl, fileName, fileType, clientMessageId, replyTo } = payload || {};
        const trimmedText = text?.trim() || '';
        const normalizedClientMessageId = (clientMessageId || '').toString().trim();
        const normalizedReplyTo = replyTo || null;
        const normalizedFileUrl = (fileUrl || '').toString().trim();
        const normalizedFileName = (fileName || '').toString().trim();
        const normalizedFileType = (fileType || '').toString().trim();

        if (!to || (!trimmedText && !imageUrl && !normalizedFileUrl)) {
          if (typeof ack === 'function') {
            ack({ ok: false, message: 'Invalid message payload' });
          }
          return;
        }

        const allowed = await isAcceptedContact(currentUserId, to);
        if (!allowed) {
          if (typeof ack === 'function') {
            ack({ ok: false, message: 'Chat allowed only with accepted contacts' });
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
          fileUrl: normalizedFileUrl,
          fileName: normalizedFileName,
          fileType: normalizedFileType,
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
        const { groupId, text, imageUrl, fileUrl, fileName, fileType, clientMessageId, replyTo } = payload || {};
        const trimmedText = text?.trim() || '';
        const normalizedClientMessageId = (clientMessageId || '').toString().trim();
        const normalizedReplyTo = replyTo || null;
        const normalizedFileUrl = (fileUrl || '').toString().trim();
        const normalizedFileName = (fileName || '').toString().trim();
        const normalizedFileType = (fileType || '').toString().trim();

        if (!groupId || (!trimmedText && !imageUrl && !normalizedFileUrl)) {
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
          fileUrl: normalizedFileUrl,
          fileName: normalizedFileName,
          fileType: normalizedFileType,
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

    socket.on('game_invite', async ({ to, gameType }, ack) => {
      try {
        if (!to || !['tic_tac_toe', 'quiz'].includes(gameType)) {
          if (typeof ack === 'function') {
            ack({ ok: false, message: 'Invalid game invite' });
          }
          return;
        }

        const allowed = await isAcceptedContact(currentUserId, to);
        if (!allowed) {
          if (typeof ack === 'function') {
            ack({ ok: false, message: 'Chat allowed only with accepted contacts' });
          }
          return;
        }

        const players = [currentUserId, String(to)];
        const game = await Game.create({
          gameType,
          status: 'invited',
          players,
          createdBy: currentUserId,
          currentTurn: null,
          ticTacToe: gameType === 'tic_tac_toe' ? { board: Array(9).fill('') } : undefined,
          quiz: gameType === 'quiz'
            ? {
                questions: pickQuizQuestions(5),
                currentIndex: 0,
                scores: new Map(players.map((id) => [String(id), 0])),
              }
            : undefined,
        });

        const inviteMessage = await persistGameMessage({
          to,
          game,
          gameEvent: 'invite',
          gameStatus: 'invited',
        });

        if (typeof ack === 'function') {
          ack({ ok: true, game: buildGamePayload(game), message: inviteMessage });
        }
      } catch {
        if (typeof ack === 'function') {
          ack({ ok: false, message: 'Failed to send game invite' });
        }
      }
    });

    socket.on('game_accept', async ({ gameId }, ack) => {
      try {
        if (!gameId) {
          if (typeof ack === 'function') {
            ack({ ok: false, message: 'Game id is required' });
          }
          return;
        }

        const game = await Game.findById(gameId);
        if (!game) {
          if (typeof ack === 'function') {
            ack({ ok: false, message: 'Game not found' });
          }
          return;
        }

        const players = game.players.map((id) => String(id));
        if (!players.includes(currentUserId)) {
          if (typeof ack === 'function') {
            ack({ ok: false, message: 'Not allowed' });
          }
          return;
        }

        if (game.status !== 'invited') {
          if (typeof ack === 'function') {
            ack({ ok: false, message: 'Game already started' });
          }
          return;
        }

        const randomTurn = players[Math.floor(Math.random() * players.length)];
        game.status = 'active';
        game.currentTurn = randomTurn;

        if (game.gameType === 'quiz') {
          const scores = new Map(players.map((id) => [String(id), 0]));
          game.quiz = {
            questions: game.quiz?.questions?.length ? game.quiz.questions : pickQuizQuestions(5),
            currentIndex: 0,
            scores,
          };
        }

        await game.save();

        const otherPlayer = players.find((id) => id !== currentUserId);
        await persistGameMessage({
          to: otherPlayer,
          game,
          gameEvent: 'accepted',
          gameStatus: 'active',
        });

        const payload = buildGamePayload(game);
        players.forEach((playerId) => {
          io.to(String(playerId)).emit('game_update', payload);
        });

        if (typeof ack === 'function') {
          ack({ ok: true, game: payload });
        }
      } catch {
        if (typeof ack === 'function') {
          ack({ ok: false, message: 'Failed to accept game' });
        }
      }
    });

    socket.on('game_move', async ({ gameId, index }, ack) => {
      try {
        if (!gameId || typeof index !== 'number') {
          if (typeof ack === 'function') {
            ack({ ok: false, message: 'Invalid move payload' });
          }
          return;
        }

        const game = await Game.findById(gameId);
        if (!game || game.gameType !== 'tic_tac_toe') {
          if (typeof ack === 'function') {
            ack({ ok: false, message: 'Game not found' });
          }
          return;
        }

        const players = game.players.map((id) => String(id));
        if (!players.includes(currentUserId)) {
          if (typeof ack === 'function') {
            ack({ ok: false, message: 'Not allowed' });
          }
          return;
        }

        if (game.status !== 'active') {
          if (typeof ack === 'function') {
            ack({ ok: false, message: 'Game is not active' });
          }
          return;
        }

        if (String(game.currentTurn) !== currentUserId) {
          if (typeof ack === 'function') {
            ack({ ok: false, message: 'Not your turn' });
          }
          return;
        }

        if (index < 0 || index > 8) {
          if (typeof ack === 'function') {
            ack({ ok: false, message: 'Invalid move' });
          }
          return;
        }

        const board = Array.isArray(game.ticTacToe?.board) ? [...game.ticTacToe.board] : Array(9).fill('');
        if (board[index]) {
          if (typeof ack === 'function') {
            ack({ ok: false, message: 'Cell already filled' });
          }
          return;
        }

        const marker = players[0] === currentUserId ? 'X' : 'O';
        board[index] = marker;
        game.ticTacToe = { board };

        const winnerMarker = getTicTacToeWinner(board);
        const boardFull = board.every((cell) => cell);

        if (winnerMarker || boardFull) {
          game.status = 'finished';
          if (winnerMarker) {
            const winnerId = winnerMarker === 'X' ? players[0] : players[1];
            game.winner = winnerId;
          } else {
            game.winner = null;
          }
          game.currentTurn = null;
        } else {
          const nextTurn = players.find((id) => id !== currentUserId);
          game.currentTurn = nextTurn;
        }

        await game.save();

        const payload = buildGamePayload(game);
        players.forEach((playerId) => {
          io.to(String(playerId)).emit('game_update', payload);
        });

        if (game.status === 'finished') {
          const otherPlayer = players.find((id) => id !== currentUserId);
          await persistGameMessage({
            to: otherPlayer,
            game,
            gameEvent: 'result',
            gameStatus: 'finished',
            gameWinner: game.winner,
          });
          players.forEach((playerId) => {
            io.to(String(playerId)).emit('game_end', payload);
          });
        }

        if (typeof ack === 'function') {
          ack({ ok: true, game: payload });
        }
      } catch {
        if (typeof ack === 'function') {
          ack({ ok: false, message: 'Failed to apply move' });
        }
      }
    });

    socket.on('game_answer', async ({ gameId, answerIndex }, ack) => {
      try {
        if (!gameId || typeof answerIndex !== 'number') {
          if (typeof ack === 'function') {
            ack({ ok: false, message: 'Invalid answer payload' });
          }
          return;
        }

        const game = await Game.findById(gameId);
        if (!game || game.gameType !== 'quiz') {
          if (typeof ack === 'function') {
            ack({ ok: false, message: 'Game not found' });
          }
          return;
        }

        const players = game.players.map((id) => String(id));
        if (!players.includes(currentUserId)) {
          if (typeof ack === 'function') {
            ack({ ok: false, message: 'Not allowed' });
          }
          return;
        }

        if (game.status !== 'active') {
          if (typeof ack === 'function') {
            ack({ ok: false, message: 'Game is not active' });
          }
          return;
        }

        if (String(game.currentTurn) !== currentUserId) {
          if (typeof ack === 'function') {
            ack({ ok: false, message: 'Not your turn' });
          }
          return;
        }

        const currentIndex = game.quiz?.currentIndex || 0;
        const questions = game.quiz?.questions || [];
        const question = questions[currentIndex];

        if (!question) {
          if (typeof ack === 'function') {
            ack({ ok: false, message: 'Question not found' });
          }
          return;
        }

        const scores = new Map(game.quiz?.scores || []);
        const currentScore = scores.get(currentUserId) || 0;
        if (answerIndex === question.correctIndex) {
          scores.set(currentUserId, currentScore + 1);
        }

        const nextIndex = currentIndex + 1;
        const isFinished = nextIndex >= questions.length;

        if (isFinished) {
          game.status = 'finished';
          game.currentTurn = null;
          game.quiz = { ...game.quiz, currentIndex: nextIndex, scores };

          const scoreA = scores.get(players[0]) || 0;
          const scoreB = scores.get(players[1]) || 0;
          if (scoreA === scoreB) {
            game.winner = null;
          } else {
            game.winner = scoreA > scoreB ? players[0] : players[1];
          }
        } else {
          const nextTurn = players.find((id) => id !== currentUserId);
          game.currentTurn = nextTurn;
          game.quiz = { ...game.quiz, currentIndex: nextIndex, scores };
        }

        await game.save();

        const payload = buildGamePayload(game);
        players.forEach((playerId) => {
          io.to(String(playerId)).emit('game_update', payload);
        });

        if (game.status === 'finished') {
          const otherPlayer = players.find((id) => id !== currentUserId);
          await persistGameMessage({
            to: otherPlayer,
            game,
            gameEvent: 'result',
            gameStatus: 'finished',
            gameWinner: game.winner,
          });
          players.forEach((playerId) => {
            io.to(String(playerId)).emit('game_end', payload);
          });
        }

        if (typeof ack === 'function') {
          ack({ ok: true, game: payload });
        }
      } catch {
        if (typeof ack === 'function') {
          ack({ ok: false, message: 'Failed to submit answer' });
        }
      }
    });

    socket.on('game_get', async ({ gameId }, ack) => {
      try {
        if (!gameId) {
          if (typeof ack === 'function') {
            ack({ ok: false, message: 'Game id is required' });
          }
          return;
        }

        const game = await Game.findById(gameId);
        if (!game) {
          if (typeof ack === 'function') {
            ack({ ok: false, message: 'Game not found' });
          }
          return;
        }

        const players = game.players.map((id) => String(id));
        if (!players.includes(currentUserId)) {
          if (typeof ack === 'function') {
            ack({ ok: false, message: 'Not allowed' });
          }
          return;
        }

        if (typeof ack === 'function') {
          ack({ ok: true, game: buildGamePayload(game) });
        }
      } catch {
        if (typeof ack === 'function') {
          ack({ ok: false, message: 'Failed to fetch game' });
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

      const allowed = await isAcceptedContact(currentUserId, withUserId);
      if (!allowed) {
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
