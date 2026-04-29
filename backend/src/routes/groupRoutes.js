import express from 'express';
import { createGroup, listGroups, getGroupDetails, addGroupMember, removeGroupMember, makeGroupMemberAdmin, removeGroupMemberAdmin } from '../controllers/groupController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

router.get('/', protect, listGroups);
router.post('/', protect, createGroup);
router.get('/:groupId', protect, getGroupDetails);
router.post('/:groupId/members', protect, addGroupMember);
router.delete('/:groupId/members/:memberId', protect, removeGroupMember);
router.post('/:groupId/make-admin', protect, makeGroupMemberAdmin);
router.post('/:groupId/remove-admin', protect, removeGroupMemberAdmin);

export default router;