import express from 'express';
import {
	deleteMessage,
	editMessage,
	getConversation,
	getGroupConversation,
	getTypingStatus,
	markConversationAsSeen,
	reactToMessage,
	relayTypingEvent,
	sendMessage,
	sendGroupMessage,
	uploadChatImage,
	clearConversation,
} from '../controllers/messageController.js';
import { protect } from '../middleware/authMiddleware.js';
import { uploadImage } from '../middleware/uploadMiddleware.js';

const router = express.Router();

router.get('/typing-status/:userId', protect, getTypingStatus);
router.get('/group/:groupId', protect, getGroupConversation);
router.get('/:userId', protect, getConversation);
router.patch('/seen/:userId', protect, markConversationAsSeen);
router.patch('/reactions/:messageId', protect, reactToMessage);
router.patch('/edit/:messageId', protect, editMessage);
router.patch('/delete/:messageId', protect, deleteMessage);
router.delete('/clear-conversation/:userId', protect, clearConversation);
router.post('/upload', protect, uploadImage.single('image'), uploadChatImage);
router.post('/typing', protect, relayTypingEvent);
router.post('/group/:groupId', protect, sendGroupMessage);
router.post('/', protect, sendMessage);

export default router;
