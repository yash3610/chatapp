import express from 'express';
import {
	deleteMessage,
	editMessage,
	getConversation,
	getTypingStatus,
	markConversationAsSeen,
	reactToMessage,
	relayTypingEvent,
	sendMessage,
	uploadChatImage,
} from '../controllers/messageController.js';
import { protect } from '../middleware/authMiddleware.js';
import { uploadImage } from '../middleware/uploadMiddleware.js';

const router = express.Router();

router.get('/typing-status/:userId', protect, getTypingStatus);
router.get('/:userId', protect, getConversation);
router.patch('/seen/:userId', protect, markConversationAsSeen);
router.patch('/reactions/:messageId', protect, reactToMessage);
router.patch('/edit/:messageId', protect, editMessage);
router.patch('/delete/:messageId', protect, deleteMessage);
router.post('/upload', protect, uploadImage.single('image'), uploadChatImage);
router.post('/typing', protect, relayTypingEvent);
router.post('/', protect, sendMessage);

export default router;
