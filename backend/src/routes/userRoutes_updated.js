import express from 'express';
import {
  getContactRequests,
  getDiscoverUsers,
  getUsers,
  respondToContactRequest,
  sendContactRequest,
  updateMyProfile,
  uploadProfileAvatar,
  blockUser,
} from '../controllers/userController.js';
import { protect } from '../middleware/authMiddleware.js';
import { uploadImage } from '../middleware/uploadMiddleware.js';

const router = express.Router();

router.get('/', protect, getUsers);
router.get('/discover', protect, getDiscoverUsers);
router.get('/requests', protect, getContactRequests);
router.post('/requests', protect, sendContactRequest);
router.patch('/requests/:requestId', protect, respondToContactRequest);
router.post('/avatar', protect, uploadImage.single('avatar'), uploadProfileAvatar);
router.patch('/me', protect, updateMyProfile);
router.post('/block/:userId', protect, blockUser);

export default router;
