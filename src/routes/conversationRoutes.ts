// src/routes/conversationRoutes.ts
import { Router } from 'express';
import ConversationController from '../controllers/conversationController.js';
import authMiddleware from '../middleware/authMiddleware.js';

const router = Router();

// Get all available agents
router.get('/agents', ConversationController.getAgents.bind(ConversationController));

// Start or continue a conversation
router.post('/start', authMiddleware, ConversationController.startConversation.bind(ConversationController));

// Send a message to the agent
router.post('/message', authMiddleware, ConversationController.chat.bind(ConversationController));

// Get messages for a specific agent
router.get('/:agentSlug/messages', authMiddleware, ConversationController.getMessages.bind(ConversationController));

// Delete a conversation
router.delete('/:agentSlug', authMiddleware, ConversationController.deleteConversation.bind(ConversationController));

// Get memory fragments for a user
router.get('/memories/:userId', authMiddleware, ConversationController.getMemoryFragments.bind(ConversationController));

export default router;