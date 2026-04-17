import express from 'express';
import { getUsers, updateMyProfile, uploadProfileAvatar } from '../controllers/userController.js';
import { protect } from '../middleware/authMiddleware.js';
import { uploadImage } from '../middleware/uploadMiddleware.js';

const router = express.Router();

router.get('/', protect, getUsers);
router.post('/avatar', protect, uploadImage.single('avatar'), uploadProfileAvatar);
router.patch('/me', protect, updateMyProfile);

export default router;
