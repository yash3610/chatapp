import mongoose from 'mongoose';

const reactionSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    emoji: {
      type: String,
      enum: ['👍', '❤️', '😂', '😮', '😢'],
      required: true,
    },
  },
  { _id: false, timestamps: true }
);

const messageSchema = new mongoose.Schema(
  {
    conversation: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Conversation',
      default: null,
      index: true,
    },
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    receiver: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    chatId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
      index: true,
    },
    isGroup: {
      type: Boolean,
      default: false,
      index: true,
    },
    replyTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Message',
      default: null,
    },
    text: {
      type: String,
      default: '',
      trim: true,
      maxlength: 2000,
    },
    imageUrl: {
      type: String,
      default: '',
      trim: true,
    },
    messageType: {
      type: String,
      enum: ['text', 'call'],
      default: 'text',
      index: true,
    },
    callType: {
      type: String,
      enum: ['', 'audio', 'video'],
      default: '',
    },
    callEvent: {
      type: String,
      enum: ['', 'ended', 'missed', 'declined', 'cancelled'],
      default: '',
    },
    clientMessageId: {
      type: String,
      default: '',
      trim: true,
      index: true,
    },
    status: {
      type: String,
      enum: ['sent', 'delivered', 'seen'],
      default: 'sent',
    },
    deliveredAt: {
      type: Date,
      default: null,
    },
    seenAt: {
      type: Date,
      default: null,
    },
    reactions: {
      type: [reactionSchema],
      default: [],
    },
    edited: {
      type: Boolean,
      default: false,
    },
    editedAt: {
      type: Date,
      default: null,
    },
    deleted: {
      type: Boolean,
      default: false,
    },
    deletedFor: {
      type: [mongoose.Schema.Types.ObjectId],
      ref: 'User',
      default: [],
    },
  },
  {
    timestamps: true,
  }
);

messageSchema.index({ sender: 1, receiver: 1, createdAt: -1 });
messageSchema.index({ receiver: 1, status: 1, createdAt: -1 });
messageSchema.index({ conversation: 1, createdAt: -1 });
messageSchema.index({ sender: 1, receiver: 1, clientMessageId: 1 });
messageSchema.index({ deletedFor: 1 });
messageSchema.index({ isGroup: 1, chatId: 1, createdAt: -1 });

export default mongoose.model('Message', messageSchema);
