import mongoose from 'mongoose';

const ticTacToeStateSchema = new mongoose.Schema(
  {
    board: {
      type: [String],
      default: Array(9).fill(''),
    },
  },
  { _id: false }
);

const quizQuestionSchema = new mongoose.Schema(
  {
    text: {
      type: String,
      required: true,
    },
    options: {
      type: [String],
      required: true,
    },
    correctIndex: {
      type: Number,
      required: true,
    },
  },
  { _id: false }
);

const quizStateSchema = new mongoose.Schema(
  {
    questions: {
      type: [quizQuestionSchema],
      default: [],
    },
    currentIndex: {
      type: Number,
      default: 0,
    },
    scores: {
      type: Map,
      of: Number,
      default: {},
    },
  },
  { _id: false }
);

const gameSchema = new mongoose.Schema(
  {
    gameType: {
      type: String,
      enum: ['tic_tac_toe', 'quiz'],
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ['invited', 'active', 'finished', 'cancelled'],
      default: 'invited',
      index: true,
    },
    players: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
      },
    ],
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    currentTurn: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    winner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    ticTacToe: {
      type: ticTacToeStateSchema,
      default: () => ({}),
    },
    quiz: {
      type: quizStateSchema,
      default: () => ({}),
    },
  },
  { timestamps: true }
);

gameSchema.index({ players: 1, status: 1 });

gameSchema.index({ createdAt: -1 });

export default mongoose.model('Game', gameSchema);
