import express from 'express';
import { createGroup, listGroups } from '../controllers/groupController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

router.get('/', protect, listGroups);
router.post('/', protect, createGroup);

export default router;